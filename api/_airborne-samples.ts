// ═══ AIRBORNE SAMPLES — "how many United flights are airborne", every 5 minutes (Supabase) ═══
// Table: sql/017_airborne_samples.sql. WRITE: api/cron/watch-alerts.ts, once per successful free
// live-feed read. READ: api/airborne-history.ts (the Live tab's 24-hour graph).
//
// The count is `countAirborne()` from src/lib/airborne-count.js over the UNFILTERED parsed feed —
// the same function computeLiveStats() uses for the stat bar's unfiltered number, so the graph's
// latest point and the Live tab agree by construction.
//
// Strictly optional, like reg_sightings: no service-role env (vitest, bare local dev) → no-op; a
// missing table (sql/017 not applied yet) → one log line per instance, then quiet no-ops. Nothing
// here throws, and no failure can fail the cron or 5xx the reader.

import { getSupabaseAdmin } from './_schedule-snapshots.js';
import { countAirborne, sampleMinuteIso } from '../src/lib/airborne-count.js';

export const AIRBORNE_SAMPLES_TABLE = 'airborne_samples';
/** PostgREST's default max-rows; a 168-hour read (2,016 rows) pages past it. */
const PAGE_ROWS = 1000;
const MAX_PAGES = 4;

export type AirborneSampleRow = {
  sampled_at: string;
  airborne: number;
  ground: number;
  total: number;
  mainline: number;
  express: number;
};

export type RecordResult = { recorded: boolean; airborne?: number; reason?: string };

let warnedMissingTable = false;

/** Postgres undefined_table (42P01) or PostgREST's "not in the schema cache" (PGRST205). */
export function isMissingSamplesTable(error: any): boolean {
  if (!error) return false;
  if (error.code === '42P01' || error.code === 'PGRST205') return true;
  const message = String(error.message || '');
  return /airborne_samples/i.test(message) && /(does not exist|could not find|schema cache)/i.test(message);
}

function logSamplesError(op: string, error: any): void {
  if (isMissingSamplesTable(error)) {
    if (!warnedMissingTable) {
      warnedMissingTable = true;
      console.error('sql/017_airborne_samples.sql is NOT applied — the 24-hour airborne graph has no history. Apply it via the Supabase SQL editor.');
    }
    return;
  }
  console.warn(`airborne-samples ${op} failed:`, error?.message || error);
}

/**
 * The row a parsed feed becomes, or null when it must NOT be stored: an empty parse is a failed
 * read (feed-health.js), and zero airborne out of a non-empty feed is not a United sky either —
 * both stay gaps, never zeros.
 */
export function buildAirborneSampleRow(parsedFlights: any[], atMs: number): AirborneSampleRow | null {
  if (!Array.isArray(parsedFlights) || parsedFlights.length === 0) return null;
  const sampledAt = sampleMinuteIso(atMs);
  if (!sampledAt) return null;
  const c = countAirborne(parsedFlights);
  if (c.airborne === 0) return null;
  return { sampled_at: sampledAt, airborne: c.airborne, ground: c.ground, total: c.total, mainline: c.mainline, express: c.express };
}

/**
 * Record one sample from a SUCCESSFUL live-feed read. Never throws. A second sample for the same
 * minute is ignored (`on conflict do nothing`), so a retried or overlapping cron run is harmless.
 */
export async function recordAirborneSample(parsedFlights: any[], atMs: number = Date.now()): Promise<RecordResult> {
  try {
    const row = buildAirborneSampleRow(parsedFlights, atMs);
    if (!row) return { recorded: false, reason: 'no usable reading' };
    const supabase = await getSupabaseAdmin();
    if (!supabase || typeof supabase.from !== 'function') return { recorded: false, reason: 'unconfigured' };
    const { error } = await supabase
      .from(AIRBORNE_SAMPLES_TABLE)
      .upsert(row, { onConflict: 'sampled_at', ignoreDuplicates: true });
    if (error) {
      logSamplesError('write', error);
      return { recorded: false, reason: isMissingSamplesTable(error) ? 'table missing' : 'write failed' };
    }
    return { recorded: true, airborne: row.airborne };
  } catch (e: any) {
    console.warn('airborne-samples write threw:', e?.message || e);
    return { recorded: false, reason: 'write threw' };
  }
}

export type HistorySample = { t: string; airborne: number; express?: number };
export type LoadResult = { ok: true; samples: HistorySample[] } | { ok: false; reason: string };

/**
 * Samples at or after `sinceMs`, oldest first, paged past PostgREST's row cap. Never throws:
 * unconfigured, missing table and any read error come back as `ok: false` for the route to answer
 * with an empty, honest 200.
 */
export async function loadAirborneSamples(sinceMs: number): Promise<LoadResult> {
  try {
    const supabase = await getSupabaseAdmin();
    if (!supabase || typeof supabase.from !== 'function') return { ok: false, reason: 'unconfigured' };
    const sinceIso = new Date(sinceMs).toISOString();
    const samples: HistorySample[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const from = page * PAGE_ROWS;
      const { data, error } = await supabase
        .from(AIRBORNE_SAMPLES_TABLE)
        .select('sampled_at, airborne, express')
        .gte('sampled_at', sinceIso)
        .order('sampled_at', { ascending: true })
        .range(from, from + PAGE_ROWS - 1);
      if (error) {
        logSamplesError('read', error);
        return { ok: false, reason: isMissingSamplesTable(error) ? 'table missing' : 'read failed' };
      }
      const rows = (data || []) as Array<{ sampled_at: string; airborne: number | null; express: number | null }>;
      for (const row of rows) {
        const t = Date.parse(row.sampled_at);
        if (!Number.isFinite(t) || typeof row.airborne !== 'number' || !Number.isFinite(row.airborne)) continue;
        const sample: HistorySample = { t: new Date(t).toISOString(), airborne: row.airborne };
        if (typeof row.express === 'number' && Number.isFinite(row.express)) sample.express = row.express;
        samples.push(sample);
      }
      if (rows.length < PAGE_ROWS) break;
    }
    return { ok: true, samples };
  } catch (e: any) {
    console.warn('airborne-samples read threw:', e?.message || e);
    return { ok: false, reason: 'read threw' };
  }
}

export function __resetAirborneSamplesForTests(): void {
  warnedMissingTable = false;
}
