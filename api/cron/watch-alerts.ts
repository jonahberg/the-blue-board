// Vercel Cron Job: server-side flight-watch alerts + Web Push delivery.
// Config in vercel.json: { "path": "/api/cron/watch-alerts", "schedule": "*/5 * * * *" }
//
// Background flight alerts that survive the tab closing. The in-tab watch engine only runs while the
// dashboard is open; this cron resolves every watched leg server-side every 5 minutes and pushes a
// real notification through the browser's push service. What pushes, and the one-watch-one-leg
// lifecycle, are api/_watch-diff.ts's job (evaluateWatch); this file does the I/O.
//
// Each run:
//   1. Reads the free public FR24 live feed ONCE, first, on every run whenever Supabase is configured
//      — ahead of the push gate, so it depends neither on VAPID nor on anyone watching a flight — and
//      records one "United flights airborne" sample from it (api/_airborne-samples.ts → the Live
//      tab's 24-hour graph). A failed or meta-only read records nothing: a gap in the graph, never a
//      zero. Failure never fails the run.
//   2. Loads every subscription, then harvests that same read into reg_sightings (only when some
//      watch is live) — the same write api/fr24-feed.ts and the warm cron make. That is what lets
//      /api/flight-times see a watched flight airborne (departed) and on the ground at its destination
//      (landed) every five minutes, including at non-hub destinations no arrivals board covers
//      (Oct 4 2026 audit, finding 1). Failure never fails the run.
//   3. Resolves each distinct watched leg once through /api/flight-times with officialFallback=0:
//      a pinned watch asks for its own leg (`dep` + `from`), an unpinned one for the flight.
//   4. Evaluates, pushes, and logs ONE structured line per push (flight, leg date, old → new, reason;
//      never an endpoint), so a later audit can prove what was sent.
//   5. Persists the watch state.
//
// GRACEFUL UNCONFIGURED: when VAPID / Supabase env is absent the cron no-ops with 200 (after step 1's
// sample, when Supabase alone is there) — the client stays on today's in-tab behaviour (see
// docs/setup-push-alerts.md for the owner setup).
//
// COST: never calls the paid FR24 official API — /api/flight-times is asked with officialFallback=0,
// so it only touches the free FlightAware scrape + schedule-snapshot cache + the sightings ledger, and
// the live-feed read is the free public feed, once per run (twice only when the first body is empty).
// Upstream lookups are budget-capped at MAX_DISTINCT_FLIGHTS per run (soonest pinned legs first) and
// sends at MAX_SENDS_PER_RUN.
//
// LATENCY: /api/flight-times answers with `s-maxage=60, stale-while-revalidate=300`, so a five-minute
// cron usually receives the answer computed on its previous run. An alert can trail the event by up
// to ~10 minutes; that is the accepted cost of not cache-busting the production endpoint.

import type { VercelRequest, VercelResponse } from '../_types.js';
import { isAuthorizedCronRequest } from '../_cron-auth.js';
import { getSupabase } from '../_supabase.js';
import { isPushConfigured, ensureVapidConfigured, sendPush } from '../_web-push.js';
import { recordFeedSightings } from '../_reg-sightings.js';
import { recordAirborneSample, type RecordResult } from '../_airborne-samples.js';
import { parseFr24Feed } from '../../src/lib/feed-health.js';
import { unitedFeedUrls } from '../../src/lib/united-feed.js';
import { fetchUnitedFeed } from '../_united-feed.js';
import { evaluateWatch, retireIfDone, watchQuery, watchQueryKey, type WatchEntry } from '../_watch-diff.js';

const PAGE_SIZE = 500;
const MAX_DISTINCT_FLIGHTS = 50; // upstream lookup budget per run
const MAX_SENDS_PER_RUN = 200;
const MAX_FAILS = 3; // delete a subscription after this many consecutive failures
const RESOLVE_ABORT_MS = 9000; // per-flight upstream timeout
const FEED_ABORT_MS = 8000; // per attempt of the one live-feed read per run
// The free feed sometimes 200s a meta-only body for a beat (api/fr24-feed.ts, Aug 4 2026 probe), so an
// empty read is retried ONCE after this pause — the same one-retry rule and knob fr24-feed.ts uses.
// A timeout or HTTP error is not retried. Zero in tests.
const FEED_EMPTY_RETRY_DEFAULT_MS = 400;
function feedEmptyRetryMs(): number {
  const raw = process.env.FR24_EMPTY_RETRY_DELAY_MS;
  if (raw === undefined || String(raw).trim() === '') return FEED_EMPTY_RETRY_DEFAULT_MS;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : FEED_EMPTY_RETRY_DEFAULT_MS;
}
// Stop resolving once this much wall clock has elapsed, leaving >=20s headroom under the 120s
// maxDuration (vercel.json) for the send + persist passes so the run never gets force-killed
// mid-persist (which would drop state and re-notify next run).
const RESOLVE_DEADLINE_MS = 100_000;

