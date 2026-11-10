// ═══ FLIGHT HISTORY WRITER — the warm cron's boards, kept as one row per leg (Supabase) ═══
// Spec: docs/specs/flight-history.md. Table: sql/021_flight_history.sql. Rules (pure, tested):
// src/lib/flight-history.js. One-off backfill of the boards already in schedule_snapshots:
// sql/021_flight_history_backfill.sql.
//
// WRITE: api/cron/warm-schedules.ts hands every board it just fetched to `ingest()` and awaits
// `finish()` once, at the end of the run. The boards are the /api/schedule responses the cron
// already paid for — this module makes NO provider call (AeroDataBox, FR24) of its own. Its only
// other read is the reg_sightings ledger (our own table, ≤ ~1,500 rows, once per run, shared cache),
// for the seen-airborne evidence the board overlay uses.
//
// BEST-EFFORT, and it cannot hurt the board writes: a board reaches `ingest()` only after
// /api/schedule has written its snapshot and answered, and the work runs on a promise chain beside
// the remaining warms — never awaited inside the warm loop. Bounded every way:
//   - one board at a time (serialized, so two boards carrying one leg never race their read-merge-write);
//   - ≤ FLIGHT_HISTORY_BATCH_ROWS rows per statement (a large statement has hit the statement timeout
//     here before: the snapshot GC, api/_schedule-snapshots.ts), each with its own abort timeout;
//   - ≤ FLIGHT_HISTORY_MAX_STATEMENTS statements per run;
//   - a hard deadline from the cron (no statement starts after it) and a settle cap: `finish()` waits
//     at most FLIGHT_HISTORY_SETTLE_MS for whatever is still in flight, then aborts it.
// Nothing here throws: no service-role env (vitest, local dev) → no-op; a missing table (sql/021 not
// applied) → one log line per instance, then quiet no-ops; any error is counted, logged, swallowed.
// One summary log line per run. Kill switch: FLIGHT_HISTORY_ENABLED=0 (off/false/no), read per run.

import { getSupabaseAdmin } from './_schedule-snapshots.js';
import { awaitRegSightings, type SightingRecord } from './_reg-sightings.js';
import { applySightingsToBoard } from '../src/lib/reg-overlay.js';
import { boardAsOfMs } from '../src/lib/hub-health.js';
import {
  FLIGHT_HISTORY_COLUMNS,
  archiveRowsFromBoard,
  flightHistoryKey,
  mergeFlightHistoryRow,
  sameFlightHistoryRow,
} from '../src/lib/flight-history.js';

export const FLIGHT_HISTORY_TABLE = 'flight_history';
const CONFLICT_TARGET = 'flight_no,service_date,origin,dest';

/**
 * Rows per select and per upsert. 200 lean rows is a ~60 KB upsert body and a ~1.5 KB `in.(…)`
 * filter, far inside every limit. The select is narrowed to the board's hub (origin on a departures
 * board, dest on an arrivals board) plus the batch's flight numbers and service days, so it returns
 * at most one row per batch row and day — never near PostgREST's 1,000-row page.
 */
export const FLIGHT_HISTORY_BATCH_ROWS = 200;
/** A select/upsert that has not answered in this long is aborted (normal: ~50–150 ms). */
export const FLIGHT_HISTORY_STATEMENT_TIMEOUT_MS = 8_000;
/** The most `finish()` may add to the cron run after its own work is done. */
export const FLIGHT_HISTORY_SETTLE_MS = 15_000;
/** Statements per run. A normal run (4–5 boards × ~4 batches × 2) needs ~40. */
export const FLIGHT_HISTORY_MAX_STATEMENTS = 80;
/** How long the first board waits for the shared reg_sightings cache (api/_reg-sightings.ts). */
export const FLIGHT_HISTORY_SIGHTINGS_WAIT_MS = 2_500;
/** PostgREST's default max-rows; a select that fills it may be truncated, and is not trusted. */
const POSTGREST_PAGE_ROWS = 1000;

/** Operator kill switch, read at run time: FLIGHT_HISTORY_ENABLED=0/off/false/no turns the writer off. */
export function isFlightHistoryEnabled(): boolean {
  const setting = String(process.env.FLIGHT_HISTORY_ENABLED ?? '').trim().toLowerCase();
  return !(setting === '0' || setting === 'off' || setting === 'false' || setting === 'no');
}

export type FlightHistoryStatus = 'ok' | 'disabled' | 'unconfigured' | 'table_missing' | 'budget' | 'error';

export type FlightHistorySummary = {
  status: FlightHistoryStatus;
  boards: number;
  /** Boards handed over but not (fully) written: the run's deadline, the statement cap, or a stop. */
  boardsSkipped: number;
  rows: number;
  inserted: number;
  updated: number;
  unchanged: number;
  /** Board rows that could not become archive rows, by reason (src/lib/flight-history.js). */
  skipped: Record<string, number>;
  /** Extra board rows that mapped to a key already on the board (one leg, several copies). */
  duplicates: number;
  statements: number;
  errors: number;
  /** First error message of the run, for the log line. */
  firstError?: string;
  /** How long `finish()` waited for in-flight work. */
  waitedMs: number;
};

