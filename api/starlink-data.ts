// Serves enriched Starlink aircraft data.
//
// Serve order (each falls through to the next on miss/failure):
//   1. globalThis.__starlinkCache  — same-instance cron result (fast path, rare)
//   2. in-memory cache             — this lambda's last fetch, if still fresh
//   3. Supabase snapshot           — durable, cross-instance, written by the cron every 4h
//   4. direct upstream fetch       — rate-limited; refreshes the in-memory cache
// On error, degrade rather than fail: stale in-memory -> stale Supabase snapshot -> committed
// static file. The X-Starlink-Source header reports which path served the response.

import type { VercelRequest, VercelResponse } from './types.js';
import { createRateLimiter } from './_rate-limit.js';
import { normalizeStarlinkPayload, normalizeOperator, normalizeType, type StarlinkPayload } from './_starlink-normalize.js';
import { loadStarlinkSnapshot, type PersistedStarlinkSnapshot } from './_starlink-snapshot.js';
import STATIC_STARLINK from '../public/data/starlink.json';

const UPSTREAM_URL = 'https://unitedstarlinktracker.com/api/data';
const CACHE_TTL = 4 * 60 * 60 * 1000;       // 4h in-memory freshness
const SNAPSHOT_FRESH_MS = 6 * 60 * 60 * 1000; // serve the durable snapshot directly if <6h old

const isRateLimited = createRateLimiter('starlink-data', 30);

let inMemoryCache: StarlinkPayload | null = null;
let lastFetch = 0;

// Committed snapshot bundled at build time — the last-resort fallback when upstream is down and no
// other cache exists. Shape on disk is just the aircraft array; wrap it into the full payload.
function staticPayload(): StarlinkPayload {
  const aircraft = (STATIC_STARLINK as Array<{ tail: string; fleet: string; type: string; operator: string }>).map((a) => ({
    tail: a.tail,
    fleet: a.fleet,
    type: normalizeType(a.type),
    operator: normalizeOperator(a.operator),
    dateFound: '',
    wifi: 'Starlink',
  }));
  return {
    aircraft,
    totalCount: aircraft.length,
    fleetStats: null,
    flightsByTail: {},
    lastUpdated: '',
    syncedAt: new Date().toISOString(),
  };
}

async function fetchUpstream(): Promise<StarlinkPayload> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  const resp = await fetch(UPSTREAM_URL, {
    signal: controller.signal,
    headers: { 'User-Agent': 'BlueBoard-StarlinkData/1.0' },
  });
  clearTimeout(timeout);

  if (!resp.ok) throw new Error(`Upstream ${resp.status}`);
  return normalizeStarlinkPayload(await resp.json());
}

function serveFresh(res: VercelResponse, payload: StarlinkPayload, source: string) {
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=600');
  res.setHeader('X-Starlink-Source', source);
  return res.status(200).json(payload);
}

function serveDegraded(res: VercelResponse, payload: StarlinkPayload, source: string) {
  res.setHeader('Cache-Control', 'public, s-maxage=300');
  res.setHeader('X-Starlink-Source', source);
  return res.status(200).json(payload);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Cached from earlier in the request lifecycle so the catch block can reuse it without a second read.
  let snapshot: PersistedStarlinkSnapshot | null = null;

  try {
    // 1. Same-instance cron result.
    const cronCache = (globalThis as any).__starlinkCache as StarlinkPayload | undefined;
    if (cronCache) return serveFresh(res, cronCache, 'cron');

    // 2. Fresh in-memory cache.
    if (inMemoryCache && Date.now() - lastFetch < CACHE_TTL) {
      return serveFresh(res, inMemoryCache, 'memory');
    }

    // 3. Durable Supabase snapshot (written by the cron). Serve directly if fresh; this lets a cold
    //    instance skip the 727KB upstream fetch entirely and keeps every instance consistent.
    snapshot = await loadStarlinkSnapshot();
    if (snapshot && Date.now() - snapshot.refreshedAt < SNAPSHOT_FRESH_MS) {
      inMemoryCache = snapshot.data;
      lastFetch = snapshot.refreshedAt;
      return serveFresh(res, snapshot.data, 'supabase');
    }

    // 4. Fetch fresh from upstream. If rate-limited, degrade instead of erroring.
    if (isRateLimited(req)) {
      return serveDegraded(res, snapshot?.data ?? staticPayload(), snapshot ? 'supabase-stale' : 'static');
    }

    inMemoryCache = await fetchUpstream();
    lastFetch = Date.now();
    return serveFresh(res, inMemoryCache, 'upstream');
  } catch (err: any) {
    // Degrade rather than 502: stale in-memory -> stale snapshot -> committed static file.
    if (inMemoryCache) return serveDegraded(res, inMemoryCache, 'memory-stale');
    if (snapshot?.data) return serveDegraded(res, snapshot.data, 'supabase-stale');
    console.error('Starlink data error (serving static fallback):', err?.message || err);
    return serveDegraded(res, staticPayload(), 'static');
  }
}
