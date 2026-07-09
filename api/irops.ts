// Server-side IROPS aggregation — fetches schedule data for all UA hubs
// via the internal /api/schedule endpoint (which benefits from cron cache warming),
// computes disruption metrics, caches for 15 minutes.

import type { VercelRequest, VercelResponse } from './types.js';
import { createRateLimiter } from './_rate-limit.js';
import { CacheStore } from './_cache.js';

const isRateLimited = createRateLimiter('irops', 60);

const HUBS = ['ORD', 'DEN', 'IAH', 'EWR', 'SFO', 'IAD', 'LAX', 'NRT', 'GUM'];
export const HUB_TZ: Record<string, string> = {ORD:'America/Chicago',DEN:'America/Denver',IAH:'America/Chicago',EWR:'America/New_York',SFO:'America/Los_Angeles',IAD:'America/New_York',LAX:'America/Los_Angeles',NRT:'Asia/Tokyo',GUM:'Pacific/Guam'};
const iropsCache = new CacheStore('irops', { maxSize: 1, defaultTTL: 15 * 60 * 1000 });
let fetching: Promise<any> | null = null;
// Persistent per-hub cache — survives full refresh failures
let hubCache: Record<string, { flights: any[]; fetchedAt: number }> = {};

const BASE_URL = process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  : process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'https://theblueboard.co';