export type FlightHistoryTask = { hub: string; dir: 'departures' | 'arrivals' };

export type FlightHistoryRun = {
  /** Queue one board. Synchronous, never throws, never waits. */
  ingest(board: any, task: FlightHistoryTask): void;
  /** Wait (bounded) for queued boards, log the one summary line, and report. Never rejects. */
  finish(): Promise<FlightHistorySummary>;
};

let warnedMissingTable = false;
let warnedUnconfigured = false;

/** Postgres undefined_table (42P01) or PostgREST's "not in the schema cache" (PGRST205). */
export function isMissingFlightHistoryTable(error: any): boolean {
  if (!error) return false;
  if (error.code === '42P01' || error.code === 'PGRST205') return true;
  const message = String(error.message || '');
  return /flight_history/i.test(message) && /(does not exist|could not find|schema cache)/i.test(message);
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** The columns in table order, so every upserted row names the same column list (PostgREST sends one). */
function toDbRow(row: any): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const col of FLIGHT_HISTORY_COLUMNS) out[col] = row[col] ?? null;
  return out;
}

/**
 * Start one cron run's archive work.
 *
 * @param opts.deadlineMs  epoch ms after which no statement starts and `finish()` stops waiting.
 * @param opts.settleMs    the most `finish()` waits (default FLIGHT_HISTORY_SETTLE_MS).
 * @param opts.now         clock, for tests.
 */
