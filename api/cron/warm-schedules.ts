// Vercel Cron Job: rotates through the 2-day schedule window (today/tomorrow) so exact
// hub/day/direction snapshots stay warm at the CDN + Supabase snapshot. Yesterday is served
// on-demand (historical board, rarely viewed) to conserve the metered AeroDataBox quota.
// Config in vercel.json: { "path": "/api/cron/warm-schedules", "schedule": "*/30 * * * *" }
//
// Warm requests send forceRefresh=1 + the cron secret so /api/schedule actually REFETCHES the
// board. Without it the handler serves the existing complete snapshot back to the cron, reports
// "ok", and a board fetched once (usually the evening before, as "tomorrow") is never refreshed
// again all day — the frozen-board failure mode this cron exists to prevent.

import type { VercelRequest, VercelResponse } from '../_types.js';
import { UNITED_HUBS } from '../_hubs.js';
import { isAuthorizedCronRequest } from '../_cron-auth.js';
import { sendAlert } from '../_alert.js';
import { hydrateAdbSpend, getAdbUnitsToday, getAdbDailyUnitBudget } from '../_cost-state.js';
import { getDisruptedAirportsMap } from '../faa.js';
import { getStartOfHubDay } from '../../src/lib/hubTz.js';
import { parseFr24Feed } from '../../src/lib/feed-health.js';
import { recordFeedSightings } from '../_reg-sightings.js';
import { fetchUnitedFeed } from '../_united-feed.js';
import { cleanupExpiredSnapshots } from '../_schedule-snapshots.js';

const HUBS = UNITED_HUBS;
// Serialized with INTER_TASK_DELAY_MS between tasks. Budget math: each task worst-case is ~58s
// (55s schedule fetch + 3s gap). maxDuration for this cron is 300s in vercel.json, so the clamp
// ceiling of 4 tasks → 4 × 55s + 3 × 3s = 229s, plus the ~20s starlink ping and ~5s alerting
// (≈254s), stays under the Lambda limit. Default is 4 on a HALF-HOURLY cron: 4 tasks × 48 fires =
// 192 warm slots/day = 2.67 passes over the 72-task ring, so each today board warms ~8×/day
// (~every 3h) and each tomorrow board ~2.67×/day. That is ≈ 192 fresh boards × 4 units = 768
// AeroDataBox units/day, under the 1,400/day production budget and far under the 3× bypass
// ceiling. (Hourly was 384 units/day for a ~6h cadence, which left today's boards 6h+ stale —
// 11.5h when IROPS priority displaced them — with ~900 units/day of budget unused; Sep 26 2026.)
// Serial (not Promise.allSettled) respects the provider's per-second limit.
// Plus a ≤10s reg-sightings backstop fetch (Phase 2), keeping the worst case ≈264s.
function envNumber(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}
// Read per call (not at module load) so a runtime env change — or a test — actually takes effect,
// and so an explicit '0' delay is honoured instead of being swallowed by `|| fallback`.
const getWarmTasksPerRun = () => Math.max(1, Math.min(4, Math.floor(envNumber('SCHEDULE_WARM_TASKS_PER_RUN', 4))));
const getInterTaskDelayMs = () => Math.max(0, envNumber('SCHEDULE_WARM_DELAY_MS', 3000));
// A warm that came back stale/degraded did not warm anything — the handler served a frozen
// fallback instead of refetching. Anything older than the clean today-board TTL (1h since v1.8.2)
// counts as failed.
const STALE_WARM_MAX_AGE_S = 3600;
const BASE_URL = process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  : process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'https://theblueboard.co';

type WarmTask = {
  hub: string;
  dir: 'departures' | 'arrivals';
  dayOffset: 0 | 1;
  label: 'today' | 'tomorrow';
};

// Yesterday (dayOffset -1) is intentionally NOT warmed — its board is historical/stable and
// rarely viewed, so it loads on-demand (and caches) instead of burning quota every cycle.
function windowTasks(dayOffset: 0 | 1, label: 'today' | 'tomorrow'): WarmTask[] {
  const tasks: WarmTask[] = [];
  for (const dir of ['departures', 'arrivals'] as const) {
    for (const hub of HUBS) tasks.push({ hub, dir, dayOffset, label });
  }
  return tasks;
}

