// Vercel Cron Job: server-side flight-watch diff engine + Web Push delivery.
// Config in vercel.json: { "path": "/api/cron/watch-alerts", "schedule": "*/5 * * * *" }
//
// This is the "killer feature" foundation: background flight alerts that survive the tab closing.
// The in-tab watch engine (main.js) only runs while the dashboard is open (F031/F049); this cron
// resolves every watched flight server-side every 5 minutes and pushes a real notification through
// the browser's push service.
//
// GRACEFUL UNCONFIGURED: when VAPID / Supabase env is absent the cron no-ops with 200 — the client
// stays on today's in-tab behaviour (see docs/setup-push-alerts.md for the owner setup).
//
// COST: never calls the paid FR24 official API — it resolves flights through /api/flight-times with
// officialFallback=0, so it only touches the free FlightAware scrape + schedule-snapshot cache. A
// watch alert may be a few minutes stale; that is acceptable. Upstream lookups are budget-capped at
// MAX_DISTINCT_FLIGHTS per run (soonest departures first) and sends at MAX_SENDS_PER_RUN.

import type { VercelRequest, VercelResponse } from '../types.js';
import { isAuthorizedCronRequest } from '../_cron-auth.js';
import { getSupabase } from '../_supabase.js';
import { isPushConfigured, ensureVapidConfigured, sendPush } from '../_web-push.js';
import { diffWatch, type WatchState } from '../_watch-diff.js';

const PAGE_SIZE = 500;
const MAX_DISTINCT_FLIGHTS = 50; // upstream lookup budget per run
const MAX_SENDS_PER_RUN = 200;
const MAX_FAILS = 3; // delete a subscription after this many consecutive failures

const BASE_URL = process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  : process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'https://theblueboard.co';

interface WatchEntry {
  flight: string;
  date?: string;
  addedAt?: string;
  lastStatus?: string;
  lastGate?: string;
  lastEquip?: string;
}

interface SubscriptionRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  watches: WatchEntry[];
  failed_count: number;
}

