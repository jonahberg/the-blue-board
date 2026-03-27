// Serves enriched Starlink aircraft data
// Primary: serves cached data from cron sync
// Fallback: fetches directly from upstream if cache is empty

import type { VercelRequest, VercelResponse } from './types.js';
import { createRateLimiter } from './_rate-limit.js';

const UPSTREAM_URL = 'https://unitedstarlinktracker.com/api/data';
const CACHE_TTL = 4 * 60 * 60 * 1000; // 4 hours

interface StarlinkCache {
  aircraft: Array<{ tail: string; fleet: string; type: string; operator: string }>;
  totalCount: number;
  fleetStats: { mainline: number; express: number; total: number; mainlineTotal: number; expressTotal: number } | null;
  flightsByTail: Record<string, Array<{ flight_number: string; origin: string; destination: string; departure_time: string }>>;
  lastUpdated: string;
  syncedAt: string;
}

const isRateLimited = createRateLimiter('starlink-data', 30);

let inMemoryCache: StarlinkCache | null = null;
let lastFetch = 0;

async function fetchUpstream(): Promise<StarlinkCache> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  const resp = await fetch(UPSTREAM_URL, {
    signal: controller.signal,
    headers: { 'User-Agent': 'BlueBoard-StarlinkData/1.0' },
  });
  clearTimeout(timeout);

  if (!resp.ok) throw new Error(`Upstream ${resp.status}`);

  const upstream = await resp.json() as any;
  // Upstream uses: TailNumber, Aircraft (=type), fleet ("express"/"mainline"), OperatedBy
  const aircraft = (upstream.starlinkPlanes || []).map((p: any) => ({
    tail: p.TailNumber,
    fleet: (p.fleet || 'express').charAt(0).toUpperCase() + (p.fleet || 'express').slice(1),
    type: p.Aircraft || 'Unknown',
    operator: p.OperatedBy || 'United Airlines',
  }));

  // Normalize fleet stats to simple counts
  const fs = upstream.fleetStats;
  const fleetStats = fs ? {
    mainline: fs.mainline?.starlink ?? 0,
    express: fs.express?.starlink ?? 0,
    total: fs.combined?.starlink ?? aircraft.length,
    mainlineTotal: fs.mainline?.total ?? 0,
    expressTotal: fs.express?.total ?? 0,
  } : null;

  // Normalize flight fields (upstream uses departure_airport/arrival_airport)
  const flightsByTail: Record<string, any[]> = {};
  for (const [tail, flights] of Object.entries(upstream.flightsByTail || {} as Record<string, any[]>)) {
    flightsByTail[tail] = (flights as any[]).map((f: any) => ({
      flight_number: f.flight_number,
      origin: f.departure_airport || f.origin || '',
      destination: f.arrival_airport || f.destination || '',
      departure_time: f.departure_time || '',
    }));
  }

  return {
    aircraft,
    totalCount: upstream.totalCount || aircraft.length,
    fleetStats,
    flightsByTail,
    lastUpdated: upstream.lastUpdated || new Date().toISOString(),
    syncedAt: new Date().toISOString(),
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Serve cached responses without rate limiting
    const cronCache = (globalThis as any).__starlinkCache as StarlinkCache | undefined;
    if (cronCache) {
      res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=600');
      return res.status(200).json(cronCache);
    }

    if (inMemoryCache && Date.now() - lastFetch < CACHE_TTL) {
      res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=600');
      return res.status(200).json(inMemoryCache);
    }

    // Rate limit only upstream fetches, not cache hits
    if (isRateLimited(req)) {
      return res.status(429).json({ error: 'Too many requests' });
    }

    // Fetch fresh
    inMemoryCache = await fetchUpstream();
    lastFetch = Date.now();

    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=600');
    return res.status(200).json(inMemoryCache);
  } catch (err: any) {
    // If we have stale cache, serve it rather than failing
    if (inMemoryCache) {
      res.setHeader('Cache-Control', 'public, s-maxage=300');
      return res.status(200).json(inMemoryCache);
    }
    console.error('Starlink data error:', err);
    return res.status(502).json({ error: 'Failed to fetch Starlink data' });
  }
}
