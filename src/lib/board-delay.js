// ═══ BOARD DELAY EVIDENCE: WHICH TIME THE DELAY CELL MEASURES ═══
// The board used to measure every row the same way — the provider's real time on the board's side,
// else its estimate — and the live audit of Oct 4 2026 (00:36–01:10Z) caught that number lying on
// airborne flights:
//
//   - ORD UA2059 ROC→ORD read "+3h28m": the provider's estimated arrival sat 3h54m after its own
//     estimated departure on a 2h08m block. It landed about +66m.
//   - DEN UA407 EWR→DEN read "−75m" with a departure 38 min late: a 2h29m estimated block on a 4h22m
//     schedule — a flight cannot make up 113 minutes.
//   - ORD UA1963 SLC→ORD read "+0m" while still cruising past its scheduled arrival: the estimated
//     arrival was the schedule, 69 min after an estimated departure 79 min late.
//   - DEN UA5063 had no provider time at all and showed no delay; it took off 2h16m late.
//   - A fifth of departures carry a "real" time that is the runway time (wheels-up), not the gate:
//     the provider copied its runway time into revisedTime (api/_schedule-aerodatabox.ts), so those
//     delays include taxi-out.
//
// This module picks the time the delay cell compares against the schedule, says what KIND of time
// it is (`basis`), and whether it is only a bound. Evidence order, strongest first:
//   1. a provider time on the board's side — labelled 'gate', 'runway' (wheels-up / touchdown: the
//      provider sent no distinct gate time) or 'actual' (source unknown) — unless the live feed saw
//      the aircraft AIRBORNE before that "actual" departure, which makes it impossible;
//   2. on arrivals, a landing the live feed proved (reg-overlay.js `_source.track.landed`): the last
//      airborne fix is a floor on the gate arrival ('sighting', lower bound) unless a provider
//      estimate inside the fix→ground window is better;
//   3. on arrivals, the live position ETA when the aircraft is airborne now and the provider's
//      estimate is more than 30 min from it (the My Flights rule, my-flights.js);
//   4. the provider's estimate — unless it contradicts the departure: an estimated block shorter
//      than the great-circle distance allows (UA407, UA1963), or one far longer than the schedule
//      while the departure is itself only an estimate (UA2059). Then the arrival is derived as
//      departure + scheduled block ('derived'). Schedules are padded — UA303 MCI→ORD really flew a
//      64-min block against 114 scheduled — so "short" is judged by physics, not by the schedule;
//   5. on departures with no provider time, the airborne fix minus the scheduled block (plus slack)
//      is a floor on the departure ('sighting', lower bound).
//
// Pure: no clock, no I/O. Everything it needs is on the row and the classifier's status.

import { AIRPORT_COORDS } from './airports.js';
import { haversineNm } from './geo.js';
import { LIVE_ETA_CONTRADICTION_MIN } from './my-flights.js';

/**
 * The fastest a gate-to-gate block can be: great-circle distance at this groundspeed (a strong
 * jet-stream tailwind; no United airliner averages more over a whole flight) plus the minimum taxi.
 */
export const MAX_AVERAGE_GROUNDSPEED_KT = 600;
export const MIN_TAXI_SECONDS = 15 * 60;

/** A provider estimate may run past the block by max(this, 50% of the block) before it is noise. */
export const MAX_BLOCK_OVERRUN_SECONDS = 60 * 60;

/**
 * Tighter, max(this, 25% of the block), when the aircraft is airborne NOW but the provider never
 * recorded it leaving: its estimates are evidently stale. On the 01:27Z Oct 4 boards ORD UA546
 * EWR→ORD read +1h42m (a 4h05m estimated block on a 2h47m schedule) while the live position put it
 * 28 min early; UA2197, UA1411 and UA1068 the same.
 */
export const STALE_PROVIDER_OVERRUN_SECONDS = 30 * 60;

/** A landed-by-sighting row trusts a provider gate estimate this soon after the last airborne fix. */
export const SEEN_LANDED_ESTIMATE_WINDOW_SECONDS = 20 * 60;

/** Airborne this long before the provider's "actual" departure means that departure is wrong. */
export const AIRBORNE_BEFORE_ACTUAL_TOLERANCE_SECONDS = 5 * 60;

/** Slack on top of the scheduled block for the departure floor (holding, a long taxi-in). */
export const BLOCK_SLACK_SECONDS = 15 * 60;

const MIN_BLOCK_SECONDS = 10 * 60;
const MAX_BLOCK_SECONDS = 20 * 3600;

const sec = (v) => (Number(v) > 0 ? Number(v) : 0);

/**
 * The scheduled gate-to-gate block in seconds, or 0 when either side is missing, was derived from an
 * actual (not a schedule), or the span is not a flight.
 */