interface ResolvedFlight {
  status?: string;
  gate?: string;
  equip?: string;
  /** Epoch ms of the soonest known departure, for prioritization. Infinity when unknown. */
  depMs: number;
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
    if (error) throw new Error(error.message);
    const rows = (data || []) as SubscriptionRow[];
    out.push(...rows);
    if (rows.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return out;
}

// Resolve one flight through the free tiers only (officialFallback=0). Never throws.
async function resolveFlight(flight: string, date?: string): Promise<ResolvedFlight | null> {
  const params = new URLSearchParams({ flight, officialFallback: '0' });
  if (date) params.set('date', date);
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 9000);
    const resp = await fetch(`${BASE_URL}/api/flight-times?${params}`, {
      signal: controller.signal,
      headers: { 'User-Agent': 'BlueBoard-WatchAlerts/1.0' },
    });
    clearTimeout(t);
    if (!resp.ok) return null;
    const d = (await resp.json()) as any;
    if (!d || d.success === false) return null;
    const dep = d.departure?.gate || {};
    const depIso = dep.actual || dep.estimated || dep.scheduled || '';
    const depMs = depIso ? Date.parse(depIso) : NaN;
    return {
      status: String(d.status || ''),
      gate: String(d.origin?.gate || ''),
      // Registration (tail) is the sharpest equipment-swap signal; fall back to type text.
      equip: String(d.registration || d.aircraft || ''),
      depMs: Number.isFinite(depMs) ? depMs : Infinity,
    };
  } catch {
    return null;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!isAuthorizedCronRequest(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Graceful unconfigured: no VAPID keys or no Supabase → nothing to do, report honestly.
  if (!isPushConfigured() || !process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return res.status(200).json({ configured: false, skipped: 'push not configured' });
  }
  ensureVapidConfigured();

  let subs: SubscriptionRow[];
  try {
    subs = await loadAllSubscriptions(getSupabase());
  } catch (e: any) {
    console.error('watch-alerts: subscription load failed:', e?.message || e);
    return res.status(500).json({ error: 'subscription load failed' });
  }

  // Collect the distinct (flight,date) pairs across every subscription, remembering the earliest
  // addedAt so a stable prioritization exists before we know departure times.
  const distinct = new Map<string, { flight: string; date?: string }>();
  for (const sub of subs) {
    if (!Array.isArray(sub.watches)) continue;
    for (const w of sub.watches) {
      if (!w?.flight) continue;
      const key = `${w.flight}:${w.date || ''}`;
      if (!distinct.has(key)) distinct.set(key, { flight: w.flight, date: w.date });
    }
  }

  // Prioritize by date (dated/today first, undated treated as today), then flight number, and cap
  // at the upstream budget. Departure-time prioritization refines this once resolved, but the cap
  // must be applied before we spend any lookups.
  const candidates = Array.from(distinct.values()).sort((a, b) => {
    const ad = a.date || '', bd = b.date || '';
    if (ad !== bd) return ad < bd ? -1 : 1;
    return a.flight < b.flight ? -1 : 1;
  });
  const capped = candidates.slice(0, MAX_DISTINCT_FLIGHTS);
  const flightsCapped = candidates.length > MAX_DISTINCT_FLIGHTS;

  // Resolve each once (serial to be gentle on the free upstream tiers).
  const resolved = new Map<string, ResolvedFlight>();
  for (const c of capped) {
    const r = await resolveFlight(c.flight, c.date);
    if (r) resolved.set(`${c.flight}:${c.date || ''}`, r);
  }

  const today = new Date().toISOString().slice(0, 10);
  let sends = 0;
  let capped200 = false;
  let subsUpdated = 0;
  let subsDeleted = 0;
  let failuresBumped = 0;
  const supabase = getSupabase();

  for (const sub of subs) {
    if (!Array.isArray(sub.watches) || sub.watches.length === 0) continue;
    let mutated = false;
    let sawFailure = false;
    const newWatches: WatchEntry[] = [];

    for (const w of sub.watches) {
      if (!w?.flight) continue;
      const r = resolved.get(`${w.flight}:${w.date || ''}`);
      if (!r) {
        newWatches.push(w); // couldn't resolve (uncapped, upstream miss); keep state untouched
        continue;
      }
      const prev: WatchState = { lastStatus: w.lastStatus, lastGate: w.lastGate, lastEquip: w.lastEquip };
      const diff = diffWatch(w.flight, prev, { status: r.status, gate: r.gate, equip: r.equip });

      // Persist the diff's next state regardless of whether we notify.
      const updated: WatchEntry = { ...w, ...diff.nextState };

      if (diff.notify && sends < MAX_SENDS_PER_RUN) {
        const payload = {
          title: diff.title,
          body: diff.body,
          tag: `${w.flight.toLowerCase()}-${w.date || today}`,
          url: `/?flight=${encodeURIComponent(w.flight)}`,
        };
        sends++;
        const result = await sendPush({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload);
        if (result.gone) {
          // Dead endpoint — drop the whole subscription immediately.
          sawFailure = true;
          sub.failed_count = MAX_FAILS;
          break;
        }
        if (!result.ok) sawFailure = true;
      } else if (diff.notify) {
        capped200 = true;
      }

      newWatches.push(updated);
      if (JSON.stringify(updated) !== JSON.stringify(w)) mutated = true;
    }

    // Persist state / failure bookkeeping.
    if (sub.failed_count >= MAX_FAILS) {
      await supabase.from('watch_subscriptions').delete().eq('id', sub.id);
      subsDeleted++;
      continue;
    }
    if (sawFailure) {
      failuresBumped++;
      await supabase
        .from('watch_subscriptions')
        .update({ failed_count: (sub.failed_count || 0) + 1, watches: newWatches })
        .eq('id', sub.id);
      subsUpdated++;
    } else if (mutated) {
      await supabase
        .from('watch_subscriptions')
        .update({ watches: newWatches, failed_count: 0 })
        .eq('id', sub.id);
      subsUpdated++;
    }
  }

  if (capped200) {
    console.warn(`watch-alerts: send cap reached (${MAX_SENDS_PER_RUN}); remaining notifications deferred to next run`);
  }
  const summary = {
    subscriptions: subs.length,
    distinctFlights: distinct.size,
    resolved: resolved.size,
    flightsCapped,
    sends,
    sendCapReached: capped200,
    subsUpdated,
    subsDeleted,
    failuresBumped,
    timestamp: new Date().toISOString(),
  };
  console.log('watch-alerts run:', summary);
  return res.status(200).json({ configured: true, ...summary });
}
