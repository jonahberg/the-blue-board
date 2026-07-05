// ═══ REG SIGHTINGS — server-side flight→tail ledger (Supabase) ═══
// Phase 2 (spec: docs/superpowers/specs/2026-07-04-schedule-phase2-design.md).
// WRITE: api/fr24-feed.ts (waitUntil side effect, throttled here) and the warm cron
// backstop. READ: api/schedule.ts at serve time via the same non-blocking peek+kick
// contract as the FAA disruption context (api/faa.ts kickDisruptionRefresh) — a serve
// never waits on Supabase, and every failure degrades to "no merge", never an error.

import { getSupabase } from './_supabase.js';
import { extractSightings } from '../src/lib/reg-overlay.js';

export type SightingRecord = { reg: string; origin: string; dest: string; seenAtMs: number };

const SIGHTINGS_CACHE_TTL_MS = 60_000;
const SIGHTINGS_MAX_AGE_H = 36; // matches the Phase 1 client ledger prune horizon
export const REG_SIGHTINGS_WRITE_MIN_INTERVAL_MS = 60_000;

let sightingsCache: { map: Map<string, SightingRecord>; expires: number; loadedAt: number } | null = null;
let sightingsInFlight: Promise<Map<string, SightingRecord>> | null = null;
let lastWriteAt = 0;
const EMPTY_MAP: Map<string, SightingRecord> = new Map();

/** Pure throttle decision (one upsert per instance per interval), exported for tests. */
export function shouldWriteSightings(nowMs: number, lastMs: number, minIntervalMs = REG_SIGHTINGS_WRITE_MIN_INTERVAL_MS): boolean {
  return nowMs - lastMs >= minIntervalMs;
}

/** Batch-upsert sightings from a parsed live feed. Never throws; 0 = throttled/failed/empty. */
export async function recordFeedSightings(parsedFlights: any[], nowMs = Date.now()): Promise<number> {
  try {
    if (!shouldWriteSightings(nowMs, lastWriteAt)) return 0;
    const rows = extractSightings(parsedFlights, nowMs);
    if (rows.length === 0) return 0;
    // Claim the slot BEFORE the await: concurrent polls in this instance must not double-write.
    lastWriteAt = nowMs;
    const supabase = getSupabase();
    const { error } = await supabase.from('reg_sightings').upsert(rows, { onConflict: 'flight_key' });
    if (error) {
      console.warn('reg-sightings upsert failed:', error.message);
      return 0;
    }
    return rows.length;
  } catch (e: any) {
    console.warn('reg-sightings record failed:', e?.message || e);
    return 0;
  }
}

async function fetchSightingsMap(): Promise<Map<string, SightingRecord>> {
  const map = new Map<string, SightingRecord>();
  try {
    const supabase = getSupabase();
    const cutoff = new Date(Date.now() - SIGHTINGS_MAX_AGE_H * 3600e3).toISOString();
    const { data, error } = await supabase
      .from('reg_sightings')
      .select('flight_key, reg, origin, dest, seen_at')
      .gt('seen_at', cutoff);
    if (error) throw new Error(error.message);
    for (const row of data || []) {
      const seenAtMs = Date.parse(row.seen_at);
      if (!row.flight_key || typeof row.reg !== 'string' || !row.reg || !Number.isFinite(seenAtMs)) continue;
      map.set(row.flight_key, { reg: row.reg, origin: row.origin || '', dest: row.dest || '', seenAtMs });
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
  if (sightingsCache && Date.now() < sightingsCache.expires) return null;
  if (!sightingsInFlight) {
    sightingsInFlight = fetchSightingsMap().finally(() => { sightingsInFlight = null; });
  }
  return sightingsInFlight;
}

export function __resetRegSightingsForTests(): void {
  sightingsCache = null;
  sightingsInFlight = null;
  lastWriteAt = 0;
}
