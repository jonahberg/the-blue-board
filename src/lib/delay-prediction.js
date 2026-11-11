// ═══ DELAY PREDICTIONS, LOGGED BEFORE THE FACT ═══
// The risk scorecard can only grade predictions that were written down before the flight. The board
// computes the delay-risk score in the browser (src/app/views/schedule/useBoardModel.ts computeRisk)
// and keeps nothing; this module recomputes it on the server, once per hub departure ~2 h out, from
// the same functions and the same sources, and says in the record whatever it could not match.
// Spec: docs/specs/flight-history.md ("Prediction logging"). Writer: api/_delay-predictions.ts.
//
// Inputs, and where the server gets each one (all already cached; nothing metered):
//   - the row: the leg's flight_history row (the cron's last board for it; its age is recorded);
//   - originFaa / destinationFaa: /api/faa → buildFaaIndex()            (the browser's own call);
//   - originWeather / destinationWeather: /api/metar for the nine hubs, the exact URL refresh-metar
//     warms every 5 min → resolveWeather().weatherOps. A non-hub destination's METAR is NOT in that
//     set (the browser fetches it for the airports on its loaded boards) → recorded as missing;
//   - originOtp: serverOtpFromMetrics(/api/irops hubMetrics) — the board's default; a browser with a
//     board ≥ 30 min fresher than /api/irops uses its own reading instead (arbitrateHubHealth);
//   - originIrops / destinationIrops: iropsHubRates(/api/irops hubMetrics);
//   - plannedTmis: /api/nas `planned`;
//   - hub disruption minutes for the status classifier: the cron's cached FAA disruption map.
// The board passes no inbound aircraft to the model, so neither does this.
//
// Pure: no clock, no I/O.

import { computeDelayRiskModel, riskTimesForRow, HUB_COORDINATES, HUB_RISK_PROFILES } from './delay-risk.js';
import { buildFaaIndex } from './faa-context.js';
import { HUB_TZ } from './hubTz.js';
import { iropsHubRates } from './irops-score.js';
import { serverOtpFromMetrics } from './hub-health.js';
import { classifySchedStatus } from './schedule-status.js';
import { collectMetarStations, indexMetarByKey, resolveWeather } from './weather-cards.js';
import { normalizeMetarPayload } from './metar.js';

/**
 * Which model produced a prediction: `<git short hash of the last change to src/lib/delay-risk.js>.
 * <server input set>`. b5fd1bd = v1.19.0 (Oct 28 2026, riskTimesForRow / liveConditionsApply).
 * s1 = the input set described above. tests/delay-prediction.test.js pins the model's output on fixed
 * scenarios: when delay-risk.js changes, that test fails until this is bumped.
 */
export const DELAY_RISK_MODEL_REV = 'b5fd1bd';
export const PREDICTION_INPUT_SET = 's1';
export const PREDICTION_MODEL_VERSION = `${DELAY_RISK_MODEL_REV}.${PREDICTION_INPUT_SET}`;

/**
 * A leg is predicted by the first cron pass that sees its scheduled departure within
 * PREDICTION_WINDOW_MAX_MIN; with the cron every 30 min that pass falls 125–155 min out. A leg a
 * missed run skipped is still caught down to PREDICTION_WINDOW_MIN_MIN. `lead_min` records which.
 */
export const PREDICTION_WINDOW_MIN_MIN = 90;
export const PREDICTION_WINDOW_MAX_MIN = 155;

/** A row older than this is staler than anything the board's 1 h CDN copy could show. */
export const BOARD_FRESHNESS_MIN = 60;

/** The board only shows a prediction for these classifier keys (useBoardModel computeRisk). */
const PREDICTABLE_KEYS = new Set(['scheduled', 'estimated', 'delayed']);
const HUBS = new Set(Object.keys(HUB_TZ));

