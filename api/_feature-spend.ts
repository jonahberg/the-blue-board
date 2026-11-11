// Cross-instance daily spend per metered feature (sql/022 feature_spend_daily + increment_feature_spend).
//
// The AI Gateway has ONE $3/day ceiling for the whole project. A feature that loops or misfires
// must hit its OWN cap long before it can starve delay-explain or anything else, so each metered
// feature books its spend here under its own key and checks its own cap before every call. The
// pattern is api/_cost-state.ts's AeroDataBox counter (sql/009), generalised by feature.
//
// FAIL CLOSED: unlike the AeroDataBox counter (which degrades to per-instance accounting so boards
// keep loading), a feature that cannot read its counter does not spend. The brief then publishes its
// template; nothing a visitor needs is lost.

import { getSupabaseAdmin } from './_schedule-snapshots.js';

export const FEATURE_SPEND_TABLE = 'feature_spend_daily';
export const FEATURE_SPEND_RPC = 'increment_feature_spend';

export function utcDay(ms: number = Date.now()): string {
  return new Date(ms).toISOString().slice(0, 10);
}

let warnedSchemaMissing = false;

/** Postgres undefined_table / undefined_function, or PostgREST's schema-cache misses. */
export function isMissingSpendSchema(error: any): boolean {
  if (!error) return false;
  const code = String(error.code || '');
  if (code === '42P01' || code === '42883' || code === 'PGRST202' || code === 'PGRST205') return true;
  return /(feature_spend_daily|increment_feature_spend)/i.test(String(error.message || ''))
    && /(does not exist|could not find|schema cache)/i.test(String(error.message || ''));
}

function logSpendError(op: string, error: any): void {
  if (isMissingSpendSchema(error)) {
    if (!warnedSchemaMissing) {
      warnedSchemaMissing = true;
      console.error('sql/022_ops_brief.sql is NOT applied — feature_spend_daily is missing, so metered features stay switched off (fail closed). Apply it via the Supabase SQL editor.');
    }
    return;
  }
  console.error(`feature-spend ${op} failed:`, error?.message || error);
}

/**
 * A USD cap from an env var. Unset or garbage falls back to the default; an explicit 0 is a kill
 * switch and is honoured (house rule, api/_cost-state.ts getAdbDailyUnitBudget).
 */
export function readUsdCap(envName: string, fallback: number): number {
  const raw = process.env[envName];
  if (raw === undefined || String(raw).trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export type SpendRead = { ok: true; usd: number } | { ok: false; reason: string };

/** Today's (UTC) spend for one feature. Never throws; `ok: false` means "could not read — do not spend". */
export async function getFeatureSpendForDay(feature: string, day: string = utcDay()): Promise<SpendRead> {
  try {
    const supabase = await getSupabaseAdmin();
    if (!supabase || typeof supabase.from !== 'function') return { ok: false, reason: 'unconfigured' };
    const { data, error } = await supabase
      .from(FEATURE_SPEND_TABLE)
      .select('usd')
      .eq('feature', feature)
      .eq('day', day)
      .limit(1);
    if (error) {
      logSpendError('read', error);
      return { ok: false, reason: isMissingSpendSchema(error) ? 'table missing' : 'read failed' };
    }
    const usd = Number((data as Array<{ usd: number | string }> | null)?.[0]?.usd ?? 0);
    return Number.isFinite(usd) ? { ok: true, usd } : { ok: false, reason: 'bad value' };
  } catch (e: any) {
    console.error('feature-spend read threw:', e?.message || e);
    return { ok: false, reason: 'read threw' };
  }
}

/** Sum of a feature's spend from `sinceDay` (inclusive) to today — the monthly guard reads this. */
export async function getFeatureSpendSince(feature: string, sinceDay: string): Promise<SpendRead> {
  try {
    const supabase = await getSupabaseAdmin();
    if (!supabase || typeof supabase.from !== 'function') return { ok: false, reason: 'unconfigured' };
    const { data, error } = await supabase
      .from(FEATURE_SPEND_TABLE)
      .select('usd')
      .eq('feature', feature)
      .gte('day', sinceDay)
      .limit(400);
    if (error) {
      logSpendError('read', error);
      return { ok: false, reason: isMissingSpendSchema(error) ? 'table missing' : 'read failed' };
    }
    let usd = 0;
    for (const row of (data as Array<{ usd: number | string }> | null) || []) {
      const n = Number(row.usd);
      if (!Number.isFinite(n)) return { ok: false, reason: 'bad value' };
      usd += n;
    }
    return { ok: true, usd };
  } catch (e: any) {
    console.error('feature-spend read threw:', e?.message || e);
    return { ok: false, reason: 'read threw' };
  }
}

export type SpendEntry = { usd: number; calls?: number; inputTokens?: number; outputTokens?: number };

/**
 * Book spend atomically (increment_feature_spend). Returns the new daily total when the write landed,
 * or null. Never throws.
 */
export async function recordFeatureSpend(feature: string, entry: SpendEntry, day: string = utcDay()): Promise<number | null> {
  const usd = Number(entry.usd);
  if (!Number.isFinite(usd) || usd < 0) return null;
  try {
    const supabase = await getSupabaseAdmin();
    if (!supabase || typeof supabase.rpc !== 'function') return null;
    const { data, error } = await supabase.rpc(FEATURE_SPEND_RPC, {
      p_feature: feature,
      p_day: day,
      p_usd: usd,
      p_calls: Math.max(0, Math.round(Number(entry.calls ?? 1)) || 0),
      p_input_tokens: Math.max(0, Math.round(Number(entry.inputTokens ?? 0)) || 0),
      p_output_tokens: Math.max(0, Math.round(Number(entry.outputTokens ?? 0)) || 0),
    });
    if (error) {
      logSpendError('increment', error);
      return null;
    }
    const total = Number(data);
    return Number.isFinite(total) ? total : null;
  } catch (e: any) {
    console.error('feature-spend increment threw:', e?.message || e);
    return null;
  }
}

export function __resetFeatureSpendForTests(): void {
  warnedSchemaMissing = false;
}
