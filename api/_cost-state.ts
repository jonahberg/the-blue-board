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

// ── AeroDataBox daily unit budget ──
//
// The schedule provider is METERED (RapidAPI bills per call: 1 board = 2 FIDS calls = 4 units).
// The per-IP rate limiter is in-memory per lambda instance, so it cannot bound global spend under
// fan-out — one IP at the allowed rate can drain a monthly tier in hours. This counter is the
// cross-instance hard stop: once the day's units cross the budget, fetchViaAeroDataBox refuses to
// call upstream until the next UTC day. Persistence uses the increment_adb_units RPC
// (sql/009_provider_spend.sql); like the quota block above, every Supabase failure degrades to
// in-memory per-instance accounting — never worse than no guard at all.

const ADB_HYDRATE_TTL_MS = 10_000;

let adbDay = '';            // UTC day (YYYY-MM-DD) the counter applies to
let adbUnits = 0;           // units spent today, as best known by this instance
let lastAdbHydratedAt = 0;

function utcToday(): string {
  return new Date().toISOString().slice(0, 10);
}

// Schema-missing must be loudly distinguishable from a transient Supabase blip: with sql/009
// unapplied, the cross-instance ceiling silently doesn't exist (per-instance only) while
// everything else looks healthy — the same invisible-drift failure mode as the migration-006
// incident. PGRST202 = missing RPC; 42P01 = missing table.
let warnedAdbSchemaMissing = false;
function logAdbPersistError(op: string, error: { code?: string; message?: string }): void {
  const code = String(error?.code || '');
  const message = String(error?.message || '');
  if (code === 'PGRST202' || code === '42P01' || /increment_adb_units.*not.*found|schedule_provider_spend.*does not exist/i.test(message)) {
    if (!warnedAdbSchemaMissing) {
      warnedAdbSchemaMissing = true;
      console.error(
        'sql/009_provider_spend.sql is NOT applied — the AeroDataBox budget is per-instance only (no cross-instance ceiling). Apply it via the Supabase SQL editor.'
      );
    }
    return;
  }
  console.error(`adb-spend ${op} failed:`, message);
}

function rollAdbDay(): void {
  const today = utcToday();
  if (adbDay !== today) {
    adbDay = today;
    adbUnits = 0;
  }
}

export function getAdbUnitsToday(): number {
  rollAdbDay();
  return adbUnits;
}

export function getAdbDailyUnitBudget(): number {
  const configured = Number(process.env.AERODATABOX_DAILY_UNIT_BUDGET);
  return Number.isFinite(configured) && configured > 0 ? configured : 400;
}

/** True once today's known spend has reached the daily budget. Sync; safe in the hot path. */
export function isAdbBudgetExhausted(): boolean {
  return getAdbUnitsToday() >= getAdbDailyUnitBudget();
}

/**
 * Record provider spend: bump the in-memory counter immediately, then write-through via the
 * atomic increment RPC and adopt the returned cross-instance total. Callers may ignore the
 * promise (fire-and-forget); never throws.
 */
export async function recordAdbUnits(units: number): Promise<void> {
  const n = Number(units);
  if (!Number.isFinite(n) || n <= 0) return;
  rollAdbDay();
  adbUnits += n;
  const issuedForDay = adbDay;

  try {
    const supabase = typeof getSupabaseAdmin === 'function' ? await getSupabaseAdmin() : null;
    if (!supabase || typeof supabase.rpc !== 'function') return;

    const { data, error } = await supabase.rpc('increment_adb_units', { p_day: issuedForDay, p_units: n });
    if (error) {
      logAdbPersistError('increment', error);
      return;
    }
    const total = Number(data);
    rollAdbDay();
    // Only adopt the returned total if UTC midnight did not pass mid-flight — it is the running
    // total for the day the RPC was issued for, and adopting yesterday's total into a fresh day
    // would falsely block the provider until the next reset.
    if (Number.isFinite(total) && adbDay === issuedForDay) adbUnits = Math.max(adbUnits, total);
  } catch (error: any) {
    console.error('adb-spend increment threw:', error?.message || error);
  }
}

/**
 * Pull today's cross-instance spend into the in-memory counter, at most once per
 * ADB_HYDRATE_TTL_MS. Never throws; on any failure the in-memory value stands.
 */
export async function hydrateAdbSpend(): Promise<number> {
  rollAdbDay();
  const now = Date.now();
  if (now - lastAdbHydratedAt < ADB_HYDRATE_TTL_MS) return adbUnits;
  lastAdbHydratedAt = now;
  const issuedForDay = adbDay;

  try {
    const supabase = typeof getSupabaseAdmin === 'function' ? await getSupabaseAdmin() : null;
    if (!supabase || typeof supabase.from !== 'function') return adbUnits;

    const { data, error } = await supabase
      .from('schedule_provider_spend')
      .select('units')
      .eq('day', issuedForDay)
      .limit(1);
    if (error) {
      logAdbPersistError('read', error);
      return adbUnits;
    }
    const units = Number((data as Array<{ units: number }> | null)?.[0]?.units);
    rollAdbDay();
    // Same mid-flight day-rollover guard as recordAdbUnits: never adopt yesterday's total into a
    // fresh day.
    if (Number.isFinite(units) && adbDay === issuedForDay) adbUnits = Math.max(adbUnits, units);
    return adbUnits;
  } catch (error: any) {
    console.error('adb-spend read threw:', error?.message || error);
    return adbUnits;
  }
}

/** Test helper: clear ADB spend state so it does not leak across tests. Production never calls it. */
export function __resetAdbSpendForTests(): void {
  adbDay = '';
  adbUnits = 0;
  lastAdbHydratedAt = 0;
  warnedAdbSchemaMissing = false;
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
