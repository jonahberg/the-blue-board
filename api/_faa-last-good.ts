// The last good FAA answer, kept in the database so a server that has never answered /api/faa can
// still serve it when FAA is down (src/lib/faa-last-good.js has the Nov 14 2026 outage this is for).
//
// Every call is bounded (api/_bounded.ts) and fully guarded: unconfigured, failing or slow, it
// degrades to "nothing stored", which is exactly what /api/faa had before.

import { getSupabaseAdmin } from './_schedule-snapshots.js';
import { boundedQuery } from './_bounded.js';
import {
  FAA_LAST_GOOD_MAX_AGE_MS,
  faaLastGoodFromRow,
  faaLastGoodPayload,
  shouldStoreFaaLastGood,
} from '../src/lib/faa-last-good.js';

// Judgment call (Nov 2026): starlink_snapshot (sql/008) is the project's one plain key → JSONB
// table, so the FAA answer is a second row in it rather than a migration for a new table. Every
// Starlink reader asks for key 'current' only (api/_starlink-snapshot.ts, api/flight.ts), and the
// payload is tagged `source: 'faa'`. If this ever gets its own table, only these two names change.
export const FAA_LAST_GOOD_TABLE = 'starlink_snapshot';
export const FAA_LAST_GOOD_KEY = 'faa:last-good';

/** The read happens only after both FAA sources failed; it must not add much to that wait. */
export const FAA_LAST_GOOD_READ_TIMEOUT_MS = 1500;
const FAA_LAST_GOOD_WRITE_TIMEOUT_MS = 3000;

export interface StoredFaaAnswer {
  airports: any[];
  /** When FAA gave this answer (epoch ms). */
  at: number;
}

let lastStoredAt = Number.NEGATIVE_INFINITY;

/** The stored answer, or null (none, not an FAA answer, or the read failed). Never throws. */
export async function loadStoredFaaAnswer(): Promise<StoredFaaAnswer | null> {
  try {
    const supabase = await getSupabaseAdmin();
    if (!supabase) return null;
    const { data, error } = await boundedQuery<any>(
      supabase
        .from(FAA_LAST_GOOD_TABLE)
        .select('payload, refreshed_at')
        .eq('key', FAA_LAST_GOOD_KEY)
        .limit(1),
      FAA_LAST_GOOD_READ_TIMEOUT_MS,
    );
    if (error) {
      console.warn(`FAA stored answer read failed: ${error.message}`);
      return null;
    }
    return faaLastGoodFromRow(Array.isArray(data) ? data[0] : null);
  } catch (error: any) {
    console.warn(`FAA stored answer read threw: ${error?.message || error}`);
    return null;
  }
}

/**
 * Store a good answer FAA gave at `atMs` — at most once a minute per server. Returns the write to
 * hand to waitUntil, or null when nothing is written. The promise never rejects.
 */
export function storeFaaAnswer(airports: any[], atMs: number): Promise<void> | null {
  if (!Array.isArray(airports) || !shouldStoreFaaLastGood(lastStoredAt, atMs)) return null;
  lastStoredAt = atMs;
  return (async () => {
    try {
      const supabase = await getSupabaseAdmin();
      if (!supabase) return;
      const { error } = await boundedQuery<any>(
        supabase
          .from(FAA_LAST_GOOD_TABLE)
          .upsert({
            key: FAA_LAST_GOOD_KEY,
            payload: faaLastGoodPayload(airports),
            total: airports.length,
            refreshed_at: new Date(atMs).toISOString(),
            expires_at: new Date(atMs + FAA_LAST_GOOD_MAX_AGE_MS).toISOString(),
            updated_at: new Date().toISOString(),
          }, { onConflict: 'key' }),
        FAA_LAST_GOOD_WRITE_TIMEOUT_MS,
      );
      if (error) console.warn(`FAA stored answer write failed: ${error.message}`);
    } catch (error: any) {
      console.warn(`FAA stored answer write threw: ${error?.message || error}`);
    }
  })();
}

/** Test helper: forget when this server last stored. Production never calls it. */
export function __resetFaaLastGoodForTests(): void {
  lastStoredAt = Number.NEGATIVE_INFINITY;
}