// The warm ring: TODAY_ROUNDS rounds of all 18 today windows, with the 18 tomorrow windows split
// evenly across the rounds. Striding through it sequentially (SCHEDULE_WARM_TASKS_PER_RUN windows
// per fire) warms each today board TODAY_ROUNDS times per ring and each tomorrow board once. At
// the default stride of 4/fire on the 30-min cron the 72-slot ring completes ~2.67×/day, so each
// today board refreshes ~every 3h (delays/cancellations stay current) and each tomorrow board
// ~2.67×/day (schedule data is stable; it just needs to exist before midnight). TODAY_ROUNDS
// stays 3 so the ring length (72) divides evenly by the stride (4) — that clean tiling is what
// gives an even 3h spacing with no skipped windows.
const TODAY_ROUNDS = 3;
function buildWarmRing(): WarmTask[] {
  const today = windowTasks(0, 'today');
  const tomorrow = windowTasks(1, 'tomorrow');
  const perRound = Math.ceil(tomorrow.length / TODAY_ROUNDS);
  const ring: WarmTask[] = [];
  for (let round = 0; round < TODAY_ROUNDS; round++) {
    ring.push(...today);
    ring.push(...tomorrow.slice(round * perRound, (round + 1) * perRound));
  }
  return ring;
}

// One slot per cron fire. SLOT_MS MUST match the cron interval in vercel.json (currently
// every 30 min): a mismatched slot would stride the ring more or less than once per fire and
// skip (or re-warm) windows. Update both together. The same slot number seeds applyIropsPriority's
// disrupted-hub rotation so priority fairness advances in lockstep with the ring.
export const SLOT_MS = 30 * 60 * 1000; // = vercel.json cron interval (*/30 * * * *)
export function getWarmSlot(nowMs = Date.now()): number {
  return Math.floor(nowMs / SLOT_MS);
}

export function buildWarmPlan(nowMs = Date.now()): WarmTask[] {
  const tasks = buildWarmRing();

  // Advance exactly one WARM_TASKS_PER_RUN stride per cron fire so consecutive fires cover the
  // ring sequentially with no gaps.
  const tasksPerRun = getWarmTasksPerRun();
  const slot = getWarmSlot(nowMs);
  const start = (slot * tasksPerRun) % tasks.length;
  const plan: WarmTask[] = [];
  for (let i = 0; i < Math.min(tasksPerRun, tasks.length); i++) {
    plan.push(tasks[(start + i) % tasks.length]);
  }
  return plan;
}

// ── Local-midnight rollover priority (pure) ──
// F81: the ring strides on UTC slots and ignores each hub's local midnight, so when a hub rolls
// over, its new TODAY board is the snapshot the ring warmed as TOMORROW — often 8-17h earlier (IAD
// arrivals was 1021 min old at 00:01 EDT) — until the pointer happens to reach it, up to ~3h later.
// For the first ROLLOVER_WINDOW_MS of each hub's day, its two today boards are injected into the
// run: same stride-1 cap as IROPS and the same slot-seeded rotation, so a same-zone pair (EWR+IAD,
// ORD+IAH, SFO+LAX = 4 boards) is covered across the two fires of that hour. Victims are TOMORROW
// slots only — the IROPS rule since v1.8.2. Displacing another hub's today board (the old
// fallback) pushed that board a full ring pass further out: "injected [NRT-arrivals-today]
// displacing [LAX-departures-today]" left LAX departures 183 min old (live audit Sep 28 2026, D3).
// When the stride has no tomorrow slot the injection is DEFERRED: the window is two fires, and a
// today board somebody is looking at refreshes organically on its 1h TTL. The run's task count,
// and so the 300s budget and the unit spend, is unchanged.
//
// Every hub whose local midnight falls in the window qualifies — GUM (UTC+10, 14:00Z), NRT
// (UTC+9, 15:00Z) and the four US zones alike; rolloverHubs() walks the whole UNITED_HUBS list.
const ROLLOVER_WINDOW_MS = 60 * 60 * 1000; // = two cron fires (*/30)

