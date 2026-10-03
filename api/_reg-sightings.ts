// ═══ REG SIGHTINGS — server-side flight→tail ledger (Supabase) ═══
// Phase 2 (spec: docs/superpowers/specs/2026-07-04-schedule-phase2-design.md).
// WRITE: api/fr24-feed.ts (waitUntil side effect, throttled here) and the warm cron
// backstop. READ: api/schedule.ts at serve time via the same non-blocking peek+kick
// contract as the FAA disruption context (api/faa.ts kickDisruptionRefresh) — a serve
// never waits on Supabase, and every failure degrades to "no merge", never an error.

import { getSupabase } from './_supabase.js';
import { extractSightings } from '../src/lib/reg-overlay.js';

/**
 * `seenAtMs` is the latest sighting of any kind (reg backfill, the LIVE flag). `airborneAtMs` is
 * the latest sighting with the aircraft AIRBORNE — the only evidence the seen-airborne override
 * accepts — and null when the flight was only seen on the ground, or the row predates the
 * `airborne_at` column (sql/016, Oct 3 2026).
 */
export type SightingRecord = { reg: string; origin: string; dest: string; seenAtMs: number; airborneAtMs: number | null };

const SIGHTINGS_CACHE_TTL_MS = 60_000;
const SIGHTINGS_MAX_AGE_H = 36; // matches the Phase 1 client ledger prune horizon
export const REG_SIGHTINGS_WRITE_MIN_INTERVAL_MS = 60_000;

let sightingsCache: { map: Map<string, SightingRecord>; expires: number; loadedAt: number } | null = null;
let sightingsInFlight: Promise<Map<string, SightingRecord>> | null = null;
let lastWriteAt = 0;
// False once this instance has seen the database reject `airborne_at` (a DB without sql/016):
// writes and reads fall back to the pre-v1.12.0 shape instead of failing. Logged once.
let airborneColumn = true;

/** PostgREST's "no such column in the schema cache" (PGRST204) or Postgres undefined_column. */
export function isMissingAirborneColumn(error: any): boolean {
  if (!error) return false;
  if (error.code === 'PGRST204' || error.code === '42703') return true;
  return /airborne_at/i.test(String(error.message || '')) && /column/i.test(String(error.message || ''));
}

function disableAirborneColumn(error: any): void {
  if (!airborneColumn) return;
  airborneColumn = false;
  console.warn('reg-sightings: airborne_at column unavailable, falling back to the old row shape:', error?.message || error);
}
const EMPTY_MAP: Map<string, SightingRecord> = new Map();

/** Pure throttle decision (one upsert per instance per interval), exported for tests. */
export function shouldWriteSightings(nowMs: number, lastMs: number, minIntervalMs = REG_SIGHTINGS_WRITE_MIN_INTERVAL_MS): boolean {
  return nowMs - lastMs >= minIntervalMs;
}

/**
 * Sightings are strictly optional: with no Supabase URL configured (vitest, bare local
 * dev) every write/read is doomed, so both paths no-op INSTEAD of kicking a background
 * task that fails every 60s. This is also what keeps schedule.test.js's exact
 * waitUntil-count assertions deterministic — an unconfigured environment must never
 * enqueue a sightings refresh (found as an order-dependent test flake, review Jul 5 2026).
 */
export function isRegSightingsConfigured(): boolean {
  return !!process.env.NEXT_PUBLIC_SUPABASE_URL;
}

type SightingRow = ReturnType<typeof extractSightings>[number];

async function upsertSightingRows(supabase: any, rows: SightingRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  const { error } = await supabase.from('reg_sightings').upsert(rows, { onConflict: 'flight_key' });
  if (error) {
    console.warn('reg-sightings upsert failed:', error.message);
    return 0;
  }
  return rows.length;
}

/**
 * Batch-upsert sightings from a parsed live feed. Never throws; 0 = throttled/failed/empty.
 *
 * Two upserts per write slot (v1.12.0), split by column set. supabase-js sends ONE `columns` list
 * per call (the union of the rows' keys) and PostgREST merges every listed column, so a ground row
 * sharing a call with airborne rows would write NULL into `airborne_at` — and a taxi-in after
 * landing would erase the airborne time the flight earned. Ground rows therefore go in a call that
 * never names the column; airborne rows carry `airborne_at = now`. Still one write slot per interval.
 */