export function startFlightHistoryRun(opts: { deadlineMs: number; settleMs?: number; now?: () => number }): FlightHistoryRun {
  const now = opts.now || Date.now;
  const settleMs = Math.max(0, opts.settleMs ?? FLIGHT_HISTORY_SETTLE_MS);
  const enabled = isFlightHistoryEnabled();
  const controller = new AbortController();
  const summary: FlightHistorySummary = {
    status: enabled ? 'ok' : 'disabled',
    boards: 0,
    boardsSkipped: 0,
    rows: 0,
    inserted: 0,
    updated: 0,
    unchanged: 0,
    skipped: {},
    duplicates: 0,
    statements: 0,
    errors: 0,
    waitedMs: 0,
  };
  // Set once the run must not start more work: unconfigured, table missing, deadline, statement cap.
  let stopped: FlightHistoryStatus | null = enabled ? null : 'disabled';
  let finished = false;
  let queue: Promise<void> = Promise.resolve();
  let supabasePromise: Promise<any | null> | null = null;
  let sightingsPromise: Promise<Map<string, SightingRecord>> | null = null;

  const stop = (status: FlightHistoryStatus) => {
    if (!stopped) stopped = status;
    if (summary.status === 'ok') summary.status = status;
  };
  const noteError = (message: string) => {
    summary.errors++;
    if (!summary.firstError) summary.firstError = message.slice(0, 200);
  };
  const outOfBudget = (): boolean => {
    if (now() >= opts.deadlineMs) { stop('budget'); return true; }
    if (summary.statements >= FLIGHT_HISTORY_MAX_STATEMENTS) { stop('budget'); return true; }
    return false;
  };
  const statementSignal = (): AbortSignal =>
    AbortSignal.any([controller.signal, AbortSignal.timeout(FLIGHT_HISTORY_STATEMENT_TIMEOUT_MS)]);
  const withSignal = (builder: any) => (typeof builder?.abortSignal === 'function' ? builder.abortSignal(statementSignal()) : builder);

  async function ingestBoard(board: any, task: FlightHistoryTask): Promise<void> {
    if (stopped || outOfBudget()) { summary.boardsSkipped++; return; }
    supabasePromise ??= getSupabaseAdmin().catch(() => null);
    const supabase = await supabasePromise;
    if (!supabase || typeof supabase.from !== 'function') { stop('unconfigured'); summary.boardsSkipped++; return; }

    // The seen-airborne override and track stamps (src/lib/reg-overlay.js), from the shared ledger
    // cache. The board usually carries them already from /api/schedule's own overlay; re-applying is
    // idempotent and covers a schedule instance whose ledger cache was cold.
    sightingsPromise ??= awaitRegSightings(FLIGHT_HISTORY_SIGHTINGS_WAIT_MS).catch(() => new Map());
    const sightings = await sightingsPromise;
    const dir = task.dir;
    const hub = String(task.hub || '').toUpperCase();
    const overlaid = sightings.size ? applySightingsToBoard(board, sightings, now(), { dir }) : board;
    const asOfMs = boardAsOfMs(board?.meta?.generatedAt);
    const observedAtSec = Math.floor((asOfMs ?? now()) / 1000);
    const { rows, skipped, duplicates } = archiveRowsFromBoard(overlaid, { dir, hub, observedAtSec });
    summary.boards++;
    summary.rows += rows.length;
    summary.duplicates += duplicates;
    for (const [reason, n] of Object.entries(skipped)) summary.skipped[reason] = (summary.skipped[reason] || 0) + (n as number);

    for (const batch of chunks(rows, FLIGHT_HISTORY_BATCH_ROWS)) {
      if (stopped || outOfBudget()) { summary.boardsSkipped++; return; }
      const flightNos = [...new Set(batch.map((r: any) => r.flight_no))];
      const dates = [...new Set(batch.map((r: any) => r.service_date))];
      summary.statements++;
      const read = await withSignal(
        supabase
          .from(FLIGHT_HISTORY_TABLE)
          .select(FLIGHT_HISTORY_COLUMNS.join(','))
          .eq(dir === 'departures' ? 'origin' : 'dest', hub)
          .in('flight_no', flightNos)
          .in('service_date', dates),
      );
      if (read?.error) {
        if (isMissingFlightHistoryTable(read.error)) {
          if (!warnedMissingTable) {
            warnedMissingTable = true;
            console.error('sql/021_flight_history.sql is NOT applied — the flight-history archive is not being written. Apply it via the Supabase SQL editor.');
          }
          stop('table_missing');
          return;
        }
        // Never write a batch whose stored rows we could not read: an upsert without the merge
        // would replace real times with whatever this board has.
        noteError(`select: ${read.error.message || read.error}`);
        continue;
      }
      const stored = Array.isArray(read?.data) ? read.data : [];
      if (stored.length >= POSTGREST_PAGE_ROWS) { noteError('select: page full, batch not trusted'); continue; }
      const byKey = new Map<string, any>();
      for (const row of stored) byKey.set(flightHistoryKey(row), row);

      const changed: Record<string, unknown>[] = [];
      let inserted = 0;
      let updated = 0;
      for (const incoming of batch) {
        const existing = byKey.get(flightHistoryKey(incoming)) || null;
        const merged = mergeFlightHistoryRow(existing, incoming);
        if (existing && sameFlightHistoryRow(existing, merged)) { summary.unchanged++; continue; }
        changed.push(toDbRow(merged));
        if (existing) updated++; else inserted++;
      }
      if (!changed.length) continue;
      if (stopped || outOfBudget()) { summary.boardsSkipped++; return; }
      summary.statements++;
      const write = await withSignal(
        supabase.from(FLIGHT_HISTORY_TABLE).upsert(changed, { onConflict: CONFLICT_TARGET }),
      );
      if (write?.error) {
        if (isMissingFlightHistoryTable(write.error)) { stop('table_missing'); return; }
        noteError(`upsert: ${write.error.message || write.error}`);
        continue;
      }
      summary.inserted += inserted;
      summary.updated += updated;
    }
  }

  return {
    ingest(board: any, task: FlightHistoryTask): void {
      try {
        if (finished || stopped === 'disabled') return;
        if (!board || !Array.isArray(board.flights) || board.flights.length === 0) return;
        if (task?.dir !== 'departures' && task?.dir !== 'arrivals') return;
        queue = queue
          .then(() => ingestBoard(board, task))
          .catch((e: any) => {
            if (controller.signal.aborted || e?.name === 'AbortError' || e?.name === 'TimeoutError') stop('budget');
            else noteError(String(e?.message || e));
          });
      } catch (e: any) {
        noteError(String(e?.message || e));
      }
    },

    async finish(): Promise<FlightHistorySummary> {
      try {
        finished = true;
        const startedWait = now();
        const wait = Math.max(0, Math.min(settleMs, opts.deadlineMs - startedWait));
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timedOut = await Promise.race([
          queue.then(() => false),
          new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(true), wait); }),
        ]);
        if (timer) clearTimeout(timer);
        if (timedOut) {
          stop('budget');
          controller.abort();
        }
        summary.waitedMs = Math.max(0, now() - startedWait);
        if (summary.status === 'ok' && summary.errors > 0) summary.status = 'error';
        const line =
          `flight-history: ${summary.status} boards=${summary.boards} rows=${summary.rows} inserted=${summary.inserted} ` +
          `updated=${summary.updated} unchanged=${summary.unchanged} duplicates=${summary.duplicates} ` +
          `skipped=${JSON.stringify(summary.skipped)} statements=${summary.statements} errors=${summary.errors} ` +
          `boardsSkipped=${summary.boardsSkipped} waited=${summary.waitedMs}ms` +
          (summary.firstError ? ` firstError=${JSON.stringify(summary.firstError)}` : '');
        if (summary.status === 'unconfigured') {
          if (!warnedUnconfigured) { warnedUnconfigured = true; console.warn(line); }
        } else {
          console.log(line);
        }
      } catch (e: any) {
        summary.status = 'error';
        noteError(String(e?.message || e));
      }
      return { ...summary, skipped: { ...summary.skipped } };
    },
  };
}

export function __resetFlightHistoryForTests(): void {
  warnedMissingTable = false;
  warnedUnconfigured = false;
}
