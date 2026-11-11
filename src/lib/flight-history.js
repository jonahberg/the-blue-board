// ═══ FLIGHT HISTORY: ONE ROW PER LEG, MERGED FROM EVERY BOARD THAT SAW IT ═══
// Spec: docs/specs/flight-history.md. Table: sql/021_flight_history.sql. Writer: api/_flight-history.ts
// (the warm cron). One-off backfill: sql/021_flight_history_backfill.sql, which repeats these rules in
// SQL — change one, change the other.
//
// A leg is one flight number on one route on one service day. The same leg reaches us from up to two
// boards: a hub's departures board (departure actuals only — a departures board never carries the
// actual arrival) and, when the destination is a hub too, that hub's arrivals board (the arrival
// actuals, plus the departure actuals the arrivals board also carries). Each board is refreshed many
// times a day. Every observation is turned into a candidate row here, and merged into the stored row
// by rules that only move forward: a real time is never replaced by an estimate or by nothing, a
// settled outcome never by a tentative one, the earliest provider schedule is kept as the baseline.
//
// Pure: no clock, no I/O. Times on the board are unix SECONDS; the archive stores whole MINUTES since
// the Unix epoch (UTC) in int4 columns — the provider's times are minute-precision, and the delay is
// a plain subtraction (`dep_at - sched_dep`).

import { HUB_TZ } from './hubTz.js';
import { cancellationKind } from './cancellation.js';
import { isPlausibleDelta, MAX_PLAUSIBLE_BLOCK_SECONDS } from './schedule-plausibility.js';

/** The hubs whose boards feed the archive; a leg belongs to the archive only if it touches one. */
export const FLIGHT_HISTORY_HUBS = Object.freeze(Object.keys(HUB_TZ));
const HUB_SET = new Set(FLIGHT_HISTORY_HUBS);

/** Below this a gate-to-gate block is not a flight (board-delay.js MIN_BLOCK_SECONDS). */
export const MIN_LEG_BLOCK_SECONDS = 10 * 60;

/**
 * What kind of time a stored departure/arrival is, weakest first. 'runway': the provider sent a
 * runway time and no distinct gate time, so the delay may include taxi (board-delay.js); 'actual':
 * a provider actual with no runway time to compare it to; 'gate': a gate time distinct from the
 * runway time. A stored time is only replaced by one of the same or a stronger basis.
 */
export const BASIS_RANK = Object.freeze({ estimate: 1, runway: 2, actual: 3, gate: 4 });

/** Derived outcomes, weakest first. The stored outcome is the strongest one any observation showed. */
export const OUTCOME_RANK = Object.freeze({
  unknown: 0,
  canceled_unconfirmed: 1,
  canceled: 2,
  operated: 3,
  diverted: 4,
});

// Provider status words (status.text: AeroDataBox's word lowercased by mapAeroStatus, or the
// server's own 'expected' / 'en route' when it steps a future actual back), by how settled they are.
const FINAL_WORDS = new Set(['arrived', 'landed', 'canceled', 'cancelled', 'diverted']);
const MOVING_WORDS = new Set(['departed', 'enroute', 'approaching']);
// Generic statuses (mapAeroStatus) that say the aircraft left the gate.
const MOVED_GENERIC = new Set(['departed', 'en-route', 'landed']);

const squash = (word) => String(word || '').toLowerCase().replace(/[^a-z]/g, '');

/** 2 = settled (arrived/canceled/diverted), 1 = moving, 0 = anything earlier (incl. canceleduncertain). */
export function statusRank(word) {
  const w = squash(word);
  if (FINAL_WORDS.has(w)) return 2;
  if (MOVING_WORDS.has(w)) return 1;
  return 0;
}

const pos = (v) => (Number(v) > 0 ? Number(v) : 0);
const toMin = (sec) => (sec > 0 ? Math.floor(sec / 60) : null);
const code3 = (v) => {
  const s = String(v || '').trim().toUpperCase();
  return /^[A-Z0-9]{3}$/.test(s) ? s : '';
};

const dateFormatters = new Map();
/**
 * The calendar date of `sec` in `timeZone`, as 'YYYY-MM-DD' — the same value Postgres gives for
 * `(to_timestamp(sec) at time zone tz)::date`.
 */