export function scheduledBlockSeconds(flight) {
  const s = flight?.time?.scheduled || {};
  const derived = flight?._source?.scheduleTimeDerivedFromActual || {};
  if (derived.departure || derived.arrival) return 0;
  const block = sec(s.arrival) - sec(s.departure);
  return block >= MIN_BLOCK_SECONDS && block <= MAX_BLOCK_SECONDS ? block : 0;
}

/**
 * The live feed's latest AIRBORNE fix of this instance, in unix seconds (0 when there is none): the
 * overlay's track stamp, a fresh LIVE stamp, or the seen-airborne override's evidence.
 */
export function airborneFixSec(flight) {
  const ms = Math.max(
    Number(flight?._source?.track?.airborneAt) || 0,
    Number(flight?.live?.seenAt) || 0,
    Number(flight?._source?.seenAirborne?.airborneAt) || 0,
  );
  return ms > 0 ? Math.floor(ms / 1000) : 0;
}

/**
 * The shortest block physics allows between two airports, in seconds, or 0 when either airport is
 * not in the coordinate table (src/lib/airports.js) — then nothing is judged too short.
 */
export function minFeasibleBlockSeconds(origin, dest) {
  const o = AIRPORT_COORDS[String(origin || '').toUpperCase()];
  const d = AIRPORT_COORDS[String(dest || '').toUpperCase()];
  if (!o || !d) return 0;
  const nm = haversineNm(o.lat, o.lon, d.lat, d.lon);
  return Math.round((nm / MAX_AVERAGE_GROUNDSPEED_KT) * 3600 + MIN_TAXI_SECONDS);
}

/**
 * Is the estimated block (departure → arrival) one a real flight could fly? 'short' when it beats
 * the physical minimum for the route, 'long' when it overruns the scheduled block by more than
 * max(60 min, 50%), else 'ok'.
 */
export function blockVerdict(estBlock, block, minFeasible = 0, { staleProvider = false } = {}) {
  if (!Number.isFinite(estBlock)) return 'ok';
  if (minFeasible && estBlock < minFeasible) return 'short';
  const overrun = staleProvider
    ? Math.max(STALE_PROVIDER_OVERRUN_SECONDS, 0.25 * block)
    : Math.max(MAX_BLOCK_OVERRUN_SECONDS, 0.5 * block);
  if (block && estBlock > block + overrun) return 'long';
  return 'ok';
}

const OPERATED = new Set(['departed', 'enroute', 'landed']);

/**
 * @typedef {object} BoardTimeEvidence
 * @property {number|undefined} schedTimeSec    the board-side scheduled time.
 * @property {number|undefined} actualTimeSec   the time the delay is measured to (undefined: none).
 * @property {boolean} hasRealTime              a provider-confirmed or observed time, not an estimate.
 * @property {boolean} derivedActual            the scheduled time was derived from the actual.
 * @property {'gate'|'runway'|'actual'|'estimate'|'derived'|'live'|'sighting'|null} basis
 * @property {'lower'|'upper'|null} bound       the true time is at least / at most this.
 * @property {boolean} actualFromRunway         the provider's actual is a runway time (wheels-up on
 *   departures, touchdown on arrivals): it sent no distinct gate time.
 * @property {boolean} contradicted             the live feed saw the aircraft airborne before the
 *   provider's "actual" departure — that actual cannot be right.
 * @property {number|undefined} providerTimeSec  the provider's own board-side time, when the evidence
 *   overrode it.
 */

/**
 * Which time the board's delay cell should measure, and what kind of time it is.
 *
 * @param {object} flight  a board row (after the sightings overlay).
 * @param {'departures'|'arrivals'} dir
 * @param {{key?: string, live?: boolean, seenLanded?: boolean}|null} [status]  classifySchedStatus().
 * @returns {BoardTimeEvidence}
 */
export function boardTimeEvidence(flight, dir, status = null) {
  const isDep = dir !== 'arrivals';
  const time = flight?.time || {};
  const ts = flight?._source?.timeSource || null;
  const schedTimeSec = isDep ? time.scheduled?.departure : time.scheduled?.arrival;
  const derivedActual = Boolean(
    isDep
      ? flight?._source?.scheduleTimeDerivedFromActual?.departure
      : flight?._source?.scheduleTimeDerivedFromActual?.arrival,
  );
  const out = {
    schedTimeSec,
    actualTimeSec: undefined,
    hasRealTime: false,
    derivedActual,
    basis: null,
    bound: null,
    actualFromRunway: false,
    contradicted: false,
    providerTimeSec: undefined,
  };
  const fix = airborneFixSec(flight);
  const block = scheduledBlockSeconds(flight);
  return isDep ? departureEvidence(out, time, ts, fix, block) : arrivalEvidence(out, flight, time, ts, fix, block, status);
}