export async function recordFeedSightings(parsedFlights: any[], nowMs = Date.now()): Promise<number> {
  try {
    if (!isRegSightingsConfigured()) return 0;
    if (!shouldWriteSightings(nowMs, lastWriteAt)) return 0;
    const rows = extractSightings(parsedFlights, nowMs);
    if (rows.length === 0) return 0;
    // Claim the slot BEFORE the await: concurrent polls in this instance must not double-write.
    lastWriteAt = nowMs;
    const supabase = getSupabase();
    const ground = rows.filter((r) => !('airborne_at' in r));
    const airborne = rows.filter((r) => 'airborne_at' in r);
    const writeAirborne = async (): Promise<number> => {
      if (airborne.length === 0) return 0;
      const legacy = () => airborne.map(({ airborne_at: _drop, ...rest }) => rest);
      if (!airborneColumn) return upsertSightingRows(supabase, legacy());
      const { error } = await supabase.from('reg_sightings').upsert(airborne, { onConflict: 'flight_key' });
      if (!error) return airborne.length;
      if (!isMissingAirborneColumn(error)) {
        console.warn('reg-sightings upsert failed:', error.message);
        return 0;
      }
      // A database without sql/016: keep writing sightings in the old shape, never stop.
      disableAirborneColumn(error);
      return upsertSightingRows(supabase, legacy());
    };
    const [wroteGround, wroteAirborne] = await Promise.all([upsertSightingRows(supabase, ground), writeAirborne()]);
    return wroteGround + wroteAirborne;
  } catch (e: any) {
    console.warn('reg-sightings record failed:', e?.message || e);
    return 0;
  }
}

const SIGHTINGS_COLUMNS = 'flight_key, reg, origin, dest, seen_at';

async function fetchSightingsMap(): Promise<Map<string, SightingRecord>> {
  const map = new Map<string, SightingRecord>();
  try {
    const supabase = getSupabase();
    const cutoff = new Date(Date.now() - SIGHTINGS_MAX_AGE_H * 3600e3).toISOString();
    const select = (columns: string) => supabase.from('reg_sightings').select(columns).gt('seen_at', cutoff);
    let { data, error } = await select(airborneColumn ? `${SIGHTINGS_COLUMNS}, airborne_at` : SIGHTINGS_COLUMNS);
    if (error && airborneColumn && isMissingAirborneColumn(error)) {
      // A database without sql/016: read the old shape (every airborneAtMs null → no override).
      disableAirborneColumn(error);
      ({ data, error } = await select(SIGHTINGS_COLUMNS));
    }
    if (error) throw new Error(error.message);
    for (const row of (data || []) as any[]) {
      const seenAtMs = Date.parse(row.seen_at);
      if (!row.flight_key || typeof row.reg !== 'string' || !row.reg || !Number.isFinite(seenAtMs)) continue;
      const airborne = row.airborne_at ? Date.parse(row.airborne_at) : NaN;
      map.set(row.flight_key, {
        reg: row.reg,
        origin: row.origin || '',
        dest: row.dest || '',
        seenAtMs,
        airborneAtMs: Number.isFinite(airborne) ? airborne : null,
      });
    }
  } catch (e: any) {
    // Cache the empty map anyway: one failed load must not turn every serve into a retry storm.
    console.warn('reg-sightings load failed (merge disabled this window):', e?.message || e);
  }
  sightingsCache = { map, expires: Date.now() + SIGHTINGS_CACHE_TTL_MS, loadedAt: Date.now() };
  return map;
}

/** Synchronous read of the cached sightings map. Never fetches; empty map when cold. */
export function peekRegSightings(): Map<string, SightingRecord> {
  return sightingsCache?.map || EMPTY_MAP;
}

/** Epoch ms of the last successful cache load (0 = never) — surfaced in board meta for debugging. */
export function peekRegSightingsLoadedAt(): number {
  return sightingsCache?.loadedAt || 0;
}

/** Returns a refresh promise when the cache is cold/expired (caller enqueues it), else null. */
export function kickRegSightingsRefresh(): Promise<Map<string, SightingRecord>> | null {
  if (!isRegSightingsConfigured()) return null;
  if (sightingsCache && Date.now() < sightingsCache.expires) return null;
  if (!sightingsInFlight) {
    sightingsInFlight = fetchSightingsMap().finally(() => { sightingsInFlight = null; });
  }
  return sightingsInFlight;
}

/**
 * For callers that already await I/O and score or alert on what they read — /api/irops and the
 * /api/flight-times snapshot tier (the watch-alerts cron's path) — a cold cache must not mean "no
 * sightings": on a fresh lambda that would count every seen-flying Likely Canceled as a
 * cancellation. Waits for the refresh up to `timeoutMs`, then returns whatever the cache holds.
 * Never throws; an unconfigured or failing Supabase yields an empty map, as peekRegSightings does.
 * /api/schedule keeps the non-blocking peek+kick contract: a board serve never waits on this.
 */
export async function awaitRegSightings(timeoutMs = 2500): Promise<Map<string, SightingRecord>> {
  const refresh = kickRegSightingsRefresh();
  if (refresh) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((resolve) => { timer = setTimeout(resolve, timeoutMs); });
    try {
      await Promise.race([refresh, timeout]);
    } catch {
      /* fetchSightingsMap never rejects; belt and braces */
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  return peekRegSightings();
}

export function __resetRegSightingsForTests(): void {
  sightingsCache = null;
  sightingsInFlight = null;
  lastWriteAt = 0;
  airborneColumn = true;
}