export function localDate(timeZone, sec) {
  let fmt = dateFormatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
    dateFormatters.set(timeZone, fmt);
  }
  return fmt.format(new Date(sec * 1000));
}

/** 'UA2455|2026-11-10|ORD|LGA' — the primary key as one string. */
export function flightHistoryKey(row) {
  return `${row.flight_no}|${row.service_date}|${row.origin}|${row.dest}`;
}

/**
 * Do the two sides of a row describe the same flight instance? AeroDataBox splices instances (a
 * scheduled arrival a day after the scheduled departure, yesterday's actual next to today's), and the
 * side of the row that is NOT on this board is the one nothing else vets. Like with like: the
 * scheduled block (provider-sent schedules only) and the actual block must each be a flight.
 */
function sidesConsistent(time, derived) {
  const s = time.scheduled || {};
  const r = time.real || {};
  const schedDep = derived.departure ? 0 : pos(s.departure);
  const schedArr = derived.arrival ? 0 : pos(s.arrival);
  if (schedDep && schedArr) {
    const block = schedArr - schedDep;
    if (block < MIN_LEG_BLOCK_SECONDS || block > MAX_PLAUSIBLE_BLOCK_SECONDS) return false;
  }
  const realDep = pos(r.departure);
  const realArr = pos(r.arrival);
  if (realDep && realArr) {
    const block = realArr - realDep;
    if (block < MIN_LEG_BLOCK_SECONDS || block > MAX_PLAUSIBLE_BLOCK_SECONDS) return false;
  }
  return true;
}

/**
 * The best time we have for one side, with its basis — the provider's real time (labelled exactly
 * as board-delay.js labels it), else its estimate. A time implausibly far from its schedule belongs
 * to another instance and is dropped (schedule-plausibility.js).
 */
function sideTime(time, ts, side) {
  const real = pos(time.real?.[side]);
  const sched = pos(time.scheduled?.[side]);
  const isDep = side === 'departure';
  if (real && isPlausibleDelta(real, sched)) {
    const gateDistinct = isDep ? ts?.gateDistinctDep === true : ts?.gateDistinctArr === true;
    const hasRunway = isDep ? ts?.hasRunwayDep === true : ts?.hasRunwayArr === true;
    const basis = ts && hasRunway && !gateDistinct ? 'runway' : gateDistinct ? 'gate' : 'actual';
    return { at: toMin(real), basis };
  }
  const est = pos(time.estimated?.[side]);
  if (!real && est && isPlausibleDelta(est, sched, { estimate: true })) return { at: toMin(est), basis: 'estimate' };
  return { at: null, basis: null };
}

const isReal = (basis) => basis === 'gate' || basis === 'actual' || basis === 'runway';

/**
 * The live feed's airborne fix of THIS instance, in unix seconds (0 = none): the sightings overlay's
 * track stamp or its seen-airborne evidence (src/lib/reg-overlay.js — both pass the instance gate:
 * airborne from this origin, 15 min before to 18 h after the scheduled departure).
 */
function airborneFixSec(flight) {
  const candidates = [Number(flight?._source?.track?.airborneAt), Number(flight?._source?.seenAirborne?.airborneAt)]
    .filter((ms) => Number.isFinite(ms) && ms > 0);
  return candidates.length ? Math.floor(Math.min(...candidates) / 1000) : 0;
}

/**
 * Is a stored row settled? Canceled or diverted; operated with a real arrival; or operated with a
 * real departure to a destination that is not a hub — no board will ever report that arrival.
 * Pure function of the row, so it can only change when the row's facts do.
 */
export function isFinalRow(row) {
  if (row.outcome === 'canceled' || row.outcome === 'diverted') return true;
  if (row.outcome !== 'operated') return false;
  if (isReal(row.arr_basis)) return true;
  return isReal(row.dep_basis) && !HUB_SET.has(row.dest);
}

/**
 * One board row → one candidate archive row, or the reason it cannot be one.
 *
 * @param {any} flight  a served /api/schedule board row (after the sightings overlay).
 * @param {{dir: 'departures'|'arrivals', hub: string, observedAtSec: number}} ctx
 *   `observedAtSec` is when the board was built (meta.generatedAt).
 * @returns {{row: object|null, reason: string|null}}
 */