export function rolloverHubs(nowMs = Date.now()): string[] {
  const now = new Date(nowMs);
  return HUBS.filter((hub) => {
    const sinceMidnightMs = nowMs - getStartOfHubDay(hub, 0, now) * 1000;
    return sinceMidnightMs >= 0 && sinceMidnightMs < ROLLOVER_WINDOW_MS;
  });
}

export function applyRolloverPriority(
  plan: WarmTask[],
  nowMs = Date.now(),
  rotationSeed = 0
): { plan: WarmTask[]; injected: string[]; displaced: string[] } {
  const hubs = rolloverHubs(nowMs);
  if (hubs.length === 0 || plan.length === 0) return { plan, injected: [], displaced: [] };

  const keyOf = (t: WarmTask) => `${t.hub}-${t.dir}-${t.dayOffset}`;
  const ordered: WarmTask[] = [];
  for (const hub of hubs) {
    for (const dir of ['departures', 'arrivals'] as const) ordered.push({ hub, dir, dayOffset: 0, label: 'today' });
  }
  const offset = ((rotationSeed % ordered.length) + ordered.length) % ordered.length;
  const candidates = ordered.map((_, i) => ordered[(i + offset) % ordered.length]);
  const candidateKeys = new Set(candidates.map(keyOf));
  const isRollover = (t: WarmTask) => candidateKeys.has(keyOf(t));

  const result = [...plan];
  const injected: string[] = [];
  const displaced: string[] = [];
  const maxInjections = Math.max(0, plan.length - 1);
  // Victims are TOMORROW slots only, scanning from the back; the first base task is never one, so
  // at least that ring slot always survives.
  const pickVictim = (): number => {
    for (let i = result.length - 1; i >= 1; i--) {
      const t = result[i];
      if (!isRollover(t) && t.dayOffset === 1) return i;
    }
    return -1;
  };

  for (const task of candidates) {
    if (injected.length >= maxInjections) break;
    if (result.some((t) => keyOf(t) === keyOf(task))) continue; // stride already covers it
    const victim = pickVictim();
    if (victim === -1) break; // no tomorrow slot left: defer to the next fire / organic refresh
    displaced.push(`${result[victim].hub}-${result[victim].dir}-${result[victim].label}`);
    result[victim] = task;
    injected.push(`${task.hub}-${task.dir}-today`);
  }

  const rank = new Map(candidates.map((t, i) => [keyOf(t), i]));
  const priority = result.filter(isRollover).sort((a, b) => (rank.get(keyOf(a)) ?? 0) - (rank.get(keyOf(b)) ?? 0));
  const rest = result.filter((t) => !isRollover(t));
  return { plan: [...priority, ...rest], injected, displaced };
}

