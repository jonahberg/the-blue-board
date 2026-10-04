// ═══ EXPRESS TAILS — the United Express fleet, discovered from the live feed (Supabase) ═══
// Table: sql/018_express_tails.sql. WRITE: api/cron/watch-alerts.ts, from the complete United
// live feed it already reads every 5 minutes, in two wall-clock slots per hour. READ:
// api/express-fleet.ts. The qualifying rule (Express operator callsign + United flight number +
// US registration + regional type) is src/lib/express-fleet.js `expressTailFromFlight`.
//
// Upserts carry reg, operator, fr24_type, last_flight and last_seen — never first_seen (its insert
// default must survive) and never model (the board backfill's, kept on update).
//
// Strictly optional, like airborne_samples: no service-role env → no-op; a missing table → one log
// line per instance, then quiet no-ops. Nothing here throws.

import { getSupabaseAdmin } from './_schedule-snapshots.js';
import { EXPRESS_STALE_DAYS, expressTailRows, isExpressWriteSlot } from '../src/lib/express-fleet.js';

export const EXPRESS_TAILS_TABLE = 'express_tails';
const PAGE_ROWS = 1000;
const MAX_PAGES = 3;

let warnedMissingTable = false;

export function isMissingExpressTable(error: any): boolean {
  if (!error) return false;
  if (error.code === '42P01' || error.code === 'PGRST205') return true;
  const message = String(error.message || '');
  return /express_tails/i.test(message) && /(does not exist|could not find|schema cache)/i.test(message);
}

function logExpressError(op: string, error: any): void {
  if (isMissingExpressTable(error)) {
    if (!warnedMissingTable) {
      warnedMissingTable = true;
      console.error('sql/018_express_tails.sql is NOT applied — the United Express fleet is not being recorded.');
    }
    return;
  }
  console.warn(`express-tails ${op} failed:`, error?.message || error);
}

export type ExpressRecordResult = { recorded: number; reason?: string };

/** Upsert every qualifying tail in one parsed feed read. Never throws. */
export async function recordExpressTails(parsedFlights: any[] | null, atMs: number = Date.now()): Promise<ExpressRecordResult> {
  try {
    if (!Array.isArray(parsedFlights) || parsedFlights.length === 0) return { recorded: 0, reason: 'no feed' };
    if (!isExpressWriteSlot(atMs)) return { recorded: 0, reason: 'not a write slot' };
    const seenAt = new Date(atMs).toISOString();
    const rows = expressTailRows(parsedFlights).map((row) => ({ ...row, last_seen: seenAt }));
    if (rows.length === 0) return { recorded: 0, reason: 'no express tails in feed' };
    const supabase = await getSupabaseAdmin();
    if (!supabase || typeof supabase.from !== 'function') return { recorded: 0, reason: 'unconfigured' };
    const { error } = await supabase.from(EXPRESS_TAILS_TABLE).upsert(rows, { onConflict: 'reg' });
    if (error) {
      logExpressError('write', error);
      return { recorded: 0, reason: isMissingExpressTable(error) ? 'table missing' : 'write failed' };
    }
    return { recorded: rows.length };
  } catch (e: any) {
    console.warn('express-tails write threw:', e?.message || e);
    return { recorded: 0, reason: 'write threw' };
  }
}

export type ExpressTailOut = { r: string; op: string; ft: string | null; m: string | null; lf: string | null; fs: string; ls: string };
export type ExpressLoadResult = { ok: true; tails: ExpressTailOut[] } | { ok: false; reason: string };

/** Tails seen in the last EXPRESS_STALE_DAYS days, by registration. Never throws. */
export async function loadExpressTails(nowMs: number = Date.now()): Promise<ExpressLoadResult> {
  try {
    const supabase = await getSupabaseAdmin();
    if (!supabase || typeof supabase.from !== 'function') return { ok: false, reason: 'unconfigured' };
    const sinceIso = new Date(nowMs - EXPRESS_STALE_DAYS * 86_400_000).toISOString();
    const tails: ExpressTailOut[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const from = page * PAGE_ROWS;
      const { data, error } = await supabase
        .from(EXPRESS_TAILS_TABLE)
        .select('reg, operator, fr24_type, model, last_flight, first_seen, last_seen')
        .gte('last_seen', sinceIso)
        .order('reg', { ascending: true })
        .range(from, from + PAGE_ROWS - 1);
      if (error) {
        logExpressError('read', error);
        return { ok: false, reason: isMissingExpressTable(error) ? 'table missing' : 'read failed' };
      }
      const rows = (data || []) as any[];
      for (const row of rows) {
        if (!row?.reg || !row?.operator) continue;
        tails.push({
          r: String(row.reg),
          op: String(row.operator),
          ft: row.fr24_type ?? null,
          m: row.model ?? null,
          lf: row.last_flight ?? null,
          fs: String(row.first_seen || ''),
          ls: String(row.last_seen || ''),
        });
      }
      if (rows.length < PAGE_ROWS) break;
    }
    return { ok: true, tails };
  } catch (e: any) {
    console.warn('express-tails read threw:', e?.message || e);
    return { ok: false, reason: 'read threw' };
  }
}

export function __resetExpressTailsForTests(): void {
  warnedMissingTable = false;
}
