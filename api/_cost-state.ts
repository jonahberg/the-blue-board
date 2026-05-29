// Global cost-guard state shared across serverless instances via Supabase.
//
// Currently tracks the FR24 official-API quota block (402 "credit limit reached"). Once ANY lambda
// hits the credit ceiling, every other lambda should also stop calling the paid official API until
// the block expires. Without a shared store, each cold instance independently re-discovers the 402,
// so real spend scales with instance fan-out (N x the intended per-instance 30-min block).
// (Audit P1/HIGH: per-lambda cost guards do not bound global spend under Vercel fan-out.)
//
// Design: the schedule hot path makes SYNC guard checks, so we mirror the global block into an
// in-memory value rather than awaiting Supabase per request. The async handler calls
// hydrateQuotaBlock() (internally rate-limited to one read per HYDRATE_TTL_MS) before its
// official-fallback decisions, and persistQuotaBlock() write-through fires when a 402 is hit.
// Every Supabase interaction is fully guarded: any failure (unavailable, migration not applied, or
// a test that mocks away the client) degrades to in-memory-only — behaviour is never worse than the
// prior per-instance guard.

import { getSupabaseAdmin } from './_schedule-snapshots.js';

const COST_KEY = 'official_quota_block';
const HYDRATE_TTL_MS = 10_000;

let mirroredBlockedUntil = 0; // global block (epoch ms) as last read from / written to Supabase
let lastHydratedAt = 0;

/** The latest global quota block (epoch ms) known to this instance. Sync; safe in the hot path. */
export function getMirroredQuotaBlockedUntil(): number {
  return mirroredBlockedUntil;
}

/** Clear the in-memory mirror. Used by schedule.ts's resetFallbackBreaker() so module state does
 *  not leak across tests (production never calls it). */
export function resetMirroredQuotaBlock(): void {
  mirroredBlockedUntil = 0;
  lastHydratedAt = 0;
}

/**
 * Pull the latest global quota block from Supabase into the in-memory mirror, at most once per
 * HYDRATE_TTL_MS. Returns the (possibly updated) mirrored value. Never throws; on any failure it
 * returns the current in-memory value so callers degrade to per-instance behaviour.
 */
export async function hydrateQuotaBlock(): Promise<number> {
  const now = Date.now();
  if (now - lastHydratedAt < HYDRATE_TTL_MS) return mirroredBlockedUntil;
  lastHydratedAt = now;

  try {
    const supabase = typeof getSupabaseAdmin === 'function' ? await getSupabaseAdmin() : null;
    if (!supabase) return mirroredBlockedUntil;

    const { data, error } = await supabase
      .from('schedule_cost_state')
      .select('blocked_until')
      .eq('key', COST_KEY)
      .limit(1);
    if (error) {
      console.error('cost-state read failed:', error.message);
      return mirroredBlockedUntil;
    }
    const row = (data as Array<{ blocked_until: string | null }> | null)?.[0];
    const until = row?.blocked_until ? Date.parse(row.blocked_until) : 0;
    if (Number.isFinite(until)) mirroredBlockedUntil = Math.max(mirroredBlockedUntil, until);
    return mirroredBlockedUntil;
  } catch (error: any) {
    console.error('cost-state read threw:', error?.message || error);
    return mirroredBlockedUntil;
  }
}

/**
 * Write-through a new quota block so other instances honour it on their next hydrate. Fire-and-
 * forget from the caller's perspective; never throws.
 */
export async function persistQuotaBlock(blockedUntilMs: number, reason: string): Promise<void> {
  mirroredBlockedUntil = Math.max(mirroredBlockedUntil, blockedUntilMs);

  try {
    const supabase = typeof getSupabaseAdmin === 'function' ? await getSupabaseAdmin() : null;
    if (!supabase) return;

    const { error } = await supabase
      .from('schedule_cost_state')
      .upsert({
        key: COST_KEY,
        blocked_until: new Date(blockedUntilMs).toISOString(),
        reason: String(reason || '').slice(0, 500),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'key' });
    if (error) console.error('cost-state write failed:', error.message);
  } catch (error: any) {
    console.error('cost-state write threw:', error?.message || error);
  }
}
