const SNAPSHOT_TABLE = 'schedule_snapshots';
const SNAPSHOT_TTL_MS = 72 * 60 * 60 * 1000;
const MIN_PARTIAL_SNAPSHOT_COMPLETENESS = 0.25;

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

export function isSnapshotCandidateBetter(candidate: any, existing: any): boolean {
  if (!existing) return true;
  if (!candidate?.partial) return true;
  if (!existing?.partial) return false;

  const candidateCompleteness = getSnapshotCompleteness(candidate);
  const existingCompleteness = getSnapshotCompleteness(existing);
  if (candidateCompleteness > existingCompleteness + 0.01) return true;
  if (candidateCompleteness + 0.01 < existingCompleteness) return false;

  const candidateTotal = Number(candidate?.total || 0);
  const existingTotal = Number(existing?.total || 0);
  if (candidateTotal !== existingTotal) return candidateTotal > existingTotal;

  const candidatePages = Number(candidate?.meta?.pagesSucceeded || 0);
  const existingPages = Number(existing?.meta?.pagesSucceeded || 0);
  return candidatePages > existingPages;
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
    if (!isCompleteSnapshot) {
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
      if (!isSnapshotCandidateBetter(data, existingPayload)) return;
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