async function fetchHubFromScheduleAPI(hub: string, timestamp: number): Promise<any[]> {
  // IROPS only needs aggregate departure counts and tolerates empty per-hub results, so it must
  // NOT trigger the paid FR24/AeroDataBox/ScrapingBee fallbacks. Disabling them also makes this
  // request's query string byte-identical to the warm cron's buildScheduleWarmUrl(), so IROPS
  // reuses cron-warmed CDN snapshots instead of paying to recompute on every miss.
  // (We replicate the param string inline rather than importing buildScheduleWarmUrl to avoid a
  // circular import: warm-schedules.ts already imports getStartOfDayForHub from this file.)
  const params = new URLSearchParams({
    hub,
    dir: 'departures',
    timestamp: String(timestamp),
    officialFallback: '0',
    providerFallback: '0',
    scraperFallback: '0',
  });
  const url = `${BASE_URL}/api/schedule?${params}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 55000);
  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'BlueBoard-IROPS/1.0' }
    });
    clearTimeout(timeout);
    if (!resp.ok) return [];
    const data = await resp.json();
    return (data as any).flights || [];
  } catch (e: any) {
    clearTimeout(timeout);
    console.error(`IROPS: Failed to fetch schedule for ${hub}:`, e.message);
    return [];
  }
}

interface HubMetric {
  total: number;
  cancellations: number;
  delayed30: number;
  delayed60: number;
  diversions: number;
  operated: number;
  onTime: number;
}

interface WorstDelay {
  ident: string;
  route: string;
  delay: number;
}

// 'canceled_uncertain' is AeroDataBox's soft-cancel state ("Likely Canceled"); it groups under
// Canceled everywhere else in the UI, so the server-side metrics must count it too — otherwise
// likely-canceled rows vanish from the IROPS index and the Delays tab cancellation counts.
const CANCELED_STATUSES = new Set(['canceled', 'cancelled', 'canceled_uncertain']);

// F073: a flight "held on the ground" during a ground stop keeps a pre-departure
// status (scheduled/delayed) with NO real departure while its scheduled time slides
// into the past. The old code counted it toward totalFlights but never toward
// delayed30/60, so the IROPS index UNDERstated disruption exactly during ground stops
// (the "MINOR DISRUPTION at 13.6 vs the ≥15 SIGNIFICANT threshold" case). Treat such
// an overdue flight as delayed by the minutes elapsed since its scheduled departure —
// the same time-inference philosophy the board uses for "Departed*" rows.
//
// A flight is NOT overdue once it has left (departed/en-route/landed/diverted) or is
// canceled — those are terminal/resolved and counted elsewhere. We deliberately keep a
// fixed 30/60-min bucketing (rather than importing the schedule pipeline's disruption-
// scaled inference grace) so this module stays self-contained; the buckets already
// mirror the >30/>60 real-delay thresholds below. Returns 0 when not overdue.
//
// F073b: the rule above, unbounded, manufactures disruption. The board carries a FULL
// LOCAL DAY, and a row whose status never advanced to a terminal value is indistinguishable
// from a held flight — so a 07:00 departure that flew but never got a "departed" status was
// still accruing overdue minutes at 23:00. Measured on production 2026-07-08: 548 rows
// scored overdue >30m, 122 of them beyond 6 hours, worst 1028 minutes — a 17.1-hour "hold"
// on a 90-minute regional hop — driving the index to 74.4 against a SIGNIFICANT threshold
// of 15, and putting impossible phantom holds in the user-visible worstDelays list.
//
// Two guards, in order of how much we trust them:
//   1. Scheduled arrival. A plane cannot still be awaiting departure once the clock has
//      passed the time it was scheduled to LAND. This is decisive and removes 332 of the
//      548 (61%) with no policy judgment at all.
//   2. An absolute cap, for the ~25 production rows that carry no scheduled arrival.
//      Beyond it we genuinely cannot tell a held flight from a stale row, so we
//      under-report rather than fabricate — the same honest-degradation rule the boards
//      and the freshness chip already follow. 240min sits above the FAA's 3-hour tarmac
//      limit, past which a hold is cancelled rather than held.
// Together: overdue-driven delayed30 falls 548 -> 186 and the worst hold 1028 -> 235 min,
// while the F073 ground-stop signal the rule exists for is preserved (see tests).
const OVERDUE_MAX_MIN = 240;

function overdueDelayMinutes(fl: any, status: string, nowSec: number): number {
  if (CANCELED_STATUSES.has(status)) return 0;
  if (status === 'departed' || status === 'en-route' || status === 'landed' || status === 'diverted') return 0;
  if (fl.time?.real?.departure) return 0;
  const schedT = fl.time?.scheduled?.departure;
  if (!schedT || !nowSec || nowSec <= schedT) return 0;

  const schedArr = fl.time?.scheduled?.arrival;
  if (schedArr && nowSec > schedArr) return 0;

  const overdue = Math.round((nowSec - schedT) / 60);
  return overdue > OVERDUE_MAX_MIN ? 0 : overdue;
}

export function computeMetrics(flightsByHub: Record<string, any[]>, nowSec: number = Math.floor(Date.now() / 1000)) {
  let allFlights: any[] = [];
  const hubMetrics: Record<string, HubMetric> = {};

  for (const [hub, flights] of Object.entries(flightsByHub)) {
    allFlights = allFlights.concat(flights);
    hubMetrics[hub] = { total: flights.length, cancellations: 0, delayed30: 0, delayed60: 0, diversions: 0, operated: 0, onTime: 0 };

    for (const fl of flights) {
      const status = fl.status?.generic?.status?.text?.toLowerCase() || '';
      if (CANCELED_STATUSES.has(status)) { hubMetrics[hub].cancellations++; continue; }
      if (status === 'diverted') hubMetrics[hub].diversions++;

      // F073: held/overdue flights count toward delayed30/60 (numerator only; total is
      // untouched so the denominator semantics are unchanged). overdueDelayMinutes returns
      // 0 for anything that has already departed, so operated flights are unaffected.
      const overdueMin = overdueDelayMinutes(fl, status, nowSec);
      if (overdueMin > 30) hubMetrics[hub].delayed30++;
      if (overdueMin > 60) hubMetrics[hub].delayed60++;

      const hasOperated = status === 'departed' || status === 'en-route' || status === 'landed' || status === 'diverted';
      const realDep = fl.time?.real?.departure;
      if (!hasOperated || !realDep) continue;

      const schedT = fl.time?.scheduled?.departure;
      if (!schedT) continue;

      // Exclude degraded synthetic rows (live-feed rescue / schedule-derived-from-actual): their
      // scheduled time equals the actual, so they always score on-time and inflate hub OTP exactly
      // when the FR24 feed is degraded — mirrors the dashboard's per-board exclusion.
      // (Audit P1: degraded-rows-inflate-hub-otp.)
      if (fl._source?.liveFeedFallback) continue;
      if (fl._source?.scheduleTimeDerivedFromActual?.departure || fl._source?.scheduleTimeDerivedFromActual?.arrival) continue;

      hubMetrics[hub].operated++;
      if (realDep <= schedT + 1800) {
        hubMetrics[hub].onTime++;
      } else {
        const delayMin = Math.round((realDep - schedT) / 60);
        if (delayMin > 30) hubMetrics[hub].delayed30++;
        if (delayMin > 60) hubMetrics[hub].delayed60++;
      }
    }
  }

  let cancellations = 0, delayed30 = 0, delayed60 = 0, diversions = 0;
  const worstDelays: WorstDelay[] = [];

  for (const fl of allFlights) {
    const status = fl.status?.generic?.status?.text?.toLowerCase() || '';
    if (CANCELED_STATUSES.has(status)) cancellations++;
    if (status === 'diverted') diversions++;

    const schedT = fl.time?.scheduled?.departure || 0;
    const actT = fl.time?.real?.departure || 0;
    if (schedT && actT && actT > schedT) {
      const delayMin = Math.round((actT - schedT) / 60);
      if (delayMin > 30) delayed30++;
      if (delayMin > 60) delayed60++;
      if (delayMin > 15) {
        const ident = fl.identification?.number?.default || '?';
        const orig = fl.airport?.origin?.code?.iata || '?';
        const dest = fl.airport?.destination?.code?.iata || '?';
        worstDelays.push({ ident, route: `${orig}→${dest}`, delay: delayMin });
      }
    } else {
      // F073: held/overdue flights (past schedule, not yet departed) — the core of a
      // ground stop. overdueDelayMinutes is 0 for anything already departed, so this
      // never double-counts a flight already scored above.
      const overdueMin = overdueDelayMinutes(fl, status, nowSec);
      if (overdueMin > 30) delayed30++;
      if (overdueMin > 60) delayed60++;
      if (overdueMin > 15) {
        const ident = fl.identification?.number?.default || '?';
        const orig = fl.airport?.origin?.code?.iata || '?';
        const dest = fl.airport?.destination?.code?.iata || '?';
        worstDelays.push({ ident, route: `${orig}→${dest}`, delay: overdueMin });
      }
    }
  }

  worstDelays.sort((a, b) => b.delay - a.delay);

  const totalFlights = allFlights.length;
  // F017: delayed30 is CUMULATIVE (every delay >30m, including those >60m) so the UI's
  // ">30m" / ">60m" cards stay backward-compatible and truthful. The SCORE, however,
  // must weight each flight once: a 61-min delay is a single 2-point event, not 1+2=3
  // (which had equalled a cancellation). Split into an exclusive 30–60m bucket (×1) and
  // the 60m+ bucket (×2).
  const delayed30to60 = Math.max(0, delayed30 - delayed60);
  const score = totalFlights > 0
    ? ((cancellations * 3 + delayed60 * 2 + delayed30to60 + diversions * 2) / totalFlights * 100)
    : 0;

  return {
    score: parseFloat(score.toFixed(1)),
    totalFlights,
    cancellations,
    delayed30,
    delayed60,
    diversions,
    worstDelays: worstDelays.slice(0, 8),
    hubMetrics,
    generatedAt: new Date().toISOString()
  };
}

export function getStartOfDayForHub(hub: string): number {
  const tz = HUB_TZ[hub] || 'America/New_York';
  const now = new Date();
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  });
  const parts = fmt.formatToParts(now);
  const get = (type: string) => parseInt(parts.find(p => p.type === type)?.value || '0');
  const hour = get('hour'), minute = get('minute'), second = get('second');

  // DST-safe midnight calculation: compute an approximate midnight, then verify
  // and adjust. The naive formula (now - localSecondsSinceMidnight) can be off by
  // ±1 hour across DST transitions because the UTC offset at midnight may differ
  // from the current offset.
  const localSecsSinceMidnight = hour * 3600 + minute * 60 + second;
  const approxMidnight = Math.floor(now.getTime() / 1000) - localSecsSinceMidnight;

  // Verify: what local time does our guess correspond to?
  const verifyParts = fmt.formatToParts(new Date(approxMidnight * 1000));
  const vH = parseInt(verifyParts.find(p => p.type === 'hour')?.value || '0');
  const vM = parseInt(verifyParts.find(p => p.type === 'minute')?.value || '0');
  const vS = parseInt(verifyParts.find(p => p.type === 'second')?.value || '0');
  const drift = vH * 3600 + vM * 60 + vS;

  // Correct for DST drift (typically ±3600s on transition days)
  const startOfToday = drift > 43200
    ? approxMidnight + (86400 - drift)  // Went past midnight into previous day
    : approxMidnight - drift;            // Fine-tune forward to exact midnight

  // Before 6 AM local: no flights have departed yet, show yesterday's data
  if (hour < 6) return startOfToday - 86400;
  return startOfToday;
}

async function buildIropsData() {
  const flightsByHub: Record<string, any[]> = {};

  // Fetch all hubs in parallel via the internal schedule API (cached by cron)
  const results = await Promise.allSettled(
    HUBS.map(async (hub) => {
      const flights = await fetchHubFromScheduleAPI(hub, getStartOfDayForHub(hub));
      return { hub, flights };
    })
  );

  for (const result of results) {
    if (result.status === 'fulfilled') {
      const { hub, flights } = result.value;
      if (flights && flights.length > 0) {
        flightsByHub[hub] = flights;
        hubCache[hub] = { flights, fetchedAt: Date.now() };
      } else if (hubCache[hub] && (Date.now() - hubCache[hub].fetchedAt) < 60 * 60 * 1000) {
        console.log(`IROPS: Using cached data for ${hub} (age: ${Math.round((Date.now() - hubCache[hub].fetchedAt) / 60000)}m)`);
        flightsByHub[hub] = hubCache[hub].flights;
      } else {
        flightsByHub[hub] = [];
      }
    } else {
      const hub = HUBS[results.indexOf(result)];
      console.error(`IROPS: Error fetching ${hub}:`, result.reason?.message);
      if (hubCache[hub] && (Date.now() - hubCache[hub].fetchedAt) < 60 * 60 * 1000) {
        flightsByHub[hub] = hubCache[hub].flights;
      } else {
        flightsByHub[hub] = [];
      }
    }
  }

  return computeMetrics(flightsByHub);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const origin = req.headers?.origin || '';
  if (origin && origin !== 'https://theblueboard.co' && !/^http:\/\/localhost(:\d+)?$/.test(origin)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  if (isRateLimited(req)) {
    return res.status(429).json({ error: 'Rate limited — try again shortly' });
  }

  try {
    const cached = iropsCache.get('irops');
    if (cached) {
      res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=300');
      return res.status(200).json({ ...cached, cached: true });
    }

    if (fetching) {
      try {
        const result = await fetching;
        res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=300');
        return res.status(200).json({ ...result, cached: true });
      } catch (e) {
        console.error('IROPS concurrent fetch error:', e);
        const stale = iropsCache.getStale('irops', 60 * 60 * 1000);
        if (stale) {
          res.setHeader('Cache-Control', 's-maxage=60');
          return res.status(200).json({ ...stale, cached: true, stale: true });
        }
        return res.status(502).json({ error: 'Failed to compute IROPS data' });
      }
    }

    try {
      fetching = buildIropsData();
      const result = await fetching;
      iropsCache.set('irops', result);
      res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=300');
      return res.status(200).json({ ...result, cached: false });
    } catch (e) {
      console.error('IROPS API error:', e);
      // Return stale cache if available (up to 1 hour past expiry)
      const stale = iropsCache.getStale('irops', 60 * 60 * 1000);
      if (stale) {
        res.setHeader('Cache-Control', 's-maxage=60');
        return res.status(200).json({ ...stale, cached: true, stale: true });
      }
      return res.status(502).json({ error: 'Failed to compute IROPS data' });
    } finally {
      fetching = null;
    }
  } catch (e) {
    console.error('IROPS API error:', e);
    return res.status(502).json({ error: 'Failed to compute IROPS data' });
  }
}
