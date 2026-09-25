// Serves enriched Starlink aircraft data.
//
// Serve order (each falls through to the next on miss/failure):
//   1. globalThis.__starlinkCache  — same-instance cron result (fast path, rare)
//   2. in-memory cache             — this lambda's last fetch, if still fresh
//   3. Supabase snapshot           — durable, cross-instance, written by the cron every 4h
//   4. direct upstream fetch       — rate-limited; refreshes the in-memory cache
// On error, degrade rather than fail: stale in-memory -> stale Supabase snapshot -> committed
// static file. The X-Starlink-Source header reports which path served the response.

import { createRequire } from 'node:module';
import type { VercelRequest, VercelResponse } from './types.js';
import { createRateLimiter } from './_rate-limit.js';
import {
  applyVerifiedStarlinkOverrides,
  applyVerifiedStarlinkPayloadOverrides,
  normalizeStarlinkPayload,
  normalizeOperator,
  normalizeType,
  validateStarlinkPayload,
  type StarlinkPayload,
} from './_starlink-normalize.js';
import { loadStarlinkSnapshot, type PersistedStarlinkSnapshot } from './_starlink-snapshot.js';

const UPSTREAM_URL = 'https://unitedstarlinktracker.com/api/data';
const CACHE_TTL = 4 * 60 * 60 * 1000;       // 4h in-memory freshness
const SNAPSHOT_FRESH_MS = 6 * 60 * 60 * 1000; // serve the durable snapshot directly if <6h old

const isRateLimited = createRateLimiter('starlink-data', 30);

let inMemoryCache: StarlinkPayload | null = null;
let lastFetch = 0;

// Committed snapshot — the last-resort fallback when upstream is down and no other cache exists.
// Loaded lazily via createRequire, NOT a top-level `import ... from '*.json'`: this package is
// "type":"module", so Vercel runs these functions as native Node ESM, where a bare JSON import
// throws ERR_IMPORT_ATTRIBUTE_MISSING at module load — crashing the function before any request
// handling (prod incident 2026-06-01). require() of JSON needs no import attributes, @vercel/nft
// traces the literal path into the bundle, and any failure here degrades to "no static fallback"
// instead of a cold-start crash.
let staticAircraftCache: Array<{ tail: string; fleet: string; type: string; operator: string }> | null = null;
function loadStaticAircraft(): Array<{ tail: string; fleet: string; type: string; operator: string }> {
  if (staticAircraftCache) return staticAircraftCache;
  try {
    const requireJson = createRequire(import.meta.url);
    const data = requireJson('../public/data/starlink.json');
    staticAircraftCache = Array.isArray(data) ? data : [];
  } catch (err: any) {
    console.error('Static starlink fallback unavailable:', err?.message || err);
    staticAircraftCache = [];
  }
  return staticAircraftCache;
}

// Wrap the on-disk aircraft array (no flights/fleet stats) into the full payload shape.
// Returns null when the static file is unavailable so callers fall through to an error response.
function staticPayload(): StarlinkPayload | null {
  const raw = loadStaticAircraft();
  if (raw.length === 0) return null;
  const aircraft = applyVerifiedStarlinkOverrides(raw.map((a) => ({
    tail: a.tail,
    fleet: a.fleet,
    type: normalizeType(a.type),
    operator: normalizeOperator(a.operator),
    dateFound: '',
    wifi: 'Starlink',
  })));
  return {
    aircraft,
    totalCount: aircraft.length,
    fleetStats: null,
    flightsByTail: {},
    lastUpdated: '',
    syncedAt: new Date().toISOString(),
  };
}

async function fetchUpstream(previousTotal?: number): Promise<StarlinkPayload> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  const resp = await fetch(UPSTREAM_URL, {
    signal: controller.signal,
    headers: { 'User-Agent': 'BlueBoard-StarlinkData/1.0' },
  });
  clearTimeout(timeout);

  if (!resp.ok) throw new Error(`Upstream ${resp.status}`);
  const payload = normalizeStarlinkPayload(await resp.json());

  // §05 validators: a parseable 200 is not proof of a usable feed. Throwing here routes a
  // structurally broken payload into the existing degrade ladder (stale snapshot → static)
  // instead of serving it and caching it in memory for the next 4h.
  const validation = validateStarlinkPayload(payload, previousTotal);
  for (const warning of validation.warnings) {
    console.warn(`Starlink data warning: ${warning}`);
  }
  if (!validation.ok) {
    throw new Error(`Upstream payload failed validation: ${validation.failures.join('; ')}`);
  }
  return payload;
}

function serveFresh(res: VercelResponse, payload: StarlinkPayload, source: string) {
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=600');
  res.setHeader('X-Starlink-Source', source);
  return res.status(200).json(applyVerifiedStarlinkPayloadOverrides(payload));
}

function serveDegraded(res: VercelResponse, payload: StarlinkPayload, source: string) {
  res.setHeader('Cache-Control', 'public, s-maxage=300');
  res.setHeader('X-Starlink-Source', source);
  return res.status(200).json(applyVerifiedStarlinkPayloadOverrides(payload));
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
      if (snapshot?.data) return serveDegraded(res, snapshot.data, 'supabase-stale');
      const limited = staticPayload();
      if (limited) return serveDegraded(res, limited, 'static');
      return res.status(429).json({ error: 'Too many requests' });
    }

    inMemoryCache = await fetchUpstream(snapshot?.data.aircraft.length);
    lastFetch = Date.now();
    return serveFresh(res, inMemoryCache, 'upstream');
  } catch (err: any) {
    // Degrade rather than 502: stale in-memory -> stale snapshot -> committed static file.
    if (inMemoryCache) return serveDegraded(res, inMemoryCache, 'memory-stale');
    if (snapshot?.data) return serveDegraded(res, snapshot.data, 'supabase-stale');
    console.error('Starlink data error:', err?.message || err);
    const fallback = staticPayload();
    if (fallback) return serveDegraded(res, fallback, 'static');
    return res.status(502).json({ error: 'Failed to fetch Starlink data' });
  }
}
