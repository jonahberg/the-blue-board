// ═══ FLIGHT PAGE — ASSEMBLING ONE FLIGHT FROM STORED DATA ═══
// The pure rules behind GET /api/flight (api/flight.ts does the reads). Everything here works on
// data the site has ALREADY stored — the flight_history archive, the hub boards' schedule
// snapshots, the reg_sightings ledger and the fleet files — so building a flight page never calls
// a metered provider.
//
// The order of reads is the cost control:
//   1. flight_history for the number (one primary-key range read) names the legs it flew, their
//      routes and service days. A number with no archive rows in 30 days is "not found" without a
//      single snapshot read.
//   2. The leg "now" is picked from those rows by the board's own rule (pickScheduleLeg).
//   3. Only that leg's one or two boards are read (its origin hub's departures board for its
//      service day, its destination hub's arrivals board for its arrival day), for the gate, the
//      latest times and the board's own row. Without a board row the archive row stands in,
//      converted back to board shape (delay-prediction.js boardRowFromHistory).
//
// Pure: no clock (nowSec is passed), no I/O.

import { boardRowFromHistory } from './delay-prediction.js';
import { expressCabinFor, normalizeExpressType } from './express-fleet.js';
import { UNITED_OPERATORS } from './express-operators.js';
import { fleetTypeCodeForTail } from './fleet-type-link.js';
import { localDate } from './flight-history.js';
import { normalizeWifi } from './fleet-utils.js';
import { HUB_TZ, getStartOfHubDay } from './hubTz.js';
import { pickScheduleLeg, scheduleLegPhase } from './flight-page.js';
import { applySightingsToBoard } from './reg-overlay.js';
import { sanitizeBoardFlights } from './schedule-actuals.js';
import { airportTz } from './time-format.js';
import { mergeLegRows } from './watch-leg.js';

const HUBS = new Set(Object.keys(HUB_TZ));
const isHub = (iata) => HUBS.has(String(iata || '').toUpperCase());

/** The hub whose board files this leg's service day: its origin hub, else its destination hub. */
export function boardHubFor(row) {
  if (isHub(row?.origin)) return { hub: row.origin, dir: 'departures' };
  if (isHub(row?.dest)) return { hub: row.dest, dir: 'arrivals' };
  return null;
}

