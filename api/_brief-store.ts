// ops_briefs (sql/022): the published briefs. WRITE: api/cron/brief.ts. READ: api/brief.ts.
//
// Like the other optional stores (api/_airborne-samples.ts, api/_express-tails.ts): no service-role
// env → no-op; a missing table (sql/022 not applied yet) → one loud log line per instance, then quiet
// no-ops. Nothing here throws.

import { getSupabaseAdmin } from './_schedule-snapshots.js';

export const BRIEFS_TABLE = 'ops_briefs';
/** Kept this long; older rows are deleted by cleanupOldBriefs in bounded batches. */
export const BRIEF_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const CLEANUP_BATCH_SIZE = 300;
const CLEANUP_MAX_BATCHES = 4;

export type BriefItem = { text: string; fact_ids: string[] };

export type BriefRow = {
  id?: number;
  generated_at: string;
  checked_at: string;
  source: 'model' | 'template';
  template_reason: string | null;
  tone: 'calm' | 'watch' | 'disrupted';
  headline: string;
  items: BriefItem[];
  traveler_note: BriefItem | null;
  headline_fact_ids: string[];
  facts: any[];
  facts_hash: string;
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number | null;
  verifier: Record<string, unknown>;
  collection: Record<string, unknown>;
};

/** The latest-row columns the cron needs for change detection. */
export type LatestBriefMeta = Pick<BriefRow, 'id' | 'generated_at' | 'checked_at' | 'facts_hash' | 'source' | 'template_reason'>;

let warnedMissingTable = false;

export function isMissingBriefsTable(error: any): boolean {
  if (!error) return false;
  if (error.code === '42P01' || error.code === 'PGRST205') return true;
  const message = String(error.message || '');
  return /ops_briefs/i.test(message) && /(does not exist|could not find|schema cache)/i.test(message);
}

function logBriefsError(op: string, error: any): void {
  if (isMissingBriefsTable(error)) {
    if (!warnedMissingTable) {
      warnedMissingTable = true;
      console.error('sql/022_ops_brief.sql is NOT applied — ops_briefs is missing, so no brief is published. Apply it via the Supabase SQL editor.');
    }
    return;
  }
  console.warn(`ops-briefs ${op} failed:`, error?.message || error);
}

export type StoreResult<T> = { ok: true; value: T } | { ok: false; reason: string };

/** The newest brief, or `value: null` when there is none yet. */
export async function loadLatestBrief<T = BriefRow>(columns = '*'): Promise<StoreResult<T | null>> {
  try {
    const supabase = await getSupabaseAdmin();
    if (!supabase || typeof supabase.from !== 'function') return { ok: false, reason: 'unconfigured' };
    const { data, error } = await supabase
      .from(BRIEFS_TABLE)
      .select(columns)
      .order('generated_at', { ascending: false })
      .limit(1);
    if (error) {
      logBriefsError('read', error);
      return { ok: false, reason: isMissingBriefsTable(error) ? 'table missing' : 'read failed' };
    }
    return { ok: true, value: ((data as T[] | null) || [])[0] ?? null };
  } catch (e: any) {
    console.warn('ops-briefs read threw:', e?.message || e);
    return { ok: false, reason: 'read threw' };
  }
}

export async function insertBrief(row: BriefRow): Promise<StoreResult<number | null>> {
  try {
    const supabase = await getSupabaseAdmin();
    if (!supabase || typeof supabase.from !== 'function') return { ok: false, reason: 'unconfigured' };
    const { data, error } = await supabase.from(BRIEFS_TABLE).insert(row).select('id').limit(1);
    if (error) {
      logBriefsError('write', error);
      return { ok: false, reason: isMissingBriefsTable(error) ? 'table missing' : 'write failed' };
    }
    const id = Number((data as Array<{ id: number }> | null)?.[0]?.id);
    return { ok: true, value: Number.isFinite(id) ? id : null };
  } catch (e: any) {
    console.warn('ops-briefs write threw:', e?.message || e);
    return { ok: false, reason: 'write threw' };
  }
}

/** Record that a run re-confirmed the latest brief's facts (GET /api/brief derives `stale` from this). */
export async function touchBriefChecked(id: number, checkedAtIso: string): Promise<boolean> {
  try {
    const supabase = await getSupabaseAdmin();
    if (!supabase || typeof supabase.from !== 'function') return false;
    const { error } = await supabase.from(BRIEFS_TABLE).update({ checked_at: checkedAtIso }).eq('id', id);
    if (error) {
      logBriefsError('touch', error);
      return false;
    }
    return true;
  } catch (e: any) {
    console.warn('ops-briefs touch threw:', e?.message || e);
    return false;
  }
}

/**
 * Delete briefs older than the retention window, by primary-key batches (the snapshot-GC shape in
 * api/_schedule-snapshots.ts: a single unbounded DELETE can hit the statement timeout and roll back
 * whole). Returns how many rows went. Never throws.
 */
export async function cleanupOldBriefs(nowMs: number = Date.now(), table = BRIEFS_TABLE, timeColumn = 'generated_at'): Promise<{ deleted: number; capReached: boolean }> {
  let deleted = 0;
  let capReached = false;
  try {
    const supabase = await getSupabaseAdmin();
    if (!supabase || typeof supabase.from !== 'function') return { deleted, capReached };
    const cutoff = new Date(nowMs - BRIEF_RETENTION_MS).toISOString();
    for (let batch = 0; batch < CLEANUP_MAX_BATCHES; batch++) {
      const { data, error } = await supabase
        .from(table)
        .select('id')
        .lt(timeColumn, cutoff)
        .order(timeColumn, { ascending: true })
        .limit(CLEANUP_BATCH_SIZE);
      if (error) {
        logBriefsError('cleanup select', error);
        break;
      }
      const ids = ((data || []) as Array<{ id: number }>).map((r) => r.id);
      if (!ids.length) break;
      const { error: delError } = await supabase.from(table).delete().in('id', ids);
      if (delError) {
        logBriefsError('cleanup delete', delError);
        break;
      }
      deleted += ids.length;
      if (ids.length < CLEANUP_BATCH_SIZE) break;
      if (batch === CLEANUP_MAX_BATCHES - 1) capReached = true;
    }
  } catch (e: any) {
    console.warn('ops-briefs cleanup threw:', e?.message || e);
  }
  if (deleted > 0) console.log(`${table} cleanup: deleted ${deleted} rows older than 90 days${capReached ? ' (batch cap reached; backlog may remain)' : ''}`);
  return { deleted, capReached };
}

export function __resetBriefStoreForTests(): void {
  warnedMissingTable = false;
}
