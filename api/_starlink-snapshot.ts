// Durable Starlink snapshot shared across serverless instances via Supabase.
//
// Why: api/cron/sync-starlink.ts used to stash its result on globalThis.__starlinkCache, but on
// Vercel the cron runs in a different lambda than api/starlink-data.ts, so that global was never
// visible to the serving endpoint — the cron was a no-op that just burned a 727KB upstream fetch
// every 4h, and every cold serving instance independently re-fetched upstream. This is the same
// per-instance-state bug PR #177 fixed for the FR24 cost guard; we fix it the same way (Supabase).
//
// Design mirrors api/_schedule-snapshots.ts: reuse the one service-role client, and make every
// Supabase interaction fully guarded — any failure (unconfigured, migration not applied, mocked
// away in tests) degrades to "no snapshot", never worse than the prior behaviour.

import { getSupabaseAdmin } from './_schedule-snapshots.js';
import type { StarlinkPayload } from './_starlink-normalize.js';

const SNAPSHOT_TABLE = 'starlink_snapshot';
const SNAPSHOT_KEY = 'current';
const SNAPSHOT_TTL_MS = 12 * 60 * 60 * 1000; // 12h — the cron runs every 4h, so this is generous slack

export interface PersistedStarlinkSnapshot {
  data: StarlinkPayload;
  refreshedAt: number; // epoch ms
}

export async function loadStarlinkSnapshot(): Promise<PersistedStarlinkSnapshot | null> {
  const supabase = await getSupabaseAdmin();
  if (!supabase) return null;

  try {
    const { data, error } = await supabase
      .from(SNAPSHOT_TABLE)
      .select('payload, refreshed_at')
      .eq('key', SNAPSHOT_KEY)
      .limit(1);

    if (error) {
      console.error('Starlink snapshot read failed:', error.message);
      return null;
    }

    const row = (data as Array<{ payload: StarlinkPayload | null; refreshed_at: string }> | null)?.[0];
    if (!row?.payload || !Array.isArray(row.payload.aircraft) || row.payload.aircraft.length === 0) {
      return null;
    }

    const refreshedAt = Date.parse(row.refreshed_at);
    return {
      data: row.payload,
      refreshedAt: Number.isFinite(refreshedAt) ? refreshedAt : Date.now(),
    };
  } catch (error: any) {
    console.error('Starlink snapshot read threw:', error?.message || error);
    return null;
  }
}

export async function saveStarlinkSnapshot(payload: StarlinkPayload): Promise<void> {
  // Never persist an empty board — a transient empty 200 must not become the durable fallback.
  if (!payload || !Array.isArray(payload.aircraft) || payload.aircraft.length === 0) return;

  const supabase = await getSupabaseAdmin();
  if (!supabase) return;

  const nowIso = new Date().toISOString();
  const expiresAtIso = new Date(Date.now() + SNAPSHOT_TTL_MS).toISOString();

  try {
    const { error } = await supabase
      .from(SNAPSHOT_TABLE)
      .upsert({
        key: SNAPSHOT_KEY,
        payload,
        total: payload.aircraft.length,
        refreshed_at: nowIso,
        expires_at: expiresAtIso,
        updated_at: nowIso,
      }, { onConflict: 'key' });

    if (error) console.error('Starlink snapshot write failed:', error.message);
  } catch (error: any) {
    console.error('Starlink snapshot write threw:', error?.message || error);
  }
}