// mapAeroStatus (api/_schedule-aerodatabox.ts) from the stored, lowercased provider word.
function genericFromWord(word) {
  const w = String(word || '').toLowerCase().replace(/[^a-z]/g, '');
  if (w === 'canceled' || w === 'cancelled') return { text: 'canceled', type: 'canceled', diverted: false };
  if (w === 'canceleduncertain') return { text: 'canceled_uncertain', type: 'canceled_uncertain', diverted: false };
  if (w === 'diverted') return { text: 'landed', type: '', diverted: true };
  if (w === 'arrived' || w === 'landed') return { text: 'landed', type: '', diverted: false };
  if (w === 'enroute' || w === 'approaching') return { text: 'en-route', type: '', diverted: false };
  if (w === 'departed') return { text: 'departed', type: '', diverted: false };
  if (w === 'delayed') return { text: 'delayed', type: '', diverted: false };
  return { text: 'scheduled', type: '', diverted: false };
}

const isReal = (basis) => basis === 'gate' || basis === 'actual' || basis === 'runway';
const sec = (minutes) => (Number.isFinite(minutes) && minutes > 0 ? minutes * 60 : null);

/**
 * A flight_history row back in board-row shape — what riskTimesForRow() and classifySchedStatus()
 * read. Real times go back to `real`, estimates to `estimated`, exactly as the board carried them.
 */
export function boardRowFromHistory(row) {
  const generic = genericFromWord(row.status);
  const side = (at, basis) => ({ real: isReal(basis) ? sec(at) : null, est: basis === 'estimate' ? sec(at) : null });
  const dep = side(row.dep_at, row.dep_basis);
  const arr = side(row.arr_at, row.arr_basis);
  return {
    identification: { number: { default: row.flight_no } },
    status: { generic: { status: { text: generic.text, diverted: generic.diverted }, type: generic.type }, text: row.status || '', live: false },
    time: {
      scheduled: { departure: sec(row.sched_dep), arrival: sec(row.sched_arr) },
      real: { departure: dep.real, arrival: arr.real },
      estimated: { departure: dep.est, arrival: arr.est },
    },
    airport: { origin: { code: { iata: row.origin } }, destination: { code: { iata: row.dest } } },
    _source: {},
  };
}

/** The nine hub stations in the warmed request's order (refresh-metar.ts HUB_ICAOS), and their keys. */
export function hubMetarStations() {
  return collectMetarStations({ routes: [], rows: [], getStation: () => '' });
}

/**
 * The model's shared inputs from the four endpoint bodies (null = that request failed).
 *
 * @param {{faa?: any, metar?: any, nas?: any, irops?: any}} bodies
 */
export function buildPredictionContext({ faa = null, metar = null, nas = null, irops = null } = {}) {
  const available = {
    faa: Array.isArray(faa),
    metar: Array.isArray(metar),
    nas: !!nas && typeof nas === 'object' && !Array.isArray(nas),
    irops: !!irops && typeof irops === 'object' && !!irops.hubMetrics && typeof irops.hubMetrics === 'object',
  };
  const weatherOpsByHub = {};
  if (available.metar) {
    const { stationToKey } = hubMetarStations();
    const byKey = indexMetarByKey(normalizeMetarPayload(metar), stationToKey);
    for (const [key, record] of Object.entries(byKey)) weatherOpsByHub[key] = resolveWeather(record).weatherOps;
  }
  const hubOtp = {};
  if (available.irops) {
    for (const [hub, entry] of Object.entries(irops.hubMetrics)) {
      const otp = serverOtpFromMetrics(entry);
      if (otp !== null) hubOtp[hub] = otp;
    }
  }
  return {
    available,
    faaIndex: available.faa ? buildFaaIndex(faa) : {},
    weatherOpsByHub,
    plannedTmis: available.nas ? nas.planned || null : null,
    hubOtp,
    iropsHubRates: available.irops ? iropsHubRates(irops.hubMetrics) : {},
  };
}

/**
 * One leg's prediction record, or null when the board would show no prediction for it (it is not
 * a hub departure, has no provider schedule, is outside the window, or the classifier says it has
 * already left / is cancelled).
 *
 * @param {object} row  a flight_history row.
 * @param {ReturnType<typeof buildPredictionContext>} ctx
 * @param {{nowMs: number, hubDisruptionMinutes?: (hub: string) => number}} opts
 */