export function observeFlight(flight, { dir, hub, observedAtSec }) {
  const isDep = dir === 'departures';
  const flightNo = String(flight?.identification?.number?.default || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{2,8}$/.test(flightNo)) return { row: null, reason: 'no_ident' };
  const origin = code3(flight?.airport?.origin?.code?.iata);
  const dest = code3(flight?.airport?.destination?.code?.iata);
  if (!origin || !dest || origin === dest) return { row: null, reason: 'no_route' };
  const boardHub = String(hub || '').toUpperCase();
  if ((isDep ? origin : dest) !== boardHub) return { row: null, reason: 'off_board' };
  // Synthetic rows built from the live feed when the provider failed (api/schedule.ts): their times
  // are inferred, and operatedOutcome() already refuses them.
  if (flight?._source?.liveFeedFallback) return { row: null, reason: 'live_feed_row' };

  const time = flight?.time || {};
  const derived = flight?._source?.scheduleTimeDerivedFromActual || {};
  const ts = flight?._source?.timeSource || null;
  const consistent = sidesConsistent(time, derived);
  const trustDep = isDep || consistent;
  const trustArr = !isDep || consistent;

  // The service day: the origin hub's local date of the departure, or — for a leg from a non-hub
  // airport, which only its destination hub's arrivals board sees — that hub's local date of the
  // arrival. Both are exactly the board day the row was filed under (isInHubDay's scheduled → real →
  // estimated order), and a hub-to-hub leg gets the same date from both of its boards.
  let anchorTz;
  let anchorSec = 0;
  if (HUB_SET.has(origin)) {
    anchorTz = HUB_TZ[origin];
    if (trustDep) anchorSec = pos(time.scheduled?.departure) || pos(time.real?.departure) || pos(time.estimated?.departure);
  } else if (HUB_SET.has(dest)) {
    anchorTz = HUB_TZ[dest];
    if (trustArr) anchorSec = pos(time.scheduled?.arrival) || pos(time.real?.arrival) || pos(time.estimated?.arrival);
  } else {
    return { row: null, reason: 'no_hub' };
  }
  if (!anchorSec) return { row: null, reason: 'no_key_time' };

  const dep = trustDep ? sideTime(time, ts, 'departure') : { at: null, basis: null };
  const arr = trustArr ? sideTime(time, ts, 'arrival') : { at: null, basis: null };
  const fixSec = airborneFixSec(flight);
  const seenAirborne = !!flight?._source?.seenAirborne;

  const generic = flight?.status?.generic?.status || {};
  let outcome = 'unknown';
  if (generic.diverted === true) outcome = 'diverted';
  else if (isReal(dep.basis) || isReal(arr.basis) || MOVED_GENERIC.has(String(generic.text || '').toLowerCase()) || fixSec || seenAirborne) {
    outcome = 'operated';
  } else {
    const kind = cancellationKind(flight, dir);
    if (kind === 'confirmed') outcome = 'canceled';
    else if (kind === 'likely') outcome = 'canceled_unconfirmed';
  }

  // The provider's word. The seen-airborne override rewrote a "Likely Canceled" row to departed; the
  // provider still said CanceledUncertain, and that is what is stored (the outcome says it flew).
  const rawStatus = seenAirborne ? 'canceleduncertain' : String(flight?.status?.text || '').trim().toLowerCase();
  // Provider-sent tails only: a tail the overlay backfilled from the live feed (regSource
  // 'live_feed') is matched on flight number + window, not the schedule's own word.
  const reg = flight?.aircraft?.regSource === 'live_feed'
    ? ''
    : String(flight?.aircraft?.registration || '').trim().toUpperCase();
  const acCode = String(flight?.aircraft?.model?.code || '').trim().toUpperCase();
  const operator = /^([A-Z]{3})\d/.exec(String(flight?.identification?.callsign || '').trim().toUpperCase())?.[1] || null;

  const row = {
    flight_no: flightNo,
    service_date: localDate(anchorTz, anchorSec),
    origin,
    dest,
    sched_dep: trustDep && !derived.departure ? toMin(pos(time.scheduled?.departure)) : null,
    sched_arr: trustArr && !derived.arrival ? toMin(pos(time.scheduled?.arrival)) : null,
    dep_at: dep.at,
    dep_basis: dep.basis,
    arr_at: arr.at,
    arr_basis: arr.basis,
    airborne_at: toMin(fixSec),
    status: rawStatus ? rawStatus.slice(0, 32) : null,
    outcome,
    final: false,
    registration: /^[A-Z0-9-]{2,10}$/.test(reg) ? reg : null,
    aircraft_code: /^[A-Z0-9]{2,6}$/.test(acCode) ? acCode : null,
    operator,
    on_dep_board: isDep,
    on_arr_board: !isDep,
    last_seen: toMin(pos(observedAtSec)) ?? 0,
  };
  row.final = isFinalRow(row);
  return { row, reason: null };
}