/** The United request, kept as an export for callers/tests that name it; reads go through fetchUnitedFeed. */
export const LIVE_FEED_URL = unitedFeedUrls().united;

const BASE_URL = process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  : process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'https://theblueboard.co';

interface SubscriptionRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  watches: WatchEntry[];
  failed_count: number;
}

async function loadAllSubscriptions(supabase: ReturnType<typeof getSupabase>): Promise<SubscriptionRow[]> {
  const out: SubscriptionRow[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from('watch_subscriptions')
      .select('id, endpoint, p256dh, auth, watches, failed_count')
      .order('last_seen_at', { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    if (error) {
      const err = new Error(error.message);
      (err as any).code = error.code;
      throw err;
    }
    const rows = (data || []) as SubscriptionRow[];
    out.push(...rows);
    if (rows.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return out;
}

/**
 * One free live-feed read: the parsed flights, or null for a failed read (HTTP error, timeout, or a
 * meta-only body twice in a row — zero aircraft is never a real United sky, feed-health.js). Never
 * throws.
 */
async function readLiveFeed(): Promise<any[] | null> {
  const attempt = async (): Promise<any[] | null> => {
    // The complete United feed (api/_united-feed.ts), so the airborne samples and the sightings
    // count the Express flights FR24 files under their operator too.
    const payload = await fetchUnitedFeed(FEED_ABORT_MS);
    return payload ? parseFr24Feed(payload) : null;
  };
  try {
    let parsed = await attempt();
    if (parsed && parsed.length === 0) {
      const pause = feedEmptyRetryMs();
      if (pause > 0) await new Promise((resolve) => setTimeout(resolve, pause));
      parsed = await attempt();
    }
    return parsed && parsed.length > 0 ? parsed : null;
  } catch (e: any) {
    console.warn('watch-alerts live-feed read failed:', e?.message || e);
    return null;
  }
}

/** The run's one feed read → one airborne sample. Never throws, whatever the writer does. */
async function sampleAirborne(parsed: any[] | null, atMs: number): Promise<RecordResult> {
  if (!parsed) return { recorded: false, reason: 'feed read failed' };
  try {
    return await recordAirborneSample(parsed, atMs);
  } catch (e: any) {
    console.warn('watch-alerts airborne sample failed:', e?.message || e);
    return { recorded: false, reason: 'write threw' };
  }
}

/** The same read → reg_sightings. Never throws. */
async function harvestLiveSightings(parsed: any[] | null): Promise<{ ok: boolean; recorded: number }> {
  if (!parsed) return { ok: false, recorded: 0 };
  try {
    return { ok: true, recorded: await recordFeedSightings(parsed) };
  } catch (e: any) {
    console.warn('watch-alerts live-feed harvest failed:', e?.message || e);
    return { ok: false, recorded: 0 };
  }
}

// Resolve one leg through the free tiers only (officialFallback=0). The whole payload comes back:
// the evaluation reads times, not just the status word. Never throws.
async function resolveLeg(query: ReturnType<typeof watchQuery>): Promise<any | null> {
  const params = new URLSearchParams({ flight: query.flight, officialFallback: '0' });
  if (query.date) params.set('date', query.date);
  if (query.dep) params.set('dep', String(query.dep));
  if (query.from) params.set('from', query.from);
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), RESOLVE_ABORT_MS);
    const resp = await fetch(`${BASE_URL}/api/flight-times?${params}`, {
      signal: controller.signal,
      headers: { 'User-Agent': 'BlueBoard-WatchAlerts/1.0' },
    });
    clearTimeout(t);
    if (!resp.ok) return null;
    const d = (await resp.json()) as any;
    if (!d || d.success === false) return null;
    return d;
  } catch {
    return null;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const runStart = Date.now();
  if (!isAuthorizedCronRequest(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // The run's ONE live-feed read, first and unconditionally (Supabase permitting): the 24-hour
  // airborne graph needs a sample every five minutes whether or not anyone is watching a flight or
  // push is configured. The sightings harvest below reuses the same parse.
  const supabaseConfigured = !!process.env.NEXT_PUBLIC_SUPABASE_URL;
  let feed: any[] | null = null;
  let airborneSample: RecordResult | { skipped: true } = { skipped: true };
  if (supabaseConfigured) {
    feed = await readLiveFeed();
    airborneSample = await sampleAirborne(feed, Date.now());
  }

  // Graceful unconfigured: no VAPID keys or no Supabase → nothing to do, report honestly.
  if (!isPushConfigured() || !supabaseConfigured) {
    return res.status(200).json({ configured: false, skipped: 'push not configured', airborneSample });
  }
  ensureVapidConfigured();

  let subs: SubscriptionRow[];
  try {
    subs = await loadAllSubscriptions(getSupabase());
  } catch (e: any) {
    // Deploy-ordering footgun: VAPID env can land before sql/014 creates watch_subscriptions.
    // Postgres 42P01 (relation does not exist) means the migration hasn't run — degrade to the
    // graceful-unconfigured 200 instead of a 5-minute 500 storm until the table exists.
    if (e?.code === '42P01') {
      return res.status(200).json({ configured: false, skipped: 'watch_subscriptions table not provisioned', airborneSample });
    }
    console.error('watch-alerts: subscription load failed:', e?.message || e);
    return res.status(500).json({ error: 'subscription load failed', airborneSample });
  }

  const nowMs = Date.now();

  // Retire finished legs first (no lookup, no push), then collect the distinct lookups the live
  // watches need. Pinned legs are ordered by departure so the budget goes to the soonest ones;
  // unpinned watches (which can only baseline) come after.
  const distinct = new Map<string, { query: ReturnType<typeof watchQuery>; order: number }>();
  const retiredThisRun = new Set<WatchEntry>();
  for (const sub of subs) {
    if (!Array.isArray(sub.watches)) continue;
    sub.watches = sub.watches.map((w) => {
      if (!w?.flight) return w;
      const after = retireIfDone(w, nowMs);
      if (after !== w) retiredThisRun.add(after);
      return after;
    });
    for (const w of sub.watches) {
      if (!w?.flight || w.retired) continue;
      const key = watchQueryKey(w);
      if (distinct.has(key)) continue;
      const legDep = Date.parse(w.legDep || '');
      distinct.set(key, { query: watchQuery(w), order: Number.isFinite(legDep) ? legDep : Number.MAX_SAFE_INTEGER });
    }
  }
  const candidates = Array.from(distinct.entries()).sort(([ak, a], [bk, b]) => (a.order - b.order) || (ak < bk ? -1 : 1));
  const capped = candidates.slice(0, MAX_DISTINCT_FLIGHTS);
  const flightsCapped = candidates.length > MAX_DISTINCT_FLIGHTS;

  // The run's feed read → reg_sightings, before resolving, so this run's lookups can already see it
  // (subject to /api/flight-times' own one-minute sightings cache). Only when some watch is live.
  let liveFeed: { ok: boolean; recorded: number } | { skipped: true } = { skipped: true };
  if (capped.length > 0 && Date.now() - runStart <= RESOLVE_DEADLINE_MS) {
    liveFeed = await harvestLiveSightings(feed);
  }

  // Resolve each once (serial to be gentle on the free upstream tiers), bounded by wall clock:
  // unresolved legs keep their stored state and are evaluated next run.
  const resolved = new Map<string, any>();
  let resolveDeadlineHit = false;
  for (const [key, c] of capped) {
    if (Date.now() - runStart > RESOLVE_DEADLINE_MS) {
      resolveDeadlineHit = true;
      break;
    }
    const r = await resolveLeg(c.query);
    if (r) resolved.set(key, r);
  }

  let sends = 0;
  let capped200 = false;
  let subsUpdated = 0;
  let subsDeleted = 0;
  let failuresBumped = 0;
  let writeErrors = 0;
  let baselined = 0;
  let retired = 0;
  const supabase = getSupabase();

  for (const sub of subs) {
    if (!Array.isArray(sub.watches) || sub.watches.length === 0) continue;
    let mutated = false;
    let sawFailure = false;
    const newWatches: WatchEntry[] = [];
    const original = new Map<WatchEntry, string>();

    for (const w of sub.watches) {
      if (!w?.flight) continue;
      if (w.retired) {
        if (retiredThisRun.has(w)) {
          retired++;
          mutated = true;
        }
        newWatches.push(w);
        continue;
      }
      original.set(w, JSON.stringify(w));
      const payload = resolved.get(watchQueryKey(w));
      if (!payload) {
        newWatches.push(w); // couldn't resolve (capped, deadline, upstream miss): state untouched
        continue;
      }
      const ev = evaluateWatch(w, payload, nowMs);
      if (ev.baseline) baselined++;

      if (ev.notify && sends < MAX_SENDS_PER_RUN) {
        const tag = `${w.flight.toLowerCase()}-${ev.next.legDate || ev.log?.legDate || ''}`;
        const message = { title: ev.title, body: ev.body, tag, url: `/?flight=${encodeURIComponent(w.flight)}` };
        sends++;
        const result = await sendPush({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, message);
        // One structured line per push: what was said and why. No endpoint, no subscription id.
        console.log(JSON.stringify({
          event: 'watch-push',
          ...ev.log,
          result: result.ok ? 'sent' : result.gone ? 'gone' : `failed:${result.statusCode}`,
        }));
        if (result.gone) {
          // Dead endpoint — drop the whole subscription immediately.
          sawFailure = true;
          sub.failed_count = MAX_FAILS;
          break;
        }
        if (!result.ok) sawFailure = true;
      } else if (ev.notify) {
        capped200 = true;
        // Not sent: keep the old state so the alert goes out next run instead of being swallowed.
        newWatches.push(w);
        continue;
      }

      newWatches.push(ev.next);
      if (JSON.stringify(ev.next) !== original.get(w)) mutated = true;
    }

    // Persist state / failure bookkeeping. A push has already fired for notifying watches, so an
    // unpersisted state write means a duplicate notification next run — capture and count write
    // errors instead of silently swallowing them (supabase-js resolves with {error}, never throws).
    if (sub.failed_count >= MAX_FAILS) {
      const { error } = await supabase.from('watch_subscriptions').delete().eq('id', sub.id);
      if (error) {
        writeErrors++;
        console.error(`watch-alerts: delete failed for sub ${sub.id}:`, error.message);
      } else {
        subsDeleted++;
      }
      continue;
    }
    if (sawFailure) {
      failuresBumped++;
      const { error } = await supabase
        .from('watch_subscriptions')
        .update({ failed_count: (sub.failed_count || 0) + 1, watches: newWatches })
        .eq('id', sub.id);
      if (error) {
        writeErrors++;
        console.error(`watch-alerts: failure-bump update failed for sub ${sub.id}:`, error.message);
      } else {
        subsUpdated++;
      }
    } else if (mutated) {
      const { error } = await supabase
        .from('watch_subscriptions')
        .update({ watches: newWatches, failed_count: 0 })
        .eq('id', sub.id);
      if (error) {
        writeErrors++;
        console.error(`watch-alerts: state update failed for sub ${sub.id}:`, error.message);
      } else {
        subsUpdated++;
      }
    }
  }

  if (capped200) {
    console.warn(`watch-alerts: send cap reached (${MAX_SENDS_PER_RUN}); remaining notifications deferred to next run`);
  }
  if (resolveDeadlineHit) {
    console.warn(`watch-alerts: resolve deadline (${RESOLVE_DEADLINE_MS}ms) reached; remaining flights deferred to next run`);
  }
  if (writeErrors > 0) {
    console.error(`watch-alerts: ${writeErrors} subscription write(s) failed; state may re-notify next run`);
  }
  const summary = {
    subscriptions: subs.length,
    distinctFlights: distinct.size,
    resolved: resolved.size,
    flightsCapped,
    resolveDeadlineHit,
    liveFeed,
    airborneSample,
    baselined,
    retired,
    sends,
    sendCapReached: capped200,
    subsUpdated,
    subsDeleted,
    failuresBumped,
    writeErrors,
    timestamp: new Date().toISOString(),
  };
  console.log('watch-alerts run:', summary);
  return res.status(200).json({ configured: true, ...summary });
}