function departureEvidence(out, time, ts, fix, block) {
  const real = sec(time.real?.departure);
  const est = sec(time.estimated?.departure);
  if (real) {
    if (fix && fix < real - AIRBORNE_BEFORE_ACTUAL_TOLERANCE_SECONDS) {
      // The feed had it in the air before the provider says it left: it left by `fix` at the latest.
      return { ...out, actualTimeSec: fix, hasRealTime: true, basis: 'sighting', bound: 'upper', contradicted: true, providerTimeSec: real };
    }
    const runway = !!ts && ts.hasRunwayDep === true && ts.gateDistinctDep !== true;
    return {
      ...out,
      actualTimeSec: real,
      hasRealTime: true,
      basis: runway ? 'runway' : ts?.gateDistinctDep === true ? 'gate' : 'actual',
      actualFromRunway: runway,
    };
  }
  if (est) {
    if (fix && fix < est - AIRBORNE_BEFORE_ACTUAL_TOLERANCE_SECONDS) {
      return { ...out, actualTimeSec: fix, hasRealTime: true, basis: 'sighting', bound: 'upper', providerTimeSec: est };
    }
    return { ...out, actualTimeSec: est, basis: 'estimate' };
  }
  if (fix && block) {
    // No provider time at all. Airborne at `fix` on a `block`-long leg: it cannot have pushed back
    // earlier than fix − block − slack.
    return { ...out, actualTimeSec: fix - block - BLOCK_SLACK_SECONDS, hasRealTime: true, basis: 'sighting', bound: 'lower' };
  }
  return out;
}

function arrivalEvidence(out, flight, time, ts, fix, block, status) {
  const real = sec(time.real?.arrival);
  const est = sec(time.estimated?.arrival);
  if (real) {
    const runway = !!ts && ts.hasRunwayArr === true && ts.gateDistinctArr !== true;
    return {
      ...out,
      actualTimeSec: real,
      hasRealTime: true,
      basis: runway ? 'runway' : ts?.gateDistinctArr === true ? 'gate' : 'actual',
      actualFromRunway: runway,
    };
  }

  const realDep = sec(time.real?.departure);
  const depBest = realDep || sec(time.estimated?.departure);
  const minFeasible = minFeasibleBlockSeconds(flight?.airport?.origin?.code?.iata, flight?.airport?.destination?.code?.iata);
  // Airborne now, yet the provider has no departure: everything it estimates is behind the aircraft.
  const staleProvider = !realDep && status?.live === true;
  const verdictFor = (t) => (t && depBest ? blockVerdict(t - depBest, block, minFeasible, { staleProvider }) : 'ok');

  const track = flight?._source?.track;
  if ((status?.seenLanded || track?.landed) && fix) {
    // Landed, proved by the feed. The gate arrival is no earlier than the last airborne fix (≈ the
    // touchdown); a provider estimate a taxi-in after it is the better number (it knows the gate),
    // anything else falls back to the fix as a floor.
    const inWindow = est && est >= fix - AIRBORNE_BEFORE_ACTUAL_TOLERANCE_SECONDS && est <= fix + SEEN_LANDED_ESTIMATE_WINDOW_SECONDS;
    if (inWindow && verdictFor(est) === 'ok') return { ...out, actualTimeSec: est, basis: 'estimate' };
    return { ...out, actualTimeSec: fix, hasRealTime: true, basis: 'sighting', bound: 'lower', providerTimeSec: est || undefined };
  }

  // Airborne now with a position: the My Flights rule — live wins when the provider is > 30 min off.
  const liveEta = sec(flight?.live?.etaSec);
  if (status?.live && liveEta && (!est || Math.abs(est - liveEta) > LIVE_ETA_CONTRADICTION_MIN * 60)) {
    return { ...out, actualTimeSec: liveEta, basis: 'live', providerTimeSec: est || undefined };
  }

  if (est && depBest && block) {
    const verdict = verdictFor(est);
    // Too short is physics: no flight covers the distance that fast. Too long is only noise when the
    // departure is itself an estimate, or the aircraft is airborne now (no flight needs more than its
    // whole block from mid-air); after a confirmed gate departure a long ground hold is possible.
    if (verdict === 'short' || (verdict === 'long' && (!realDep || status?.live))) {
      const liveFloor = status?.live ? Math.floor((Number(flight?.live?.seenAt) || 0) / 1000) : 0;
      return { ...out, actualTimeSec: Math.max(depBest + block, liveFloor), basis: 'derived', providerTimeSec: est };
    }
  }
  if (est) return { ...out, actualTimeSec: est, basis: 'estimate' };
  if (depBest && block && OPERATED.has(String(status?.key || ''))) {
    // It left (or is leaving) at a known time and the provider has no arrival estimate.
    return { ...out, actualTimeSec: depBest + block, basis: 'derived' };
  }
  return out;
}