/**
 * How much a raw board row knows, as a tuple compared in order (higher wins) — the same order
 * src/lib/board-dedupe.js uses to pick between copies of one flight. Two rows on one board that map
 * to the same archive key are one leg (a re-timed copy, a ghost beside the real row, a second tail
 * nobody can tell apart); the row with the best evidence is the observation.
 */
function evidenceScore(flight, dir) {
  const s = dir === 'arrivals' ? 'arrival' : 'departure';
  const time = flight?.time || {};
  const tsrc = flight?._source?.timeSource || {};
  const real = pos(time.real?.[s]);
  const sched = pos(time.scheduled?.[s]);
  const derived = !!flight?._source?.scheduleTimeDerivedFromActual?.[s];
  const anyReal = pos(time.real?.departure) || pos(time.real?.arrival);
  const gateDistinct = s === 'departure' ? tsrc.gateDistinctDep === true : tsrc.gateDistinctArr === true;
  let filled = 0;
  for (const kind of ['scheduled', 'real', 'estimated']) {
    for (const leg of ['departure', 'arrival']) if (pos(time[kind]?.[leg])) filled++;
  }
  return [
    real ? 1 : 0,
    anyReal ? 1 : 0,
    real && gateDistinct ? 1 : 0,
    real && sched && real !== sched ? 1 : 0,
    sched && !derived ? 1 : 0,
    filled,
    sched ? -sched : -Infinity,
  ];
}

function better(a, b) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

/**
 * A whole served board → its candidate rows, one per key.
 *
 * @param {any} board  a /api/schedule payload ({flights, meta}).
 * @param {{dir: 'departures'|'arrivals', hub: string, observedAtSec: number}} ctx
 * @returns {{rows: object[], skipped: Record<string, number>, duplicates: number}}
 */
export function archiveRowsFromBoard(board, ctx) {
  const flights = Array.isArray(board?.flights) ? board.flights : [];
  const best = new Map();
  const skipped = {};
  let duplicates = 0;
  flights.forEach((flight) => {
    const { row, reason } = observeFlight(flight, ctx);
    if (!row) {
      skipped[reason] = (skipped[reason] || 0) + 1;
      return;
    }
    const key = flightHistoryKey(row);
    const score = evidenceScore(flight, ctx.dir);
    const held = best.get(key);
    if (held) {
      duplicates++;
      // Strictly better replaces; a tie keeps the earlier row (board order), as board-dedupe does.
      if (better(score, held.score)) best.set(key, { row, score });
      return;
    }
    best.set(key, { row, score });
  });
  return { rows: [...best.values()].map((entry) => entry.row), skipped, duplicates };
}

const basisRank = (basis) => BASIS_RANK[basis] || 0;
const minNonNull = (a, b) => (a == null ? b : b == null ? a : Math.min(a, b));

/** One side's (time, basis): the incoming one only when it is at least as strong, ties to the newer observation. */
function mergeSide(eAt, eBasis, iAt, iBasis, incomingIsNewer) {
  if (iAt == null) return [eAt, eBasis];
  if (eAt == null) return [iAt, iBasis];
  const ri = basisRank(iBasis);
  const re = basisRank(eBasis);
  if (ri > re || (ri === re && incomingIsNewer)) return [iAt, iBasis];
  return [eAt, eBasis];
}

