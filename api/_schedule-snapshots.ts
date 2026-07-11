const SNAPSHOT_TABLE = 'schedule_snapshots';
const SNAPSHOT_TTL_MS = 72 * 60 * 60 * 1000;
const MIN_PARTIAL_SNAPSHOT_COMPLETENESS = 0.25;
// A complete board is accepted over a stored complete snapshot only if it retains at least this
// fraction of the stored total. A hub DAY board's flight count is stable within the day, so a board
// that lost more than half its flights while still reporting partial=false is almost certainly a
// transient truncated 200 (provider returned HTTP 200 on both FIDS windows but with a short
// `departures` array), not a real schedule shrink — and it must not clobber the richer stored board
// and then be served as the degraded fallback for the 72h TTL. Deliberately generous so ordinary
// churn and any same-or-larger board always writes through.
const COMPLETE_SNAPSHOT_MIN_RETAIN = 0.5;

interface PersistedSnapshotRow {
  payload: any;
  refreshed_at: string;
}

export interface PersistedScheduleSnapshot {
  data: any;
  refreshedAt: number;
}

interface SaveScheduleSnapshotArgs {
  cacheKey: string;
  hub: string;
  dir: string;
  ts: number;
  data: any;
}

let warnedMissingConfig = false;
let warnedInitFailure = false;
let supabaseClientPromise: Promise<any | null> | null = null;

export function getSnapshotCompleteness(data: any): number {
  const completeness = Number(data?.meta?.completeness);
  if (Number.isFinite(completeness)) {
    return Math.max(0, Math.min(1, completeness));
  }
  return data?.partial ? 0 : 1;
}

export function shouldPersistPartialSnapshot(data: any): boolean {
  if (!data?.partial) return false;
  const total = Number(data?.total || 0);
  return total > 0 && getSnapshotCompleteness(data) >= MIN_PARTIAL_SNAPSHOT_COMPLETENESS;
}

// Dedupe-adjusted ranking total. dedupeBoardFlights lowers a board's `total` BECAUSE duplicate
// revision rows, operator clones and foreign leaks were removed — not because coverage shrank.
// Ranking on the raw total let a stale pre-dedupe snapshot (e.g. 717 rows, 17 of them dupes)
// permanently outrank every fresh deduped board (700 rows) and refuse overwrite. A candidate
// carrying meta.dedupe therefore ranks on total + rows it dropped; a snapshot without
// meta.dedupe keeps its raw total, so equal underlying coverage ranks equal.
function getRankingTotal(data: any): number {
  const total = Number(data?.total || 0);
  const dedupe = data?.meta?.dedupe;
  if (!dedupe) return total;
  return total
    + (Number(dedupe.revisions) || 0)
    + (Number(dedupe.operatorClones) || 0)
    + (Number(dedupe.foreign) || 0);
}

export function isSnapshotCandidateBetter(candidate: any, existing: any): boolean {
  if (!existing) return true;
  if (!candidate?.partial) return true;
  if (!existing?.partial) return false;

  const candidateCompleteness = getSnapshotCompleteness(candidate);
  const existingCompleteness = getSnapshotCompleteness(existing);
  if (candidateCompleteness > existingCompleteness + 0.01) return true;
  if (candidateCompleteness + 0.01 < existingCompleteness) return false;

  const candidateTotal = getRankingTotal(candidate);
  const existingTotal = getRankingTotal(existing);
  if (candidateTotal !== existingTotal) return candidateTotal > existingTotal;

  // Equal dedupe-adjusted totals: a deduped candidate REPLACES an un-deduped existing snapshot —
  // same underlying coverage, but the fresh board is hygienic (and fresher) while the stale
  // dup-laden one would otherwise pin until its 72h TTL.
  if (candidate?.meta?.dedupe && !existing?.meta?.dedupe) return true;

  const candidatePages = Number(candidate?.meta?.pagesSucceeded || 0);
  const existingPages = Number(existing?.meta?.pagesSucceeded || 0);
  return candidatePages > existingPages;
}

// Gate the COMPLETE-snapshot write path (isSnapshotCandidateBetter only guards partial boards —
// it treats every complete candidate as always-better, line 59). Without this a thin-but-complete
// board (transient truncated 200) upserts unconditionally over a richer complete snapshot. Never
// blocks a complete board over a stored partial one, and never blocks a same-or-larger board; only
// a drop past COMPLETE_SNAPSHOT_MIN_RETAIN of the stored complete total is refused.
export function isCompleteSnapshotAcceptable(candidate: any, existing: any): boolean {
  if (!existing) return true;
  if (existing?.partial) return true;
  const existingTotal = Number(existing?.total || 0);
  if (!(existingTotal > 0)) return true;
  const candidateTotal = Number(candidate?.total || 0);
  return candidateTotal >= existingTotal * COMPLETE_SNAPSHOT_MIN_RETAIN;
}

function getSupabaseConfig(): { url: string; key: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url || !key) {
    if (!warnedMissingConfig) {
      console.warn('Schedule snapshots disabled: NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing');
      warnedMissingConfig = true;
    }
    return null;
  }
  return { url, key };
}