/** Days from today (at the leg's board hub) to the leg's service day: -1, 0, 1, … (NaN: no hub). */
export function serviceDayOffset(row, nowSec) {
  const board = boardHubFor(row);
  if (!board) return NaN;
  const today = localDate(HUB_TZ[board.hub], nowSec);
  return Math.round((Date.parse(`${row.service_date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400e3);
}

/**
 * Archive rows → candidate legs in board shape, with the read-only sightings overlay applied the
 * way /api/schedule serves a board (a Likely Canceled the live feed saw fly is not a cancellation).
 *
 * @param {any[]} rows  flight_history rows for one flight number.
 * @param {number} nowSec
 * @param {Map<string, any>} sightings  reg_sightings by flight key.
 */
export function historyLegs(rows, nowSec, sightings = new Map()) {
  const legs = [];
  for (const h of rows || []) {
    const off = serviceDayOffset(h, nowSec);
    if (!Number.isFinite(off) || off < -1 || off > 1) continue;
    const board = boardHubFor(h);
    const base = boardRowFromHistory(h);
    if (h.registration) base.aircraft = { registration: h.registration, ...(h.aircraft_code ? { model: { code: h.aircraft_code } } : {}) };
    const row = applySightingsToBoard({ dir: board.dir, flights: [base] }, sightings, nowSec * 1000, { dir: board.dir }).flights[0];
    legs.push({ row, history: h, off, schedDep: Number(h.sched_dep) * 60 || 0, source: 'history' });
  }
  return legs;
}

/**
 * The leg "now" among the archive's legs, by the board's precedence (api/flight-times.ts): today's
 * legs first; yesterday's when today offers only an upcoming or long-landed leg (a red-eye still in
 * the air); tomorrow's when there is nothing today at all.
 *
 * @template {{row: any, off: number}} L
 * @param {L[]} legs
 * @param {number} nowSec
 * @param {any} [sighting]
 * @returns {L|null}
 */
export function pickCurrentLeg(legs, nowSec, sighting = null) {
  const today = legs.filter((l) => l.off === 0);
  let pool = today;
  let best = pickScheduleLeg(pool, nowSec, sighting);
  let phase = best ? scheduleLegPhase(best.row, nowSec).phase : null;
  if (!best || phase === 'upcoming' || phase === 'landed') {
    pool = pool.concat(legs.filter((l) => l.off === -1));
    best = pickScheduleLeg(pool, nowSec, sighting);
    phase = best ? scheduleLegPhase(best.row, nowSec).phase : null;
  }
  if (!today.length && (!best || phase === 'landed')) {
    pool = pool.concat(legs.filter((l) => l.off === 1));
    best = pickScheduleLeg(pool, nowSec, sighting);
  }
  return best;
}

/**
 * The snapshot keys holding one leg: its origin hub's departures board for the departure's
 * hub-local day, and its destination hub's arrivals board for the arrival's hub-local day.
 *
 * @param {{origin: string, dest: string, schedDepSec: number, schedArrSec?: number}} leg
 * @returns {{key: string, hub: string, dir: 'departures'|'arrivals'}[]}
 */
export function boardKeysForLeg({ origin, dest, schedDepSec, schedArrSec }) {
  const keys = [];
  const dayStart = (hub, sec) => {
    for (let off = -3; off <= 3; off++) {
      const start = getStartOfHubDay(hub, off, new Date(sec * 1000));
      const next = getStartOfHubDay(hub, off + 1, new Date(sec * 1000));
      if (sec >= start && sec < next) return start;
    }
    return getStartOfHubDay(hub, 0, new Date(sec * 1000));
  };
  if (isHub(origin) && schedDepSec > 0) {
    keys.push({ key: `agg:${origin}:departures:${dayStart(origin, schedDepSec)}`, hub: origin, dir: 'departures' });
  }
  const arrSec = schedArrSec > 0 ? schedArrSec : schedDepSec;
  if (isHub(dest) && arrSec > 0) {
    keys.push({ key: `agg:${dest}:arrivals:${dayStart(dest, arrSec)}`, hub: dest, dir: 'arrivals' });
  }
  return keys;
}

/** A leg on another board is the same instance when its schedule is within this of ours. */
const SAME_LEG_TOLERANCE_SEC = 2 * 3600;

/**
 * The board's own row for the leg, from the boards read for it: the departures row is the base (it
 * has the departure gate), the arrivals row lends its arrival times, further-along status and
 * destination gate (watch-leg.js mergeLegRows) — the merge /api/flight-times does.
 *
 * @param {{dir: 'departures'|'arrivals', hub: string, data: any, refreshedAt?: number}[]} boards
 * @param {{ident: string, origin: string, dest: string, schedDepSec: number}} leg
 * @param {number} nowSec
 * @param {Map<string, any>} sightings
 * @returns {{row: any, dir: 'departures'|'arrivals', hub: string, boardAtSec: number}|null}
 */
export function boardRowForLeg(boards, leg, nowSec, sightings = new Map()) {
  const found = { departures: null, arrivals: null };
  for (const board of boards || []) {
    const flights = Array.isArray(board?.data?.flights) ? board.data.flights : [];
    const mine = flights.filter((f) => String(f?.identification?.number?.default || '').toUpperCase() === leg.ident
      && String(f?.airport?.origin?.code?.iata || '').toUpperCase() === leg.origin);
    if (!mine.length) continue;
    const clean = applySightingsToBoard(
      { dir: board.dir, flights: sanitizeBoardFlights(mine, nowSec).flights },
      sightings,
      nowSec * 1000,
      { dir: board.dir },
    ).flights;
    let best = null;
    let bestGap = Infinity;
    for (const f of clean) {
      const sched = Number(f?.time?.scheduled?.departure) || Number(f?.time?.real?.departure) || Number(f?.time?.estimated?.departure) || 0;
      const gap = leg.schedDepSec > 0 && sched > 0 ? Math.abs(sched - leg.schedDepSec) : (leg.schedDepSec > 0 ? Infinity : 0);
      if (gap <= SAME_LEG_TOLERANCE_SEC && gap < bestGap) { best = f; bestGap = gap; }
    }
    if (best) {
      const at = Number(board.data?.meta?.generatedAt) || Math.floor(Number(board.refreshedAt || 0) / 1000) || 0;
      found[board.dir] = { row: best, hub: board.hub, at };
    }
  }
  const dep = found.departures;
  const arr = found.arrivals;
  if (!dep && !arr) return null;
  const row = mergeLegRows(dep?.row || null, arr?.row || null);
  return {
    row,
    dir: dep ? 'departures' : 'arrivals',
    hub: (dep || arr).hub,
    boardAtSec: Math.max(dep?.at || 0, arr?.at || 0),
  };
}

/**
 * The fields of a board row the page reads (the classifier, board-delay, the verdict, the
 * timeline) and nothing else: a served row carries provider debris the page does not need.
 */
export function trimBoardRow(row) {
  if (!row) return null;
  const airport = (a) => (a
    ? {
        code: { iata: a.code?.iata || '' },
        name: a.name || '',
        info: { terminal: a.info?.terminal || '', gate: a.info?.gate || '' },
      }
    : { code: { iata: '' }, name: '', info: { terminal: '', gate: '' } });
  const src = row._source || {};
  const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o && o[k] !== undefined && o[k] !== null).map((k) => [k, o[k]]));
  return {
    identification: { number: { default: row.identification?.number?.default || '' } },
    status: {
      text: row.status?.text || '',
      ...(row.status?.icon ? { icon: row.status.icon } : {}),
      ...(row.status?.live !== undefined ? { live: row.status.live } : {}),
      generic: row.status?.generic
        ? {
            ...(row.status.generic.type ? { type: row.status.generic.type } : {}),
            status: pick(row.status.generic.status || {}, ['text', 'diverted', 'type']),
          }
        : { status: {} },
    },
    time: {
      scheduled: pick(row.time?.scheduled, ['departure', 'arrival']),
      real: pick(row.time?.real, ['departure', 'arrival']),
      estimated: pick(row.time?.estimated, ['departure', 'arrival']),
    },
    airport: { origin: airport(row.airport?.origin), destination: airport(row.airport?.destination) },
    aircraft: {
      ...(row.aircraft?.model ? { model: pick(row.aircraft.model, ['code', 'text']) } : {}),
      ...(row.aircraft?.registration ? { registration: row.aircraft.registration } : {}),
      ...(row.aircraft?.regSource ? { regSource: row.aircraft.regSource } : {}),
    },
    ...(row.live ? { live: pick(row.live, ['seenAt', 'etaSec']) } : {}),
    _source: pick(src, ['timeSource', 'track', 'seenAirborne', 'scheduleTimeDerivedFromActual', 'liveFeedFallback']),
  };
}

/** The aircraft's registration as the page should trust it: the board's, then the archive's, then a sighting's. */
export function legRegistration(row, historyRow, sighting) {
  const clean = (r) => String(r || '').trim().toUpperCase().replace(/-/g, '');
  return clean(row?.aircraft?.registration) || clean(historyRow?.registration) || clean(sighting?.reg) || '';
}

/**
 * The aircraft card's facts, from the fleet data the dashboard already uses.
 *
 * Mainline: the fleet database row (public/data/fleet.json) — type, cabin config, seats, Wi-Fi,
 * IFE, delivery year — with Wi-Fi relabelled Starlink when the roster says so (the dashboard's
 * applyStarlinkWifiOverlay). United Express (not in that database): the roster's type when it has
 * the tail, else the board's model code; a cabin only where express-fleet.js has a verified layout.
 * Nothing is invented: unknown fields stay null.
 *
 * `typeCode` is the fleet database's own type for the tail when that type has a fleet page
 * (`fleetTypeCodeForTail`), and null for every tail the database does not know: the page links the
 * type by it, never by `type`, which can be a schedule model code (B739 is both the 737-900 and the
 * 737-900ER) or the Starlink roster's words.
 *
 * @param {string} reg
 * @param {{fleet: any[], starlink: Map<string, {type?: string, operator?: string, fleet?: string}>,
 *   modelCode?: string, modelText?: string, operator?: string}} ctx
 */
export function aircraftFacts(reg, { fleet = [], starlink = new Map(), modelCode = '', modelText = '', operator = '' } = {}) {
  const roster = reg ? starlink.get(reg) || null : null;
  const starlinkOn = !!roster;
  const row = reg ? fleet.find((a) => String(a?.r || '').replace(/-/g, '').toUpperCase() === reg) : null;
  if (row) {
    const seats = row.seats && typeof row.seats === 'object' ? row.seats : null;
    return {
      reg,
      type: String(row.t || modelText || modelCode || ''),
      typeCode: fleetTypeCodeForTail(reg, { [reg]: row }),
      config: row.c || '',
      seats,
      total: Number(row.tot) || (seats ? Object.values(seats).reduce((a, b) => a + Number(b || 0), 0) : null) || null,
      wifi: starlinkOn ? 'Starlink' : row.w ? normalizeWifi(row.w) : null,
      starlink: starlinkOn,
      ife: row.i || null,
      delivered: row.d || null,
      operator: 'United Airlines',
      express: false,
      source: 'fleet',
    };
  }
  const opCode = String(operator || '').toUpperCase();
  const express = opCode && opCode !== 'UAL' ? UNITED_OPERATORS[opCode] || null : null;
  const typed = normalizeExpressType({ rosterType: roster?.type, model: modelCode, operator: opCode });
  const cabin = typed.key && opCode ? expressCabinFor(typed.key, opCode) : null;
  const type = typed.label || String(roster?.type || modelText || modelCode || '');
  if (!reg && !type) return null;
  return {
    reg: reg || null,
    type: type || null,
    typeCode: null,
    config: cabin?.config || '',
    seats: cabin?.seats || null,
    total: cabin?.tot || null,
    wifi: starlinkOn ? 'Starlink' : null,
    starlink: starlinkOn,
    ife: null,
    delivered: null,
    operator: express?.name || (roster?.operator ? String(roster.operator) : null),
    express: !!express || roster?.fleet === 'Express',
    source: row ? 'fleet' : roster ? 'roster' : 'schedule',
  };
}

/**
 * Starlink roster entries (the tracker snapshot's `aircraft`, or the committed fallback list) →
 * a Map by dash-stripped tail.
 * @param {any[]} list
 */
export function indexStarlinkRoster(list) {
  const map = new Map();
  for (const a of Array.isArray(list) ? list : []) {
    const tail = String(a?.tail || '').toUpperCase().replace(/-/g, '');
    if (tail) map.set(tail, { type: a.type || '', operator: a.operator || '', fleet: a.fleet || '' });
  }
  return map;
}

/** The airports' IANA zones (empty string when unknown — the page prints UTC and says so). */
export function legZones(row) {
  return {
    origin: airportTz(row?.airport?.origin?.code?.iata),
    dest: airportTz(row?.airport?.destination?.code?.iata),
  };
}

/** The flight_history columns the page reads. */
export const HISTORY_COLUMNS = Object.freeze([
  'flight_no', 'service_date', 'origin', 'dest', 'sched_dep', 'sched_arr', 'dep_at', 'dep_basis',
  'arr_at', 'arr_basis', 'airborne_at', 'status', 'outcome', 'final', 'registration', 'aircraft_code',
  'operator', 'last_seen',
]);

/** The columns of a tail's legs. */
export const TAIL_COLUMNS = Object.freeze([
  'flight_no', 'service_date', 'origin', 'dest', 'sched_dep', 'sched_arr', 'dep_at', 'dep_basis',
  'arr_at', 'arr_basis', 'outcome', 'final',
]);
