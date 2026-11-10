// ═══ DELAY PREDICTIONS — the board's risk score, logged ~2 h before each hub departure ═══
// Table: sql/021_flight_history_predictions.sql. Rules (pure): src/lib/delay-prediction.js.
// Spec: docs/specs/flight-history.md ("Prediction logging").
//
// Runs as the last step of the warm cron's flight-history work (api/_flight-history.ts finish()),
// inside the same deadline, abort and settle cap, after this run's boards are merged. Per run:
//   1. one select: flight_history legs from a hub, not yet operated, departing 90–155 min from now;
//   2. only if any are due — four GETs to our own CDN-cached endpoints, in parallel, 5 s cap: /api/faa,
//      /api/metar (the nine-hub URL refresh-metar warms), /api/nas, /api/irops. Free upstreams (FAA,
//      aviationweather.gov) or none (/api/irops reads /api/schedule with every paid fallback off), so
//      no AeroDataBox or FR24 spend; a failed request becomes a recorded missing input, never a guess;
//   3. one insert, `on conflict do nothing`: the first pass that sees a leg wins.
// Never throws. Kill switch: DELAY_PREDICTIONS_ENABLED=0 (off/false/no), read per run; it also stops
// with FLIGHT_HISTORY_ENABLED=0, since it reads the archive.

import { peekHubDisruptionMinutes } from './faa.js';
import {
  PREDICTION_COLUMNS,
  PREDICTION_WINDOW_MAX_MIN,
  PREDICTION_WINDOW_MIN_MIN,
  buildPredictionContext,
  hubMetarStations,
  predictLeg,
} from '../src/lib/delay-prediction.js';
import { FLIGHT_HISTORY_COLUMNS, FLIGHT_HISTORY_HUBS } from '../src/lib/flight-history.js';

export const PREDICTIONS_TABLE = 'flight_delay_predictions';
const HISTORY_TABLE = 'flight_history';
/** The four context GETs together may take this long; a slower one is "missing". */
export const PREDICTION_CONTEXT_TIMEOUT_MS = 5_000;
/** Due legs per run: a 65-minute window over nine hubs is ~150–250 departures at the peak. */
const MAX_DUE_ROWS = 600;

const BASE_URL = process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  : process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'https://theblueboard.co';

/** Operator kill switch, read at run time: DELAY_PREDICTIONS_ENABLED=0/off/false/no turns it off. */
export function isDelayPredictionsEnabled(): boolean {
  const setting = String(process.env.DELAY_PREDICTIONS_ENABLED ?? '').trim().toLowerCase();
  return !(setting === '0' || setting === 'off' || setting === 'false' || setting === 'no');
}

export type PredictionBodies = { faa: any; metar: any; nas: any; irops: any };

/**
 * The four endpoint bodies the board's risk model is fed from, each null on any failure. Same URLs
 * and Accept header the dashboard sends (src/app/data/api.ts), so they share its CDN objects.
 */
