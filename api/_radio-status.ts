// Air traffic control radio for the ops brief: when, and how often, the brief may pay Enhanced Radar.
//
// TRIGGER: only a covered US hub with a ground stop or ground delay program IN EFFECT (the /api/faa
// facts). Planned programs, delays, weather and quiet days never spend.
//
// THE LEDGER IS THE GUARD (radio_airport_status, sql/022). One row per attempt, inserted BEFORE the
// call with the full $1.50 booked, then updated from X-Charged-Usd. So a timeout, a dropped
// connection or a lambda killed mid-call still counts against both caps and still holds the hub's
// 90-minute window: nothing that may have been charged can be forgotten.
//   - caps: today (UTC) under ENHANCED_RADAR_DAILY_USD_CAP (default $12), this calendar month (UTC)
//     under ENHANCED_RADAR_MONTHLY_USD_CAP (default $100), both checked before every call, including
//     the calls this run already made; an explicit 0 stops all calls;
//   - reuse: a hub with ANY attempt in the last 90 minutes is not called again; its latest good status
//     inside that window is reused across cron runs;
//   - fail closed: no ledger read or no pending row → no call.
// A 402/403 (balance or tier refusal, not charged) stops further calls for the run, and at most
// RADIO_MAX_CALLS_PER_RUN calls go out per run (the rest wait for the next run, ten minutes later).
//
// Reached only through a dynamic import behind ENHANCED_RADAR_ENABLED=1 (api/cron/brief.ts), and the
// client re-checks the flag itself (api/_enhanced-radar.ts).

import { getSupabaseAdmin } from './_schedule-snapshots.js';
import { readUsdCap } from './_feature-spend.js';
import { ER_AIRPORT_STATUS_PRICE_USD, fetchAirportStatus, isEnhancedRadarEnabled } from './_enhanced-radar.js';
import { ER_HUB_FACILITY_IDS, radioFactsFromStatus, radioTriggerHubs } from '../src/lib/brief-radio.js';

export const RADIO_TABLE = 'radio_airport_status';
export const RADIO_REUSE_MS = 90 * 60 * 1000;
/** Calls are sequential (each one's charge feeds the next cap check); two per run keeps the cron inside its maxDuration. The rest wait ten minutes. */
export const RADIO_MAX_CALLS_PER_RUN = 2;
export const RADIO_DEFAULT_DAILY_CAP_USD = 12;
export const RADIO_DEFAULT_MONTHLY_CAP_USD = 100;

export function radioDailyCapUsd(): number { return readUsdCap('ENHANCED_RADAR_DAILY_USD_CAP', RADIO_DEFAULT_DAILY_CAP_USD); }
export function radioMonthlyCapUsd(): number { return readUsdCap('ENHANCED_RADAR_MONTHLY_USD_CAP', RADIO_DEFAULT_MONTHLY_CAP_USD); }

type LedgerRow = { id: number; hub: string; requested_at: string; status: 'pending' | 'ok' | 'error'; charged_usd: number | string };

export type RadioHubReport = {
  hub: string;
  action: 'reused' | 'called' | 'skipped_recent_attempt' | 'cap_reached' | 'refused_this_run' | 'deferred_run_limit' | 'ledger_write_failed';
  ok?: boolean;
  chargedUsd?: number;
  error?: string | null;
  attemptAt?: string;
};

export type RadioReport = {
  enabled: boolean;
  hubs: RadioHubReport[];
  spentTodayUsd?: number;
  spentMonthUsd?: number;
  error?: string;
};

const utcDayStartIso = (ms: number) => `${new Date(ms).toISOString().slice(0, 10)}T00:00:00.000Z`;
const utcMonthStartIso = (ms: number) => `${new Date(ms).toISOString().slice(0, 7)}-01T00:00:00.000Z`;
const usd = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : ER_AIRPORT_STATUS_PRICE_USD);
/**
 * A ledger row's time in epoch ms. PostgREST returns timestamptz as "2026-11-10T23:06:28.123+00:00",
 * not our "…Z" form, so times are compared as numbers, never as strings. An unreadable time counts
 * as NOW: inside every window, so it blocks a call rather than allowing one.
 */
function rowMs(row: { requested_at: string }, nowMs: number): number {
  const ms = Date.parse(String(row.requested_at));
  return Number.isFinite(ms) ? ms : nowMs;
}

/**
 * Radio facts for the hubs whose FAA programs call for them. Never throws.
 * @param faa      the /api/faa payload the brief collected
 * @param nowMs    the run's clock
 */