export async function getSupabaseAdmin(): Promise<any | null> {
  const config = getSupabaseConfig();
  if (!config) return null;
  if (!supabaseClientPromise) {
    supabaseClientPromise = import('@supabase/supabase-js')
      .then(({ createClient }) => createClient(config.url, config.key, {
        auth: { persistSession: false, autoRefreshToken: false }
      }))
      .catch((error: any) => {
        if (!warnedInitFailure) {
          console.error('Failed to initialize Supabase for schedule snapshots:', error?.message || error);
          warnedInitFailure = true;
        }
        return null;
      });
  }
  return supabaseClientPromise;
}

export async function loadScheduleSnapshot(cacheKey: string): Promise<PersistedScheduleSnapshot | null> {
  const supabase = await getSupabaseAdmin();
  if (!supabase) return null;

  try {
    const { data, error } = await supabase
      .from(SNAPSHOT_TABLE)
      .select('payload, refreshed_at')
      .eq('cache_key', cacheKey)
      .gt('expires_at', new Date().toISOString())
      .limit(1);

    if (error) {
      console.error(`Schedule snapshot read failed for ${cacheKey}:`, error.message);
      return null;
    }

    const row = (data as PersistedSnapshotRow[] | null)?.[0];
    if (!row?.payload) return null;

    const refreshedAt = Date.parse(row.refreshed_at);
    return {
      data: row.payload,
      refreshedAt: Number.isFinite(refreshedAt) ? refreshedAt : Date.now(),
    };
  } catch (error: any) {
    console.error(`Schedule snapshot read threw for ${cacheKey}:`, error?.message || error);
    return null;
  }
}

export async function saveScheduleSnapshot({ cacheKey, hub, dir, ts, data }: SaveScheduleSnapshotArgs): Promise<void> {
  if (!data) return;

  const isCompleteSnapshot = !data.partial;
  // Never persist an empty board (total===0) as a "complete" snapshot. Otherwise a transient
  // empty 200 is stored in Supabase for the full 72h TTL, served as the degraded "good"
  // fallback, and reloaded into the in-memory complete cache on every cold start — a
  // self-sustaining 0-flight board that survives instance recycling. Partial snapshots already
  // require total>0 via shouldPersistPartialSnapshot; this closes the same gap on the complete
  // path. (Audit P0: empty-complete-poisons-fallback)
  if (isCompleteSnapshot && Number(data?.total || 0) === 0) return;
  if (!isCompleteSnapshot && !shouldPersistPartialSnapshot(data)) return;

  const supabase = await getSupabaseAdmin();
  if (!supabase) return;

  const nowIso = new Date().toISOString();
  const expiresAtIso = new Date(Math.max(Date.now() + SNAPSHOT_TTL_MS, (ts * 1000) + SNAPSHOT_TTL_MS)).toISOString();

  try {
    const { data: existingRows, error: existingError } = await supabase
      .from(SNAPSHOT_TABLE)
      .select('payload')
      .eq('cache_key', cacheKey)
      .limit(1);

    if (existingError) {
      console.error(`Schedule snapshot read-before-write failed for ${cacheKey}:`, existingError.message);
      return;
    }

    const existingPayload = (existingRows as PersistedSnapshotRow[] | null)?.[0]?.payload;
    if (isCompleteSnapshot) {
      if (!isCompleteSnapshotAcceptable(data, existingPayload)) {
        console.warn(
          `Schedule snapshot skip for ${cacheKey}: complete board (${Number(data?.total || 0)} flights) is materially thinner than the stored complete snapshot (${Number(existingPayload?.total || 0)}); likely a truncated fetch`
        );
        return;
      }
    } else if (!isSnapshotCandidateBetter(data, existingPayload)) {
      return;
    }

    const { error } = await supabase
      .from(SNAPSHOT_TABLE)
      .upsert({
        cache_key: cacheKey,
        hub: hub.toUpperCase(),
        direction: dir,
        day_ts: ts,
        payload: data,
        total: Number(data.total || 0),
        source: String(data?.meta?.source || 'unknown'),
        refreshed_at: nowIso,
        expires_at: expiresAtIso,
        updated_at: nowIso,
      }, {
        onConflict: 'cache_key'
      });

    if (error) {
      console.error(`Schedule snapshot write failed for ${cacheKey}:`, error.message);
    }
  } catch (error: any) {
    console.error(`Schedule snapshot write threw for ${cacheKey}:`, error?.message || error);
  }
}

// Prune snapshot rows past their TTL. cache_key embeds a per-day timestamp (agg:${hub}:${dir}:${ts}
// in api/schedule.ts), so every calendar day mints fresh keys and the upsert only dedupes WITHIN a
// day — nothing else ever deletes the stale rows, so the table grows without bound. loadScheduleSnapshot
// merely filters live rows via .gt('expires_at', now); this is the DELETE the idx_schedule_snapshots_expires_at
// index (sql/003) was created for. Best-effort and idempotent: piggy-backed on the hourly warm cron,
// at most once per run, and any failure is logged, never thrown.
export async function cleanupExpiredSnapshots(): Promise<void> {
  const supabase = await getSupabaseAdmin();
  if (!supabase) return;

  try {
    const { error } = await supabase
      .from(SNAPSHOT_TABLE)
      .delete()
      .lt('expires_at', new Date().toISOString());
    if (error) {
      console.error('Schedule snapshot cleanup failed:', error.message);
    }
  } catch (error: any) {
    console.error('Schedule snapshot cleanup threw:', error?.message || error);
  }
}