// ── IROPS-aware priority (pure) ──
// During an active FAA program (GDP/ground stop/closure) a hub's TODAY board changes minute to
// minute, but the stride-4 ring only revisits it ~every 3h. While hubs are disrupted, their
// today windows ROTATE FAIRLY into the front of each run's stride: priority injections are
// capped at stride-1 slots per run (at least one base ring slot always survives, so the ring
// never fully stalls behind a long disruption), and the disrupted-hub order is rotated by the
// same clock-derived slot pointer buildWarmPlan strides with — across consecutive runs every
// disrupted hub's boards cycle through the capped priority slots instead of the first two hubs
// in HUBS order winning every run and starving the rest. Injections replace TOMORROW slots of
// the stride only (from the back) — never another hub's today board — so the run's task count —
// and therefore the 300s budget and unit spend — is unchanged.
// Priority tasks run first within the stride. Pure function; the handler feeds it the cached FAA
// disruption map (api/faa.ts — one cached fetch per run, no per-task upstream call) plus the
// current warm slot as the rotation seed.
export function applyIropsPriority(
  plan: WarmTask[],
  disruptedHubs: Iterable<string>,
  rotationSeed = 0
): { plan: WarmTask[]; injected: string[]; displaced: string[] } {
  const hubSet: ReadonlySet<string> = new Set(HUBS);
  const disrupted: string[] = [];
  for (const raw of Array.from(disruptedHubs)) {
    const hub = String(raw || '').toUpperCase();
    if (hubSet.has(hub) && !disrupted.includes(hub)) disrupted.push(hub);
  }
  if (disrupted.length === 0 || plan.length === 0) return { plan, injected: [], displaced: [] };

  // Fair rotation: start the disrupted-hub order at the seed-derived offset so consecutive runs
  // hand the capped priority slots to different hubs.
  const offset = ((rotationSeed % disrupted.length) + disrupted.length) % disrupted.length;
  const rotated = disrupted.map((_, i) => disrupted[(i + offset) % disrupted.length]);

  const keyOf = (t: WarmTask) => `${t.hub}-${t.dir}-${t.dayOffset}`;
  const isPriority = (t: WarmTask) => t.dayOffset === 0 && disrupted.includes(t.hub);

  // Priority candidates in rotated hub order, departures before arrivals within a hub. The
  // candidate rank also orders the priority tasks at the front of the returned plan.
  const candidates: WarmTask[] = [];
  for (const hub of rotated) {
    for (const dir of ['departures', 'arrivals'] as const) {
      candidates.push({ hub, dir, dayOffset: 0, label: 'today' });
    }
  }
  const candidateRank = new Map(candidates.map((t, i) => [keyOf(t), i]));

  const result = [...plan];
  const injected: string[] = [];
  const displaced: string[] = [];
  // Cap injections at stride-1 so at least one base ring slot always survives (2 disrupted hubs
  // used to consume the entire stride-4 run and starve the ring for the whole disruption).
  const maxInjections = Math.max(0, plan.length - 1);

  for (const task of candidates) {
    if (injected.length >= maxInjections) break;
    if (result.some((t) => keyOf(t) === keyOf(task))) continue; // stride already covers it
    // Victims are TOMORROW slots only (scanning from the back). The ring is stateless, so a
    // displaced today board is not deferred — it is skipped until its next pass. Displacing
    // undisrupted today boards left DEN/IAH/LAX arrivals ~11.5h stale through US prime time
    // during a long EWR program (Sep 26 2026). Tomorrow boards are stable schedule data and can
    // wait; the disrupted hub's own today boards still arrive on the ring and refresh
    // organically while people watch them.
    let victim = -1;
    for (let i = result.length - 1; i >= 0; i--) {
      if (!isPriority(result[i]) && result[i].dayOffset === 1) { victim = i; break; }
    }
    if (victim === -1) break; // no tomorrow slot left to give up
    displaced.push(`${result[victim].hub}-${result[victim].dir}-${result[victim].label}`);
    result[victim] = task;
    injected.push(`${task.hub}-${task.dir}-today`);
  }

  // Disrupted-hub today boards run first, in rotated candidate order; everything else keeps its
  // ring order.
  const rank = (t: WarmTask) => candidateRank.get(keyOf(t)) ?? Number.MAX_SAFE_INTEGER;
  const priority = result.filter(isPriority).sort((a, b) => rank(a) - rank(b));
  const rest = result.filter((t) => !isPriority(t));
  return { plan: [...priority, ...rest], injected, displaced };
}

// ── Extra today-ARRIVALS warm, paid only from headroom (v1.12.1, pure) ──
// The ring revisits each today board ~every 3h, so between views an arrivals board was 1.5–2.6h
// stale (live audit Oct 4 2026) — and arrivals are the board whose statuses change all evening.
// One extra today-arrivals board per fire, rotated across the nine hubs, but ONLY while the day's
// metered spend is under the budget's paced line minus EXTRA_ARRIVALS_HEADROOM_UNITS: the extras can
// never take the day past budget − 150 (1,250 of the 1,400 production budget), and on a busy day
// they stop on their own. The math, on the Sep 27 – Oct 2 2026 spend (1,042–1,272 units/day, median
// ~1,107; the ring alone is 768): a typical day leaves ~140–200 units under that line ≈ 35–50 extra
// boards, so each arrivals board gets ~4–5 more warms a day (~8 → ~12, every ~2h instead of ~3h).
// The extra is skipped when the run is already slow (EXTRA_ARRIVALS_MAX_ELAPSED_MS), so the 300s
// budget holds: 180s + one 55s warm + the 3s gap + the ≤10s sightings backstop + the ≤20s Starlink
// ping + alerting ≈ 273s.
export const EXTRA_ARRIVALS_HEADROOM_UNITS = 150;
export const EXTRA_ARRIVALS_MAX_ELAPSED_MS = 180_000;
const ADB_UNITS_PER_BOARD = 4;