export function predictLeg(row, ctx, { nowMs, hubDisruptionMinutes = () => 0 }) {
  if (!row || !HUBS.has(row.origin) || !(row.sched_dep > 0)) return null;
  if (isReal(row.dep_basis) || row.outcome !== 'unknown') return null;
  const nowMin = Math.floor(nowMs / 60000);
  const leadMin = row.sched_dep - nowMin;
  if (leadMin < PREDICTION_WINDOW_MIN_MIN || leadMin >= PREDICTION_WINDOW_MAX_MIN) return null;

  const flight = boardRowFromHistory(row);
  const minutes = Number(hubDisruptionMinutes(row.origin)) || 0;
  const status = classifySchedStatus(flight, 'departures', Math.floor(nowMs / 1000), { hubDisruptionMinutes: minutes > 0 ? minutes : 0 });
  if (!PREDICTABLE_KEYS.has(status?.key)) return null;

  // Exactly the board's input object (useBoardModel computeRisk), on a departures board: the origin
  // is the board's hub, the destination the row's other airport.
  const depHub = row.origin;
  const arrHub = row.dest;
  const { scheduledTime, comparisonTime, delayBaseTime } = riskTimesForRow(flight);
  const model = computeDelayRiskModel({
    currentFlightNumber: row.flight_no,
    nowMs,
    scheduledTime,
    comparisonTime,
    delayBaseTime,
    originHub: depHub,
    destinationHub: arrHub,
    originFaa: ctx.faaIndex[depHub],
    destinationFaa: ctx.faaIndex[arrHub],
    originWeather: ctx.weatherOpsByHub[depHub],
    destinationWeather: ctx.weatherOpsByHub[arrHub],
    originOtp: ctx.hubOtp[depHub],
    timeZone: HUB_TZ[depHub] || 'America/Chicago',
    originCoordinates: HUB_COORDINATES[depHub],
    hubProfile: HUB_RISK_PROFILES[depHub],
    originIrops: ctx.iropsHubRates[depHub],
    destinationIrops: ctx.iropsHubRates[arrHub],
    plannedTmis: ctx.plannedTmis,
  });

  // What this prediction did not have that the board would. An airport missing from a GOOD FAA
  // answer is not missing (no program there); a failed request is.
  const missing = [];
  if (!ctx.available.faa) missing.push('faa');
  if (!ctx.available.nas) missing.push('nas');
  if (!ctx.available.irops) missing.push('irops');
  if (!ctx.weatherOpsByHub[depHub]) missing.push('origin_weather');
  if (!ctx.weatherOpsByHub[arrHub]) missing.push('dest_weather');
  const rowAgeMin = Math.max(0, nowMin - (Number(row.last_seen) || 0));

  const factors = [];
  for (const c of model.components || []) {
    if (c?.id && !factors.includes(c.id)) factors.push(c.id);
    if (factors.length === 3) break;
  }

  return {
    service_date: row.service_date,
    flight_no: row.flight_no,
    origin: row.origin,
    dest: row.dest,
    predicted_at: nowMin,
    lead_min: leadMin,
    row_age_min: Math.min(rowAgeMin, 32767),
    score: model.score,
    band: model.label,
    factors: factors.join(','),
    inputs_missing: missing.length ? missing.join(',') : null,
    same_inputs_as_board: missing.length === 0 && rowAgeMin <= BOARD_FRESHNESS_MIN,
    model_version: PREDICTION_MODEL_VERSION,
  };
}

/** Every column the writer inserts, in table order. */
export const PREDICTION_COLUMNS = Object.freeze([
  'service_date', 'predicted_at', 'lead_min', 'row_age_min', 'score', 'same_inputs_as_board',
  'flight_no', 'origin', 'dest', 'band', 'factors', 'inputs_missing', 'model_version',
]);
