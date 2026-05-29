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
  const url = `${BASE_URL}/api/schedule?hub=${hub}&dir=departures&timestamp=${timestamp}`;
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

export function computeMetrics(flightsByHub: Record<string, any[]>) {
  let allFlights: any[] = [];
  const hubMetrics: Record<string, HubMetric> = {};

  for (const [hub, flights] of Object.entries(flightsByHub)) {
    allFlights = allFlights.concat(flights);
    hubMetrics[hub] = { total: flights.length, cancellations: 0, delayed30: 0, delayed60: 0, diversions: 0, operated: 0, onTime: 0 };

    for (const fl of flights) {
      const status = fl.status?.generic?.status?.text?.toLowerCase() || '';
      if (status === 'canceled' || status === 'cancelled') { hubMetrics[hub].cancellations++; continue; }
      if (status === 'diverted') hubMetrics[hub].diversions++;

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
    if (status === 'canceled' || status === 'cancelled') cancellations++;
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
    }
  }

  worstDelays.sort((a, b) => b.delay - a.delay);

  const totalFlights = allFlights.length;
  const score = totalFlights > 0
    ? ((cancellations * 3 + delayed60 * 2 + delayed30 + diversions * 2) / totalFlights * 100)
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