/** Operator kill switch: SCHEDULE_WARM_EXTRA_ARRIVALS=0/off/false/no turns the extra warm off. */
export function isExtraArrivalsWarmEnabled(): boolean {
  const setting = String(process.env.SCHEDULE_WARM_EXTRA_ARRIVALS ?? '').trim().toLowerCase();
  return !(setting === '0' || setting === 'off' || setting === 'false' || setting === 'no');
}

/** The budget-minus-headroom paced line, the same shape as getAdbPacedAllowance (1h head start). */
export function extraArrivalsSpendLine(budget: number, nowMs: number): number {
  const pool = budget - EXTRA_ARRIVALS_HEADROOM_UNITS;
  if (!(pool > 0)) return 0;
  const DAY_MS = 86_400_000;
  const msIntoDay = ((nowMs % DAY_MS) + DAY_MS) % DAY_MS;
  return Math.min(pool, Math.floor((pool * (msIntoDay + 3_600_000)) / DAY_MS));
}

/**
 * The extra today-arrivals board for this fire, or null (no headroom, a slow run, or every arrivals
 * board is already in the plan). Rotates over the hubs by warm slot, skipping boards the plan holds.
 */
export function pickExtraArrivalsTask(
  plan: WarmTask[],
  opts: { nowMs: number; unitsToday: number; budget: number; elapsedMs: number }
): WarmTask | null {
  if (!isExtraArrivalsWarmEnabled() || opts.elapsedMs > EXTRA_ARRIVALS_MAX_ELAPSED_MS) return null;
  if (opts.unitsToday + ADB_UNITS_PER_BOARD > extraArrivalsSpendLine(opts.budget, opts.nowMs)) return null;
  const slot = getWarmSlot(opts.nowMs);
  for (let k = 0; k < HUBS.length; k++) {
    const hub = HUBS[(((slot + k) % HUBS.length) + HUBS.length) % HUBS.length];
    const inPlan = plan.some((t) => t.hub === hub && t.dir === 'arrivals' && t.dayOffset === 0);
    if (!inPlan) return { hub, dir: 'arrivals', dayOffset: 0, label: 'today' };
  }
  return null;
}

export function buildScheduleWarmUrl(hub: string, dir: string, timestamp: number): string {
  // Background warming uses the PROVIDER (AeroDataBox) — the only source that returns the full
  // board from Vercel — and keeps officialFallback off so warming never burns FR24 credits, and
  // scraperFallback off (the FR24 scrape is Cloudflare-dead). forceRefresh=1 (honoured only with
  // the cron secret, sent by warmOne) bypasses the snapshot serve paths so the board is actually
  // refetched instead of echoed back from the frozen cache.
  const params = new URLSearchParams({
    hub,
    dir,
    timestamp: String(timestamp),
    officialFallback: '0',
    providerFallback: '1',
    scraperFallback: '0',
    forceRefresh: '1',
  });
  return `${BASE_URL}/api/schedule?${params}`;
}

