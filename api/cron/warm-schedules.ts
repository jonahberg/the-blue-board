// Vercel Cron Job: rotates through the 2-day schedule window (today/tomorrow) so exact
// hub/day/direction snapshots stay warm at the CDN + Supabase snapshot. Yesterday is served
// on-demand (historical board, rarely viewed) to conserve the metered AeroDataBox quota.
// Config in vercel.json: { "path": "/api/cron/warm-schedules", "schedule": "0 */2 * * *" }

import type { VercelRequest, VercelResponse } from '../types.js';
import { getStartOfDayForHub } from '../irops.js';

const HUBS = ['ORD', 'DEN', 'IAH', 'EWR', 'SFO', 'IAD', 'LAX', 'NRT', 'GUM'];
// Serialized with INTER_TASK_DELAY_MS between tasks. Budget math: each task worst-case is ~58s
// (55s schedule fetch + 3s gap). maxDuration for this cron is 300s in vercel.json, so the clamp
// ceiling of 4 tasks → 4 × 58s = 232s stays under the Lambda limit. Default is 2 to bound the
// metered AeroDataBox spend: 2 boards/run × 12 runs/day × 4 units/board ≈ 96 units/day worst case
// (~2,880/mo), well inside a paid tier. Serial (not Promise.allSettled) respects the 1 req/s limit.
const WARM_TASKS_PER_RUN = Math.max(1, Math.min(4, Number(process.env.SCHEDULE_WARM_TASKS_PER_RUN || 2) || 2));
const INTER_TASK_DELAY_MS = Math.max(0, Number(process.env.SCHEDULE_WARM_DELAY_MS || 3000) || 3000);
const BASE_URL = process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  : process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'https://theblueboard.co';

// Yesterday (dayOffset -1) is intentionally NOT warmed — its board is historical/stable and
// rarely viewed, so it loads on-demand (and caches) instead of burning quota every cycle.
const WINDOW_TASKS = [
  { dayOffset: 0, label: 'today', dir: 'departures' },
  { dayOffset: 0, label: 'today', dir: 'arrivals' },
  { dayOffset: 1, label: 'tomorrow', dir: 'departures' },
  { dayOffset: 1, label: 'tomorrow', dir: 'arrivals' },
] as const;

type WarmTask = {
  hub: string;
  dir: 'departures' | 'arrivals';
  dayOffset: -1 | 0 | 1;
  label: 'yesterday' | 'today' | 'tomorrow';
};

export function buildWarmPlan(nowMs = Date.now()): WarmTask[] {
  const tasks: WarmTask[] = [];
  for (const task of WINDOW_TASKS) {
    for (const hub of HUBS) {
      tasks.push({
        hub,
        dir: task.dir,
        dayOffset: task.dayOffset,
        label: task.label,
      });
    }
  }

  // Advance exactly one WARM_TASKS_PER_RUN stride per cron fire so consecutive fires cover the
  // window list sequentially with no gaps. SLOT_MS MUST match the cron interval in vercel.json
  // (currently every 2h): a 15-min slot here while the cron fires every 2h would stride 8× per
  // fire and skip most windows (only every Nth pair would ever warm). Update both together.
  const SLOT_MS = 2 * 60 * 60 * 1000; // = vercel.json cron interval (0 */2 * * *)
  const slot = Math.floor(nowMs / SLOT_MS);
  const start = (slot * WARM_TASKS_PER_RUN) % tasks.length;
  const plan: WarmTask[] = [];
  for (let i = 0; i < Math.min(WARM_TASKS_PER_RUN, tasks.length); i++) {
    plan.push(tasks[(start + i) % tasks.length]);
  }
  return plan;
}

export function buildScheduleWarmUrl(hub: string, dir: string, timestamp: number): string {
  // Background warming uses the PROVIDER (AeroDataBox) — the only source that returns the full
  // board from Vercel — and keeps officialFallback off so warming never burns FR24 credits, and
  // scraperFallback off (the FR24 scrape is Cloudflare-dead). With SCHEDULE_SOURCE_PRIORITY=provider
  // this populates the CDN + Supabase snapshots so live user traffic is served from cache.
  const params = new URLSearchParams({
    hub,
    dir,
    timestamp: String(timestamp),
    officialFallback: '0',
    providerFallback: '1',
    scraperFallback: '0',
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
      headers: { 'User-Agent': 'BlueBoard-CronWarmer/1.0' }
    });
    clearTimeout(timeout);
    const cdnStatus = resp.headers.get('x-vercel-cache') || 'unknown';
    if (resp.ok) {
      const data = await resp.json() as any;
      const flights = Number(data.total || 0);
      const partial = data.partial === true;
      const status = partial
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
  // Vercel cron sends authorization header with CRON_SECRET
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const results: Record<string, any> = {};
  let warmed = 0;
  let failed = 0;

  // There are 36 total windows (9 hubs × 2 days × 2 directions); yesterday is on-demand.
  // Keep the default conservative for the metered provider, and use the seed script for first-fill.
  const warmPlan = buildWarmPlan();
  for (let i = 0; i < warmPlan.length; i++) {
    const task = warmPlan[i];
    const ts = getStartOfDayForHub(task.hub) + (task.dayOffset * 86400);
    const { key, result } = await warmOne(task.hub, task.dir, ts, task.label);
    results[key] = result;
    if (result.status === 'ok') warmed++; else failed++;
    if (i < warmPlan.length - 1) {
      await new Promise(r => setTimeout(r, INTER_TASK_DELAY_MS));
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
  return res.status(200).json({
    warmed,
    failed,
    warmPlan,
    results,
    timestamp: new Date().toISOString()
  });
}