export async function collectRadioFacts(
  faa: any[] | null,
  nowMs: number,
  deps: { fetchImpl?: typeof fetch } = {},
): Promise<{ facts: any[]; report: RadioReport }> {
  const report: RadioReport = { enabled: isEnhancedRadarEnabled(), hubs: [] };
  if (!report.enabled) return { facts: [], report };
  const hubs = radioTriggerHubs(faa);
  if (hubs.length === 0) return { facts: [], report };

  const supabase = await getSupabaseAdmin().catch(() => null);
  if (!supabase || typeof supabase.from !== 'function') return { facts: [], report: { ...report, error: 'ledger unavailable' } };

  // One read covers both caps and every hub's 90-minute window: this month's attempts (≤ ~250 rows).
  const monthStart = utcMonthStartIso(nowMs);
  const { data, error } = await supabase
    .from(RADIO_TABLE)
    .select('id, hub, requested_at, status, charged_usd')
    .gte('requested_at', monthStart)
    .order('requested_at', { ascending: false })
    .limit(2000);
  if (error) {
    console.error('radio ledger read failed (no Enhanced Radar calls this run):', error.message || error);
    return { facts: [], report: { ...report, error: 'ledger read failed' } };
  }
  const rows = (data || []) as LedgerRow[];
  const dayStartMs = Date.parse(utcDayStartIso(nowMs));
  let spentMonth = rows.reduce((sum, r) => sum + usd(r.charged_usd), 0);
  let spentToday = rows.filter((r) => rowMs(r, nowMs) >= dayStartMs).reduce((sum, r) => sum + usd(r.charged_usd), 0);
  const dailyCap = radioDailyCapUsd();
  const monthlyCap = radioMonthlyCapUsd();
  const windowStartMs = nowMs - RADIO_REUSE_MS;

  const facts: any[] = [];
  let refused = false;
  let calls = 0;
  for (const hub of hubs) {
    const recent = rows
      .filter((r) => r.hub === hub && rowMs(r, nowMs) > windowStartMs)
      .sort((a, b) => rowMs(b, nowMs) - rowMs(a, nowMs));
    if (recent.length > 0) {
      const good = recent.find((r) => r.status === 'ok');
      if (good) {
        const { data: payloadRows } = await supabase.from(RADIO_TABLE).select('payload').eq('id', good.id).limit(1);
        const payload = (payloadRows as Array<{ payload: any }> | null)?.[0]?.payload;
        if (payload) facts.push(...radioFactsFromStatus(hub, payload, { nowMs }));
        report.hubs.push({ hub, action: 'reused', attemptAt: good.requested_at });
      } else {
        report.hubs.push({ hub, action: 'skipped_recent_attempt', attemptAt: recent[0].requested_at });
      }
      continue;
    }
    if (refused) { report.hubs.push({ hub, action: 'refused_this_run' }); continue; }
    if (calls >= RADIO_MAX_CALLS_PER_RUN) { report.hubs.push({ hub, action: 'deferred_run_limit' }); continue; }
    if (spentToday + ER_AIRPORT_STATUS_PRICE_USD > dailyCap || spentMonth + ER_AIRPORT_STATUS_PRICE_USD > monthlyCap) {
      report.hubs.push({ hub, action: 'cap_reached' });
      continue;
    }

    // Book the full price BEFORE the call. If this write fails there is no record, so no call.
    const requestedAt = new Date(nowMs).toISOString();
    const facilityId = (ER_HUB_FACILITY_IDS as Record<string, string>)[hub];
    const inserted = await supabase
      .from(RADIO_TABLE)
      .insert({ hub, facility_id: facilityId, requested_at: requestedAt, status: 'pending', charged_usd: ER_AIRPORT_STATUS_PRICE_USD })
      .select('id')
      .limit(1);
    const attemptId = Number((inserted?.data as Array<{ id: number }> | null)?.[0]?.id);
    if (inserted?.error || !Number.isFinite(attemptId)) {
      console.error(`radio ledger write failed for ${hub} (not calling Enhanced Radar):`, inserted?.error?.message || 'no id');
      report.hubs.push({ hub, action: 'ledger_write_failed' });
      continue;
    }
    spentToday += ER_AIRPORT_STATUS_PRICE_USD;
    spentMonth += ER_AIRPORT_STATUS_PRICE_USD;
    calls++;

    const result = await fetchAirportStatus(facilityId, { fetchImpl: deps.fetchImpl });
    // Settle the booking at what the call actually cost (the header), or keep the full price.
    spentToday += result.chargedUsd - ER_AIRPORT_STATUS_PRICE_USD;
    spentMonth += result.chargedUsd - ER_AIRPORT_STATUS_PRICE_USD;
    const { error: updateError } = await supabase
      .from(RADIO_TABLE)
      .update({
        status: result.ok ? 'ok' : 'error',
        http_status: result.status,
        charged_usd: result.chargedUsd,
        balance_usd: result.balanceUsd,
        request_id: result.requestId,
        payload: result.ok ? result.data : null,
        error: result.error ? String(result.error).slice(0, 300) : null,
      })
      .eq('id', attemptId);
    if (updateError) console.error(`radio ledger update failed for ${hub} (left booked at the full price):`, updateError.message || updateError);

    report.hubs.push({ hub, action: 'called', ok: result.ok, chargedUsd: result.chargedUsd, error: result.error, attemptAt: requestedAt });
    if (result.status === 402 || result.status === 403) refused = true;
    if (result.ok && result.data) facts.push(...radioFactsFromStatus(hub, result.data, { nowMs }));
  }

  report.spentTodayUsd = Math.round(spentToday * 1000) / 1000;
  report.spentMonthUsd = Math.round(spentMonth * 1000) / 1000;
  return { facts, report };
}
