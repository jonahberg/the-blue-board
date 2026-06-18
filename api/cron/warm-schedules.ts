// Vercel Cron Job: rotates through the 2-day schedule window (today/tomorrow) so exact
// hub/day/direction snapshots stay warm at the CDN + Supabase snapshot. Yesterday is served
// on-demand (historical board, rarely viewed) to conserve the metered AeroDataBox quota.
// Config in vercel.json: { "path": "/api/cron/warm-schedules", "schedule": "0 * * * *" }
//
// Warm requests send forceRefresh=1 + the cron secret so /api/schedule actually REFETCHES the
// board. Without it the handler serves the existing complete snapshot back to the cron, reports
// "ok", and a board fetched once (usually the evening before, as "tomorrow") is never refreshed
// again all day — the frozen-board failure mode this cron exists to prevent.

import type { VercelRequest, VercelResponse } from '../types.js';
import { UNITED_HUBS } from '../_hubs.js';
import { isAuthorizedCronRequest } from '../_cron-auth.js';
import { sendAlert } from '../_alert.js';
import { hydrateAdbSpend, getAdbUnitsToday, getAdbDailyUnitBudget } from '../_cost-state.js';
import { getStartOfHubDay } from '../../src/lib/hubTz.js';

const HUBS = UNITED_HUBS;
// Serialized with INTER_TASK_DELAY_MS between tasks. Budget math: each task worst-case is ~58s
// (55s schedule fetch + 3s gap). maxDuration for this cron is 300s in vercel.json, so the clamp
// ceiling of 4 tasks → 4 × 55s + 3 × 3s = 229s, plus the ~20s starlink ping and ~5s alerting
// (≈254s), stays under the Lambda limit. Default is 4 on an HOURLY cron: 4 tasks × 24 fires = 96
// warm slots/day = 1.33 passes over the 72-task ring, so each today board warms 4×/day (~every 6h
// — the low-traffic intl hubs NRT/LAX/IAD no longer drift 8–10h stale) and each tomorrow board
// ~1.33×/day. That is ≈ 96 fresh boards × 4 units = 384 AeroDataBox units/day. (Default was 3 →
// 8h cadence / 288 units/day; the +96 units/day buys the fresher cadence and stays far under the
// 3× organic-budget bypass ceiling.) Serial (not Promise.allSettled) respects the 1 req/s limit.
function envNumber(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}
// Read per call (not at module load) so a runtime env change — or a test — actually takes effect,
// and so an explicit '0' delay is honoured instead of being swallowed by `|| fallback`.
const getWarmTasksPerRun = () => Math.max(1, Math.min(4, Math.floor(envNumber('SCHEDULE_WARM_TASKS_PER_RUN', 4))));
const getInterTaskDelayMs = () => Math.max(0, envNumber('SCHEDULE_WARM_DELAY_MS', 3000));
// A warm that came back stale/degraded did not warm anything — the handler served a frozen
// fallback instead of refetching. Anything older than the clean-board TTL (6h) counts as failed.
const STALE_WARM_MAX_AGE_S = 21600;
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
// the default stride of 4/fire the 72-slot ring completes ~1.33×/day, so each today board
// refreshes ~every 6h (delays/cancellations stay current) and each tomorrow board ~1.33×/day
// (schedule data is stable; it just needs to exist before midnight). TODAY_ROUNDS stays 3 so the
// ring length (72) divides evenly by the stride (4) — that clean tiling is what gives an even 6h
// spacing with no skipped windows; bumping TODAY_ROUNDS to 4+ would make the ring (90+) outrun a
// single day's 96 slots and leave some tomorrow boards unwarmed.
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

export function buildWarmPlan(nowMs = Date.now()): WarmTask[] {
  const tasks = buildWarmRing();

  // Advance exactly one WARM_TASKS_PER_RUN stride per cron fire so consecutive fires cover the
  // ring sequentially with no gaps. SLOT_MS MUST match the cron interval in vercel.json
  // (currently hourly): a 15-min slot here while the cron fires hourly would stride 4× per fire
  // and skip most windows. Update both together.
  const SLOT_MS = 60 * 60 * 1000; // = vercel.json cron interval (0 * * * *)
  const tasksPerRun = getWarmTasksPerRun();
  const slot = Math.floor(nowMs / SLOT_MS);
  const start = (slot * tasksPerRun) % tasks.length;
  const plan: WarmTask[] = [];
  for (let i = 0; i < Math.min(tasksPerRun, tasks.length); i++) {
    plan.push(tasks[(start + i) % tasks.length]);
  }
  return plan;
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

  const results: Record<string, any> = {};
  // Schedule warms are tracked separately from the Starlink ping: starlink-data has a 5-tier
  // fallback chain and no AeroDataBox dependency, so it succeeds even mid-incident — counting it
  // into one shared bucket would turn an every-board-frozen run into a green 200 (the exact
  // masking this cron's 503 exists to kill).
  let scheduleWarmed = 0;
  let scheduleFailed = 0;
  let warmed = 0;
  let failed = 0;

  const warmPlan = buildWarmPlan();
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

  // Phase 1.5: warm Starlink data cache (single fast request)
  try {
    const slController = new AbortController();
    const slTimeout = setTimeout(() => slController.abort(), 20000);
    const slResp = await fetch(`${BASE_URL}/api/starlink-data`, {
      signal: slController.signal,
      headers: { 'User-Agent': 'BlueBoard-CronWarmer/1.0' },
    });
    clearTimeout(slTimeout);
    results['starlink-data'] = { status: slResp.ok ? 'ok' : `http_${slResp.status}` };
    if (slResp.ok) warmed++; else failed++;
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

  // Operational alerting (env-gated; no-op without ALERT_WEBHOOK_URL). The hourly warm cron is
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