async function warmOne(hub: string, dir: string, timestamp: number, label: string): Promise<{ key: string; result: any }> {
  const key = `${hub}-${dir}-${label}`;
  const url = buildScheduleWarmUrl(hub, dir, timestamp);
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 55000);
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'BlueBoard-CronWarmer/1.0',
        // Authorizes forceRefresh on /api/schedule (same secret Vercel cron sends to this handler).
        'Authorization': `Bearer ${process.env.CRON_SECRET}`,
      }
    });
    clearTimeout(timeout);
    const cdnStatus = resp.headers.get('x-vercel-cache') || 'unknown';
    if (resp.ok) {
      const data = await resp.json() as any;
      const flights = Number(data.total || 0);
      const partial = data.partial === true;
      const servedStale =
        data.stale === true ||
        data.degraded === true ||
        Number(data?.meta?.dataAge || 0) > STALE_WARM_MAX_AGE_S;
      // A warm that did not actually refetch warmed nothing: a CDN HIT means the lambda never
      // ran (the stored body may be a frozen board recorded as cached:false hours ago), and
      // cached:true means forceRefresh was silently ignored (e.g. CRON_SECRET missing from the
      // schedule lambda's env). Both must read as failures, not green oks.
      const notRefreshed = !servedStale && (/HIT/i.test(cdnStatus) || data.cached === true);
      const status = servedStale
        ? 'stale_served'
        : notRefreshed
          ? 'not_refreshed'
          : partial
            ? flights > 0 ? 'degraded_partial' : 'degraded_empty'
            : 'ok';
      return {
        key,
        result: {
          status,
          flights,
          partial,
          cached: data.cached || false,
          cdn: cdnStatus,
          dataAge: data?.meta?.dataAge,
          partialReason: data.meta?.partialReason,
          completeness: data.meta?.completeness,
        }
      };
    }
    return { key, result: { status: `http_${resp.status}`, cdn: cdnStatus } };
  } catch (e: any) {
    return { key, result: { status: 'error', message: e.message } };
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Vercel cron sends authorization header with CRON_SECRET (timing-safe, fails closed on
  // missing secret — see api/_cron-auth.ts).
  if (!isAuthorizedCronRequest(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const startedAt = Date.now();
  const results: Record<string, any> = {};
  // Schedule warms are tracked separately from the Starlink ping: starlink-data has a 5-tier
  // fallback chain and no AeroDataBox dependency, so it succeeds even mid-incident — counting it
  // into one shared bucket would turn an every-board-frozen run into a green 200 (the exact
  // masking this cron's 503 exists to kill).
  let scheduleWarmed = 0;
  let scheduleFailed = 0;
  let warmed = 0;
  let failed = 0;

  let warmPlan = buildWarmPlan();

  // Rollover first (F81), then IROPS: a hub that just passed local midnight gets its new today
  // boards warmed in this run instead of whenever the UTC ring pointer reaches them.
  const rollover = applyRolloverPriority(warmPlan, Date.now(), getWarmSlot());
  if (rollover.injected.length) {
    console.log(`Rollover warm priority: injected [${rollover.injected.join(', ')}] displacing [${rollover.displaced.join(', ')}]`);
  }
  warmPlan = rollover.plan;

  // IROPS priority: while hubs have active FAA programs, their today boards rotate fairly into
  // the front of each run's stride (capped at stride-1 injections; same task count — lowest-
  // priority ring slots are displaced, so the 300s budget holds). The warm slot seeds the
  // rotation so consecutive runs prioritize different disrupted hubs.
  try {
    const disruptions = await getDisruptedAirportsMap();
    const disruptedHubs = HUBS.filter((h) => (disruptions.get(h) || 0) > 0);
    if (disruptedHubs.length > 0) {
      const adjusted = applyIropsPriority(warmPlan, disruptedHubs, getWarmSlot());
      console.log(
        `IROPS warm priority engaged for ${disruptedHubs.map((h) => `${h}(${disruptions.get(h)}m)`).join(', ')}: ` +
        (adjusted.injected.length
          ? `injected [${adjusted.injected.join(', ')}] displacing [${adjusted.displaced.join(', ')}]`
          : 'disrupted-hub boards already in this stride; reordered to run first')
      );
      warmPlan = adjusted.plan;
    }
  } catch (e: any) {
    console.warn('IROPS warm priority lookup failed; using base ring plan:', e?.message || e);
  }

  for (let i = 0; i < warmPlan.length; i++) {
    const task = warmPlan[i];
    // getStartOfHubDay (NOT irops' getStartOfDayForHub): the IROPS helper rolls back to YESTERDAY
    // before 6 AM hub-local and adds DST-naive +86400 for tomorrow, so ~25% of warm slots used to
    // spend their quota on mislabeled day keys no user-facing view ever reads.
    const ts = getStartOfHubDay(task.hub, task.dayOffset);
    const { key, result } = await warmOne(task.hub, task.dir, ts, task.label);
    results[key] = result;
    if (result.status === 'ok') { scheduleWarmed++; warmed++; } else { scheduleFailed++; failed++; }
    if (i < warmPlan.length - 1) {
      await new Promise(r => setTimeout(r, getInterTaskDelayMs()));
    }
  }

  // v1.12.1: one extra today-arrivals board, paid only from spend headroom (see pickExtraArrivalsTask).
  try {
    await hydrateAdbSpend();
    const extra = pickExtraArrivalsTask(warmPlan, {
      nowMs: Date.now(),
      unitsToday: getAdbUnitsToday(),
      budget: getAdbDailyUnitBudget(),
      elapsedMs: Date.now() - startedAt,
    });
    if (extra) {
      await new Promise(r => setTimeout(r, getInterTaskDelayMs()));
      const { key, result } = await warmOne(extra.hub, extra.dir, getStartOfHubDay(extra.hub, 0), extra.label);
      results[key] = { ...result, extra: true };
      if (result.status === 'ok') { scheduleWarmed++; warmed++; } else { scheduleFailed++; failed++; }
      warmPlan = [...warmPlan, extra];
    }
  } catch (e: any) {
    console.warn('warm-schedules extra arrivals warm skipped:', e?.message || e);
  }

  // Best-effort snapshot GC: prune schedule_snapshots rows past their TTL so the table doesn't
  // grow without bound (cache_key embeds a per-day ts, so every calendar day mints fresh keys and
  // nothing else deletes the stale ones). At most once per run; a failure never fails the cron.
  try {
    await cleanupExpiredSnapshots();
  } catch (e: any) {
    console.warn('warm-schedules snapshot cleanup failed:', e?.message || e);
  }

  // Phase 2 backstop: harvest reg sightings once per fire so the ledger stays populated
  // overnight when no browser is polling /api/fr24-feed. Free upstream (public FR24 feed,
  // same endpoint fr24-feed.ts proxies); failure never fails the cron. 10s timeout keeps
  // the run inside the 300s maxDuration budget (see the budget math comment at the top).
  try {
    // The complete United feed (api/_united-feed.ts): Express flights FR24 files under their
    // operator get sightings too.
    const feed = await fetchUnitedFeed(10000);
    if (feed) {
      const recorded = await recordFeedSightings(parseFr24Feed(feed));
      results.regSightings = { ok: true, recorded };
    } else {
      results.regSightings = { ok: false, status: 'http-error' };
    }
  } catch (e: any) {
    console.warn('warm-schedules reg-sightings backstop failed:', e?.message || e);
    results.regSightings = { ok: false, error: String(e?.message || e) };
  }

  // Phase 1.5: warm the Starlink edge cache. The CDN keys on the query string, so the two
  // URLs the dashboard actually requests (?fields=roster at boot, ?fields=flights when the
  // Starlink tab opens — F58) are the ones warmed; the bare URL no client asks for is not.
  // One shared 20s budget: the first request fills the function's memory cache, so the
  // second is served from it. Both roll up into the single 'starlink-data' result.
  try {
    const slController = new AbortController();
    const slTimeout = setTimeout(() => slController.abort(), 20000);
    let status = 'ok';
    try {
      for (const fields of ['roster', 'flights']) {
        const slResp = await fetch(`${BASE_URL}/api/starlink-data?fields=${fields}`, {
          signal: slController.signal,
          headers: { 'User-Agent': 'BlueBoard-CronWarmer/1.0' },
        });
        if (!slResp.ok && status === 'ok') status = `http_${slResp.status}`;
      }
    } finally {
      clearTimeout(slTimeout);
    }
    results['starlink-data'] = { status };
    if (status === 'ok') warmed++; else failed++;
  } catch (e: any) {
    results['starlink-data'] = { status: 'error', message: e.message };
    failed++;
  }

  // Estimate the metered AeroDataBox spend so the monthly budget is visible in the logs.
  // A freshly-fetched (non-cached) non-empty board = 2 FIDS calls × 2 units/call = 4 units.
  const freshBoards = Object.entries(results).filter(
    ([key, r]) => key !== 'starlink-data' && r && r.cached === false && typeof r.flights === 'number' && r.flights > 0
  ).length;
  const estUnits = freshBoards * 4;
  console.log(
    `Cron warm-schedules: ${warmed} warmed, ${failed} failed, ~${estUnits} AeroDataBox units (${freshBoards} fresh boards)`,
    { warmPlan, results }
  );

  // Operational alerting (env-gated; no-op without ALERT_WEBHOOK_URL). The half-hourly warm cron is
  // the natural heartbeat for the schedule pipeline: alert on the signatures that mean the live
  // site is degraded RIGHT NOW or money is about to run out, not on every transient blip.
  // (Audit P1: no-alerting-blind-pipeline; supersedes PR #168, whose `failed > warmed` condition
  // predates the schedule/starlink counter split and the stale_served/not_refreshed statuses.)
  try {
    const scheduleEntries = Object.entries(results).filter(([k]) => k !== 'starlink-data');
    const byStatus = (...statuses: string[]) =>
      scheduleEntries.filter(([, r]) => statuses.includes(r?.status)).map(([k]) => k);
    const frozen = byStatus('stale_served', 'not_refreshed'); // the frozen-board signature
    const emptyBoards = byStatus('degraded_empty');
    // Nonempty-but-incomplete boards: a window 429'd/timed out so the board fetched fewer flights
    // than it should. The schedule run still returns a NONEMPTY board (no 503, no frozen/empty
    // signature), so without this a busy hub flapping to a partial board never pages.
    const degradedPartial = byStatus('degraded_partial');
    const erroredKeys = scheduleEntries
      .filter(([, r]) => r?.status === 'error' || String(r?.status || '').startsWith('http_'))
      .map(([k]) => k);
    const starlinkStatus = results['starlink-data']?.status;

    await hydrateAdbSpend();
    const unitsToday = getAdbUnitsToday();
    const budget = getAdbDailyUnitBudget();
    const budgetHot = budget > 0 && unitsToday >= budget * 0.8;

    const totalFailure = scheduleWarmed === 0 && scheduleFailed > 0;
    if (totalFailure || frozen.length > 0 || emptyBoards.length > 0 || degradedPartial.length > 0 || budgetHot || (starlinkStatus && starlinkStatus !== 'ok')) {
      await sendAlert('⚠️ Blue Board schedule pipeline degraded', [
        `warmed=${scheduleWarmed} failed=${scheduleFailed} (plan size ${warmPlan.length}, ~${estUnits} units this run)`,
        frozen.length ? `frozen/stale-served boards (warm did NOT refetch): ${frozen.join(', ')}` : '',
        emptyBoards.length ? `0-flight boards: ${emptyBoards.join(', ')}` : '',
        degradedPartial.length ? `partial boards (nonempty but a window failed — incomplete): ${degradedPartial.join(', ')}` : '',
        erroredKeys.length ? `errors/http: ${erroredKeys.join(', ')}` : '',
        budgetHot ? `AeroDataBox budget: ${unitsToday}/${budget} units today (≥80%)` : '',
        starlinkStatus && starlinkStatus !== 'ok' ? `starlink: ${starlinkStatus}` : '',
      ].filter(Boolean));
    }
  } catch (e: any) {
    // Alerting must never break the cron itself.
    console.error('warm-schedules alerting block failed:', e?.message || e);
  }

  // A run that warmed NO schedule board is an incident, not a success — return 5xx so Vercel's
  // built-in cron monitoring (and any uptime check on this path) goes red instead of logging a
  // quiet 200. Gated on the schedule counters only; see the counter comment above.
  const statusCode = scheduleWarmed === 0 && scheduleFailed > 0 ? 503 : 200;
  return res.status(statusCode).json({
    warmed,
    failed,
    scheduleWarmed,
    scheduleFailed,
    warmPlan,
    results,
    timestamp: new Date().toISOString()
  });
}