export async function fetchPredictionBodies(signal?: AbortSignal): Promise<PredictionBodies> {
  const timeout = AbortSignal.timeout(PREDICTION_CONTEXT_TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const get = async (path: string) => {
    try {
      const resp = await fetch(`${BASE_URL}${path}`, {
        signal: combined,
        headers: { Accept: 'application/json', 'User-Agent': 'BlueBoard-CronWarmer/1.0' },
      });
      if (!resp.ok) return null;
      return await resp.json();
    } catch {
      return null;
    }
  };
  const ids = hubMetarStations().stations.join(',');
  const [faa, metar, nas, irops] = await Promise.all([
    get('/api/faa'),
    get(`/api/metar?ids=${ids}`),
    get('/api/nas'),
    get('/api/irops'),
  ]);
  return { faa, metar, nas, irops };
}

export type PredictionSummary = {
  status: 'ok' | 'disabled' | 'error' | 'table_missing';
  due: number;
  logged: number;
  /** Due legs the board would show no prediction for (already left, cancelled, no schedule). */
  ineligible: number;
  /** Missing inputs over the logged predictions, by input. */
  missing: Record<string, number>;
  statements: number;
  error?: string;
};

function isMissingTable(error: any): boolean {
  if (!error) return false;
  if (error.code === '42P01' || error.code === 'PGRST205') return true;
  return /flight_delay_predictions/i.test(String(error.message || '')) && /(does not exist|could not find|schema cache)/i.test(String(error.message || ''));
}

let warnedMissingTable = false;

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * Log this run's due predictions. Never throws.
 *
 * @param opts.supabase      the service-role client the archive already holds.
 * @param opts.nowMs         the prediction time.
 * @param opts.withSignal    applies the archive's per-statement abort signal to a builder.
 * @param opts.signal        the run's abort signal (also aborts the context GETs).
 * @param opts.fetchBodies   for tests.
 */
export async function logDelayPredictions(opts: {
  supabase: any;
  nowMs: number;
  withSignal: (builder: any) => any;
  signal?: AbortSignal;
  fetchBodies?: (signal?: AbortSignal) => Promise<PredictionBodies>;
}): Promise<PredictionSummary> {
  const summary: PredictionSummary = { status: 'ok', due: 0, logged: 0, ineligible: 0, missing: {}, statements: 0 };
  if (!isDelayPredictionsEnabled()) return { ...summary, status: 'disabled' };
  try {
    const nowMin = Math.floor(opts.nowMs / 60000);
    summary.statements++;
    const read = await opts.withSignal(
      opts.supabase
        .from(HISTORY_TABLE)
        .select(FLIGHT_HISTORY_COLUMNS.join(','))
        .gte('service_date', isoDay(opts.nowMs - 86_400_000))
        .lte('service_date', isoDay(opts.nowMs + 86_400_000))
        .in('origin', [...FLIGHT_HISTORY_HUBS])
        .gte('sched_dep', nowMin + PREDICTION_WINDOW_MIN_MIN)
        .lt('sched_dep', nowMin + PREDICTION_WINDOW_MAX_MIN)
        .eq('outcome', 'unknown')
        .limit(MAX_DUE_ROWS),
    );
    if (read?.error) return { ...summary, status: 'error', error: `select: ${read.error.message || read.error}` };
    const rows: any[] = Array.isArray(read?.data) ? read.data : [];
    summary.due = rows.length;
    if (!rows.length) return summary;

    const bodies = await (opts.fetchBodies || fetchPredictionBodies)(opts.signal);
    const ctx = buildPredictionContext(bodies);
    const records: Record<string, unknown>[] = [];
    for (const row of rows) {
      const record = predictLeg(row, ctx, { nowMs: opts.nowMs, hubDisruptionMinutes: peekHubDisruptionMinutes });
      if (!record) { summary.ineligible++; continue; }
      for (const input of String(record.inputs_missing || '').split(',').filter(Boolean)) {
        summary.missing[input] = (summary.missing[input] || 0) + 1;
      }
      const out: Record<string, unknown> = {};
      for (const col of PREDICTION_COLUMNS) out[col] = (record as any)[col] ?? null;
      records.push(out);
    }
    if (!records.length) return summary;
    if (opts.signal?.aborted) return { ...summary, status: 'error', error: 'aborted before insert' };

    summary.statements++;
    const write = await opts.withSignal(
      opts.supabase.from(PREDICTIONS_TABLE).upsert(records, {
        onConflict: 'service_date,flight_no,origin,dest',
        ignoreDuplicates: true,
      }),
    );
    if (write?.error) {
      if (isMissingTable(write.error)) {
        if (!warnedMissingTable) {
          warnedMissingTable = true;
          console.error('sql/021_flight_history_predictions.sql is NOT applied — delay predictions are not being logged.');
        }
        return { ...summary, status: 'table_missing' };
      }
      return { ...summary, status: 'error', error: `insert: ${write.error.message || write.error}` };
    }
    // `logged` counts what was offered; legs an earlier run already logged are kept as they were.
    summary.logged = records.length;
    return summary;
  } catch (e: any) {
    return { ...summary, status: 'error', error: String(e?.message || e).slice(0, 200) };
  }
}

export function __resetDelayPredictionsForTests(): void {
  warnedMissingTable = false;
}