/**
 * Merge one observation into the stored row of the same key. Forward-only:
 *  - schedules: the EARLIEST provider schedule (the original baseline — a re-timed copy carries a
 *    later "schedule" that would hide the delay, board-dedupe.js);
 *  - departure / arrival: a stronger basis wins (gate > actual > runway > estimate); the same basis
 *    takes the newer observation; nothing ever replaces a time with null;
 *  - airborne fix: the earliest (the closest to wheels-up);
 *  - provider status: a word at least as settled, ties to the newer observation — 'arrived' never
 *    goes back to 'enroute', 'departed' never to 'canceleduncertain';
 *  - outcome: the strongest seen (diverted > operated > canceled > canceled_unconfirmed > unknown) —
 *    a flight seen flying is not later un-flown by a stale "Likely Canceled";
 *  - tail / type / operator: the newer observation's non-empty value;
 *  - boards seen: OR; last_seen: the newest; final: recomputed from the merged row.
 *
 * `newer` compares the incoming observation with the stored row's newest observation (`last_seen`);
 * an equal time counts as newer for times and status, not for the tail (the first copy on a board wins).
 *
 * @param {object|null} existing  the stored row, or null.
 * @param {object} incoming  an observeFlight() row with the same key.
 * @returns {object} the merged row (a new object; inputs are not mutated).
 */
export function mergeFlightHistoryRow(existing, incoming) {
  if (!existing) return { ...incoming, final: isFinalRow(incoming) };
  const atLeastAsNew = Number(incoming.last_seen) >= Number(existing.last_seen);
  const strictlyNewer = Number(incoming.last_seen) > Number(existing.last_seen);
  const [depAt, depBasis] = mergeSide(existing.dep_at, existing.dep_basis, incoming.dep_at, incoming.dep_basis, atLeastAsNew);
  const [arrAt, arrBasis] = mergeSide(existing.arr_at, existing.arr_basis, incoming.arr_at, incoming.arr_basis, atLeastAsNew);
  let status = existing.status;
  if (incoming.status != null) {
    const ri = statusRank(incoming.status);
    const re = existing.status == null ? -1 : statusRank(existing.status);
    if (ri > re || (ri === re && atLeastAsNew)) status = incoming.status;
  }
  const outcome = (OUTCOME_RANK[incoming.outcome] ?? 0) > (OUTCOME_RANK[existing.outcome] ?? 0)
    ? incoming.outcome
    : existing.outcome;
  const pick = (field) => (incoming[field] != null && (existing[field] == null || strictlyNewer) ? incoming[field] : existing[field]);
  const merged = {
    flight_no: existing.flight_no,
    service_date: existing.service_date,
    origin: existing.origin,
    dest: existing.dest,
    sched_dep: minNonNull(existing.sched_dep, incoming.sched_dep),
    sched_arr: minNonNull(existing.sched_arr, incoming.sched_arr),
    dep_at: depAt,
    dep_basis: depBasis,
    arr_at: arrAt,
    arr_basis: arrBasis,
    airborne_at: minNonNull(existing.airborne_at, incoming.airborne_at),
    status,
    outcome,
    final: false,
    registration: pick('registration'),
    aircraft_code: pick('aircraft_code'),
    operator: pick('operator'),
    on_dep_board: !!(existing.on_dep_board || incoming.on_dep_board),
    on_arr_board: !!(existing.on_arr_board || incoming.on_arr_board),
    last_seen: Math.max(Number(existing.last_seen) || 0, Number(incoming.last_seen) || 0),
  };
  merged.final = isFinalRow(merged);
  return merged;
}

/** Every stored column, in table order — what the writer selects and upserts. */
export const FLIGHT_HISTORY_COLUMNS = Object.freeze([
  'flight_no', 'service_date', 'origin', 'dest',
  'sched_dep', 'sched_arr', 'dep_at', 'dep_basis', 'arr_at', 'arr_basis', 'airborne_at',
  'status', 'outcome', 'final', 'registration', 'aircraft_code', 'operator',
  'on_dep_board', 'on_arr_board', 'last_seen',
]);

/** Would writing `next` over `prev` change anything? (Unchanged rows are not rewritten.) */
export function sameFlightHistoryRow(prev, next) {
  if (!prev || !next) return false;
  return FLIGHT_HISTORY_COLUMNS.every((col) => (prev[col] ?? null) === (next[col] ?? null));
}
