// Vercel Cron Job: rotates through the 3-day schedule window (yesterday/today/tomorrow)
// so exact hub/day/direction snapshots stay available across deploys and cold starts.
// Config in vercel.json: { "path": "/api/cron/warm-schedules", "schedule": "*/15 * * * *" }

import type { VercelRequest, VercelResponse } from '../types.js';
import { getStartOfDayForHub } from '../irops.js';

const HUBS = ['ORD', 'DEN', 'IAH', 'EWR', 'SFO', 'IAD', 'LAX', 'NRT', 'GUM'];
// Serialized with INTER_TASK_DELAY_MS between tasks. Budget math: each task
// worst-case is ~58s (55s schedule fetch + 3s gap). maxDuration for this cron
// is 300s in vercel.json, so hard-cap at 4 tasks → 4 × 58s = 232s, under the
// Lambda limit. Keeping this serial rather than Promise.allSettled avoids
// fanning 8 parallel requests at FR24's per-IP rate limit.
const WARM_TASKS_PER_RUN = Math.max(1, Math.min(4, Number(process.env.SCHEDULE_WARM_TASKS_PER_RUN || 4) || 4));
const INTER_TASK_DELAY_MS = Math.max(0, Number(process.env.SCHEDULE_WARM_DELAY_MS || 3000) || 3000);
const BASE_URL = process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  : process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'https://theblueboard.co';

const WINDOW_TASKS = [
  { dayOffset: 0, label: 'today', dir: 'departures' },
  { dayOffset: 0, label: 'today', dir: 'arrivals' },
  { dayOffset: 1, label: 'tomorrow', dir: 'departures' },
  { dayOffset: 1, label: 'tomorrow', dir: 'arrivals' },
  { dayOffset: -1, label: 'yesterday', dir: 'departures' },
  { dayOffset: -1, label: 'yesterday', dir: 'arrivals' },
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

  const slot = Math.floor(nowMs / (15 * 60 * 1000));
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

  // There are 54 total windows (9 hubs × 3 days × 2 directions).
  // Keep the default conservative for FR24, and use the seed script for first-fill.
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

  console.log(`Cron warm-schedules: ${warmed} warmed, ${failed} failed`, { warmPlan, results });
  return res.status(200).json({
    warmed,
    failed,
    warmPlan,
    results,
    timestamp: new Date().toISOString()
  });
}
