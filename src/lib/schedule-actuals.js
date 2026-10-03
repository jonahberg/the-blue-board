// ═══ SCHEDULE ACTUALS: NOTHING HAS HAPPENED THAT HAS NOT HAPPENED YET ═══
// Row transforms behind two rules in schedule-plausibility.js (live audit Oct 3 2026, v1.11.3):
//
//   1. An actual time later than the clock is not an actual. AeroDataBox flagged UA845 ORD→GRU
//      "Departed" at its 21:30 CDT departure time, 9.5 hours early, and UA4422 FSD→ORD "Arrived"
//      at a gate time 8 minutes ahead of the clock. Such a time is a forecast: it moves into the
//      estimate and the status steps back to what the remaining facts support.
//   2. A leg longer than any flight is two instances spliced into one row (isImplausibleLegSpan):
//      yesterday's UA2113 with its arrival shifted onto today. It is dropped.
//
// Applied where rows are made (api/_schedule-aerodatabox.ts, against the fetch clock) AND where
// they are served (api/schedule.ts, api/flight-times.ts, against the request clock), because a
// board is served from snapshots up to ~3h old: a time that was future at fetch can be past by
// the time it is read, and the reverse case is the bug. Both functions are pure and never mutate
// their input — served boards are shared cache entries.

import { isFutureActual, isImplausibleLegSpan } from './schedule-plausibility.js';

// Provider states that claim the flight has moved. Anything else (scheduled, delayed, canceled,
// canceled_uncertain) keeps its label when a time is cleared.
const OPERATED_STATES = new Set(['departed', 'en-route', 'landed']);

// The same status objects the AeroDataBox normalizer emits (mapAeroStatus) for a flight that is
// airborne and for one that has not left, so every downstream classifier reads them unchanged.
function enRouteStatus() {
  return { generic: { status: { text: 'en-route', diverted: false }, type: '' }, text: 'en route', icon: 'green', live: true };
}

function expectedStatus() {
  return { generic: { status: { text: 'scheduled', diverted: false }, type: '' }, text: 'expected', icon: '', live: false };
}

/**
 * Clear any `time.real.*` that is still in the future at `nowSec`, and step the status back.
 *
 * - A future real departure is cleared, and so is any real arrival with it (nothing arrives
 *   before it leaves).
 * - A future real arrival is cleared.
 * - A cleared time that is still ahead becomes the estimate for that side when there is none.
 * - Departed / en route / landed step back: to en route when a real departure remains, else to
 *   expected. Diverted and cancelled labels are kept — only their times are cleared.
 * - `_source.futureActualCleared` records which sides were cleared.
 *
 * @param {any} flight  a normalized schedule row.
 * @param {number} nowSec  the clock to judge against (unix seconds).
 * @returns {any} the same object when nothing is in the future, else a new row.
 */
export function clearFutureActuals(flight, nowSec) {
  const real = flight?.time?.real;
  if (!real) return flight;
  const depFuture = isFutureActual(real.departure, nowSec);
  const arrFuture = isFutureActual(real.arrival, nowSec);
  if (!depFuture && !arrFuture) return flight;

  const clearDep = depFuture;
  const clearArr = arrFuture || (depFuture && Number(real.arrival) > 0);
  const nextReal = {
    ...real,
    departure: clearDep ? null : real.departure,
    arrival: clearArr ? null : real.arrival,
  };
  const estimated = { ...(flight.time.estimated || {}) };
  if (depFuture && !estimated.departure) estimated.departure = real.departure;
  if (arrFuture && !estimated.arrival) estimated.arrival = real.arrival;

  // Whatever was cleared, the real arrival is gone now, so "landed" can stand on nothing.
  let status = flight.status;
  const generic = status?.generic?.status;
  if (generic && !generic.diverted && OPERATED_STATES.has(generic.text)) {
    if (!nextReal.departure) status = expectedStatus();
    else if (generic.text === 'landed') status = enRouteStatus();
  }

  return {
    ...flight,
    status,
    time: { ...flight.time, real: nextReal, estimated },
    _source: { ...(flight._source || {}), futureActualCleared: { departure: clearDep, arrival: clearArr } },
  };
}

/**
 * The served-board pass: clear future actuals, then drop legs longer than any flight.
 *
 * @param {any[]|undefined} flights
 * @param {number} nowSec
 * @returns {{flights: any[]|undefined, staleLegs: number, futureActuals: number}}
 *   `flights` is the input array itself when nothing changed (no copy on the common path).
 */
export function sanitizeBoardFlights(flights, nowSec) {
  if (!Array.isArray(flights)) return { flights, staleLegs: 0, futureActuals: 0 };
  let out = null;
  let staleLegs = 0;
  let futureActuals = 0;
  for (let i = 0; i < flights.length; i++) {
    const original = flights[i];
    let next = clearFutureActuals(original, nowSec);
    if (next !== original) futureActuals++;
    if (isImplausibleLegSpan(next)) {
      staleLegs++;
      next = null;
    }
    if (next !== original && !out) out = flights.slice(0, i);
    if (out && next) out.push(next);
  }
  return { flights: out || flights, staleLegs, futureActuals };
}

/**
 * `sanitizeBoardFlights` for a whole `/api/schedule` payload: `total` drops by the legs removed
 * and `meta.servedSanitized` says what changed. The payload itself is never mutated.
 *
 * @param {any} payload  a `/api/schedule` response body.
 * @param {number} nowSec
 * @returns {any} the same payload when nothing changed.
 */
export function sanitizeServedBoard(payload, nowSec) {
  if (!payload || !Array.isArray(payload.flights)) return payload;
  const { flights, staleLegs, futureActuals } = sanitizeBoardFlights(payload.flights, nowSec);
  if (flights === payload.flights) return payload;
  const total = Number(payload.total);
  return {
    ...payload,
    flights,
    total: Number.isFinite(total) ? Math.max(0, total - staleLegs) : flights.length,
    meta: { ...(payload.meta || {}), servedSanitized: { staleLegs, futureActuals } },
  };
}
