import type { VercelRequest, VercelResponse } from './types.js';
import { createRateLimiter } from './_rate-limit.js';
import { normalizeMetarPayload } from '../src/lib/metar.js';

const isRateLimited = createRateLimiter('metar', 60);

const AWC_BASE = 'https://aviationweather.gov/api/data/metar';
// Per-station timeout. AWC's batch endpoint is gated by its slowest station on a cache miss
// (one cold station can stall the whole response 12-20s), so we fetch each station on its own
// clock instead. Concurrent fan-out means wall-clock is ~max(station), not the sum.
const STATION_TIMEOUT_MS = Math.max(2000, Number(process.env.METAR_STATION_TIMEOUT_MS) || 6500);

// Last-known-good observation per ICAO id, ephemeral per warm instance (same pattern as
// _rate-limit.ts). This is the store the `stale-while-revalidate` header always implied but never
// had: a momentarily-slow station serves its previous observation instead of blanking its hub card.
//
// F040: the store used to never expire and carried no age marker, so a station that stopped
// reporting entirely could backfill the same observation indefinitely with nothing in the payload
// to tell the client it was stale. Each entry now also records when it was captured (cachedAt, ms
// epoch) so a backfill beyond BACKFILL_MAX_AGE_MS is refused (the station is omitted from the
// response instead of silently going stale forever), and any backfill that IS served carries an
// additive `stale: true` + `cachedAt` marker the client can render later — additive fields only, so
// the batched response shape stays backward compatible.
const lastKnownGood = new Map<string, { rec: any; cachedAt: number }>();
// Beyond this age, a backfilled observation is more likely to be actively misleading (a real METAR
// changes at least hourly) than merely "a bit old" — stop backfilling it and let the station be
// omitted (the existing "weather unavailable" client fallback) rather than serve a stale marker
// so old it approaches worthless.
const BACKFILL_MAX_AGE_MS = 6 * 60 * 60 * 1000; // 6h

// Ceiling on the last-known-good store. The `ids` param admits up to ~40 distinct valid ICAO
// codes per request, and an entry is only ever evicted when its exact id is re-requested and
// found too old — so a caller enumerating valid codes could otherwise grow the map without limit
// on a warm instance. Cap it (same size-cap guard as flight-times.ts) and re-insert on refresh so
// actively-served hubs are never the eviction target. Operator-overridable; the fixed hub set is
// far under the default.
function lastKnownGoodMax(): number {
  const n = Number(process.env.METAR_LKG_MAX);
  return Number.isFinite(n) && n > 0 ? n : 500;
}

/** Test helper: clear the last-known-good cache so module state doesn't leak across tests. */
export function __resetMetarCacheForTests(): void {
  lastKnownGood.clear();
}

function stationKey(rec: any): string {
  return String(rec?.icaoId || rec?.stationId || rec?.id || '').toUpperCase();
}

// Fetch a single station with its own abort timer. Returns the normalized records (usually one),
// or null on any failure/timeout — never throws, so Promise.allSettled stays clean.
async function fetchOneStation(id: string): Promise<any[] | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), STATION_TIMEOUT_MS);
  try {
    const resp = await fetch(`${AWC_BASE}?ids=${encodeURIComponent(id)}&format=json`, {
      signal: controller.signal,
      headers: { 'User-Agent': 'theblueboard.co weather (jonah.berg.g@gmail.com)' },
    });
    if (!resp.ok) return null;
    return normalizeMetarPayload(await resp.json());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
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

  const ids = (req.query.ids as string) || 'KORD';
  // Validate: comma-separated ICAO codes, max 200 chars
  if (!/^[A-Z0-9,]{1,200}$/i.test(ids)) {
    return res.status(400).json({ error: 'Invalid airport IDs' });
  }

  const stations = ids.toUpperCase().split(',').map((s) => s.trim()).filter(Boolean);

  // Fan out: one independent, concurrently-timed fetch per station. A single slow/failed station
  // can no longer stall or 504 the whole batch — the rest still return, and the laggard falls back
  // to its last-known observation (or is omitted) rather than blanking every hub.
  const settled = await Promise.allSettled(stations.map(fetchOneStation));

  const byStation = new Map<string, any>();
  const now = Date.now();
  for (const result of settled) {
    if (result.status !== 'fulfilled' || !Array.isArray(result.value)) continue;
    for (const rec of result.value) {
      const key = stationKey(rec);
      if (!key) continue;
      byStation.set(key, rec);
      // Refresh last-known-good with every fresh observation. Re-insert (delete then set) so the
      // key moves to the most-recent position, and evict the oldest once the store is at capacity,
      // bounding growth under valid-ICAO enumeration.
      lastKnownGood.delete(key);
      if (lastKnownGood.size >= lastKnownGoodMax()) {
        const oldest = lastKnownGood.keys().next().value;
        if (oldest !== undefined) lastKnownGood.delete(oldest);
      }
      lastKnownGood.set(key, { rec, cachedAt: now });
    }
  }

  // Backfill any requested station that didn't answer this round from last-known-good, as long as
  // that observation isn't older than BACKFILL_MAX_AGE_MS (F040). A backfill is additively marked
  // `stale: true` + `cachedAt` so the client CAN render an age signal; a too-old entry is dropped
  // instead of being backfilled — the station is simply omitted, same as the existing no-data case.
  for (const id of stations) {
    if (byStation.has(id)) continue;
    const entry = lastKnownGood.get(id);
    if (!entry) continue;
    const age = now - entry.cachedAt;
    if (age > BACKFILL_MAX_AGE_MS) {
      lastKnownGood.delete(id);
      continue;
    }
    byStation.set(id, { ...entry.rec, stale: true, cachedAt: entry.cachedAt });
  }

  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
  res.setHeader('Content-Type', 'application/json');
  // Always 200 with whatever resolved (fresh + stale-backfilled). Worst case — a cold instance
  // where every station is slow — returns [], which the dashboard already degrades to its
  // existing "weather unavailable / retry" state rather than a hard error.
  return res.status(200).json(Array.from(byStation.values()));
}
