// ═══ ASK THE BOARD: APPLYING A RESULT ═══
// How each validated filter (ask-vocabulary.js) becomes something a view already does. Where a view
// has a control for a filter, the result sets that control (the patches below); where it has none,
// ONE generic predicate per view carries the rest, so no view grows a permanent new control:
//
//   live      hub → the sidebar's hub filter          starlink → the Starlink highlight, AND the predicate
//             region → the "fly to" preset, AND the predicate (the preset only frames the map)
//             family, type, origin, destination, direction, airborne → the predicate
//   schedule  hub, direction → the board selection     family (the board's six) → "Fleet family"
//             starlink → "Starlink"                    canceled → "Status: Canceled"
//             late, on time, 737 MAX / E175 / CRJ, type, the other end of the route → the predicate
//   fleet     family, type, tail → the table search    starlink → "Status: Starlink"
//   starlink  hub → the departures board's hub         tail → the roster search
//
// Pure: no DOM, no React. The views call these.

import { getScheduleFleetFamily } from './schedule-filters.js';
import { getRegion } from './map-regions.js';
import { ON_TIME_GRACE_SECONDS, operatedOutcome } from './hub-health.js';
import { ICAO_TO_FLEET_TYPE } from './equipment-swaps.js';

/** The schedule board's own "Fleet family" values (views/schedule/AdvancedFilters.tsx). */
export const BOARD_FAMILY_VALUES = Object.freeze(['737', 'A320', '757', '767', '777', '787']);

const MAX_CODE_RE = /^(B3[89X]M|7M[89X]|B37M)$/;
const CRJ_CODE_RE = /^CRJ/;

/**
 * Does an aircraft with this type designator (and optional model text) belong to the family?
 * @param {string} code  ICAO designator from the live feed or a schedule row ('B789', 'E75L', 'CRJ7').
 * @param {string} family  an ASK_FAMILIES value.
 * @param {string} [text]  the schedule row's model text, when there is one.
 */
export function aircraftInFamily(code, family, text = '') {
  const c = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const t = String(text || '').toUpperCase();
  if (family === '737MAX') return MAX_CODE_RE.test(c) || (/737/.test(t) && /MAX/.test(t));
  if (family === 'CRJ') return CRJ_CODE_RE.test(c) || /CRJ|CANADAIR/.test(t);
  return getScheduleFleetFamily(c, t) === family;
}

/**
 * Is this aircraft that type? The feed and the board send ICAO designators; a schedule row
 * occasionally sends only text ("Boeing 787-9"), so the fleet name in the text counts too.
 * @param {string} code
 * @param {string} type  an ASK_TYPES value.
 * @param {string} [text]
 */
export function aircraftIsType(code, type, text = '') {
  const c = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (c && (c === type || `B${c}` === type)) return true;
  const name = ICAO_TO_FLEET_TYPE[type];
  if (!c && name && text) {
    const t = String(text).toUpperCase();
    // '787-9' must not match '787-10'; '737 MAX 8' must not match 'MAX 9'.
    const escaped = name.toUpperCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`${escaped}(?![0-9])`).test(t);
  }
  return false;
}

/**
 * Is this position inside a map region preset? Boxes that cross the antimeridian (Oceania, Pacific)
 * wrap: their east edge is west of their west edge.
 * @param {number} lat
 * @param {number} lon
 * @param {string} regionId
 */
export function inRegion(lat, lon, regionId) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  const { box } = getRegion(regionId);
  if (lat < box.south || lat > box.north) return false;
  const x = ((((lon + 180) % 360) + 360) % 360) - 180;
  return box.east >= box.west ? x >= box.west && x <= box.east : x >= box.west || x <= box.east;
}

/**
 * The live map's ask predicate: everything the map's own filters cannot express. The hub itself is
 * the sidebar's filter (filterLiveFlights), so it is NOT re-checked here; with a direction the hub
 * narrows to one end ("arrivals into DEN" = flights whose destination is DEN).
 *
 * @param {Record<string, unknown>} filters  a validated live result's filters.
 * @param {{isStarlink?: (f: object) => boolean}} [deps]
 * @returns {(f: {acType?: string, origin?: string, dest?: string, onGround?: boolean, lat: number, lon: number}) => boolean}
 */
export function makeLiveAskPredicate(filters, deps = {}) {
  const { family, type, starlink, region, airborne, origin, destination, direction, hub } = /** @type {any} */ (filters || {});
  const isStarlink = deps.isStarlink;
  return (f) => {
    if (family && !aircraftInFamily(f.acType || '', family)) return false;
    if (type && !aircraftIsType(f.acType || '', type)) return false;
    if (starlink === true && !(isStarlink && isStarlink(f))) return false;
    if (starlink === false && isStarlink && isStarlink(f)) return false;
    if (region && !inRegion(f.lat, f.lon, region)) return false;
    if (airborne === true && f.onGround) return false;
    if (airborne === false && !f.onGround) return false;
    if (origin && f.origin !== origin) return false;
    if (destination && f.dest !== destination) return false;
    if (hub && direction === 'arrivals' && f.dest !== hub) return false;
    if (hub && direction === 'departures' && f.origin !== hub) return false;
    return true;
  };
}

/**
 * What an ask sets on the schedule board's own filter state. Everything else on the board is reset:
 * the board filters itself to the question, not to the question plus whatever was set before.
 *
 * @param {Record<string, unknown>} filters
 * @returns {{status: string, aircraft: string, fleetFamily: string, routeType: string, starlink: string, timeRange: string, risk: string, search: string}}
 */
export function scheduleAskPatch(filters) {
  const f = /** @type {any} */ (filters || {});
  return {
    status: f.status === 'canceled' ? 'canceled' : '',
    aircraft: '',
    fleetFamily: f.family && BOARD_FAMILY_VALUES.includes(f.family) ? f.family : '',
    routeType: '',
    starlink: f.starlink === true ? 'starlink' : f.starlink === false ? 'no-starlink' : '',
    timeRange: '',
    risk: '',
    search: '',
  };
}

/**
 * Which filters the schedule patch carries, so the view can tell when the visitor has changed one of
 * those controls themselves (and drop that chip).
 * @param {Record<string, unknown>} filters
 * @returns {Record<string, {field: string, value: string}>}
 */
export function scheduleControlledFilters(filters) {
  const patch = scheduleAskPatch(filters);
  /** @type {Record<string, {field: string, value: string}>} */
  const out = {};
  if (patch.status) out.status = { field: 'status', value: patch.status };
  if (patch.fleetFamily) out.family = { field: 'fleetFamily', value: patch.fleetFamily };
  if (patch.starlink) out.starlink = { field: 'starlink', value: patch.starlink };
  return out;
}

/**
 * Late on the board's own terms: an operated row past the stat strip's on-time rule
 * (hub-health.js operatedOutcome, the same one the "Late" card counts), or a row that has not
 * operated and that the board prints as delayed (a provider "Delayed", or an estimate past
 * schedule), or one still on its way whose estimate is past that same 30-minute rule (an arrival
 * in the air 46 minutes behind). The board's own "Status: Delayed" matches only the provider's
 * word, so it would miss a flight that landed 50 minutes late.
 * @param {object} row
 * @param {'departures'|'arrivals'} dir
 * @param {{key?: string, cls?: string}} status  classifySchedStatus(row).
 */
export function rowIsLate(row, dir, status) {
  const key = status?.key || '';
  if (key === 'canceled' || key === 'canceled_uncertain') return false;
  const outcome = operatedOutcome(row, dir, key);
  if (outcome) return outcome === 'late';
  const operated = dir === 'arrivals' ? key === 'landed' : key === 'departed' || key === 'enroute' || key === 'landed';
  if (operated) return false;
  if (status?.cls === 'delayed' || key === 'delayed') return true;
  const side = dir === 'arrivals' ? 'arrival' : 'departure';
  const est = Number(row?.time?.estimated?.[side]);
  const sched = Number(row?.time?.scheduled?.[side]);
  return est > 0 && sched > 0 && est > sched + ON_TIME_GRACE_SECONDS;
}

/** On time on the board's own terms: operated within the stat strip's on-time rule. */
export function rowIsOnTime(row, dir, status) {
  const key = status?.key || '';
  return operatedOutcome(row, dir, key) === 'onTime';
}

/**
 * The schedule board's ask predicate: what scheduleAskPatch() cannot set.
 * @param {Record<string, unknown>} filters
 * @param {'departures'|'arrivals'} dir
 * @returns {((row: any, ctx: {classify: (row: any) => {key?: string, cls?: string}}) => boolean) | null}
 */
export function makeScheduleAskPredicate(filters, dir) {
  const f = /** @type {any} */ (filters || {});
  const needsFamily = f.family && !BOARD_FAMILY_VALUES.includes(f.family);
  if (!needsFamily && !f.type && !f.origin && !f.destination && f.status !== 'delayed' && f.status !== 'on-time') return null;
  return (row, ctx) => {
    const code = row?.aircraft?.model?.code || '';
    const text = row?.aircraft?.model?.text || '';
    if (needsFamily && !aircraftInFamily(code, f.family, text)) return false;
    if (f.type && !aircraftIsType(code, f.type, text)) return false;
    if (f.origin && row?.airport?.origin?.code?.iata !== f.origin) return false;
    if (f.destination && row?.airport?.destination?.code?.iata !== f.destination) return false;
    if (f.status === 'delayed' && !rowIsLate(row, dir, ctx.classify(row))) return false;
    if (f.status === 'on-time' && !rowIsOnTime(row, dir, ctx.classify(row))) return false;
    return true;
  };
}

/** Fleet table search text for a type or family: a substring of the fleet database's type names. */
const FLEET_SEARCH_BY_TYPE = Object.freeze({
  B788: '787-8', B789: '787-9', B78X: '787-10', B772: '777-200', B77W: '777-300', B763: '767-300',
  B764: '767-400', B752: '757-200', B753: '757-300', B737: '737-700', B738: '737-800', B739: '737-900',
  B38M: 'MAX 8', B39M: 'MAX 9', A319: 'A319', A320: 'A320', A21N: 'A321',
});
const FLEET_SEARCH_BY_FAMILY = Object.freeze({
  787: '787', 777: '777', 767: '767', 757: '757', 737: '737', '737MAX': 'MAX', A320: 'A3',
});

/**
 * What an ask sets on the Fleet tab (its type and Wi-Fi selects are reset; the search matches the
 * registration, the cabin config or the type name, so a type or family is a type-name substring).
 * @param {Record<string, unknown>} filters
 * @returns {{search: string, type: string, wifi: string, status: string}}
 */
export function fleetAskPatch(filters) {
  const f = /** @type {any} */ (filters || {});
  const search = f.tail || (f.type && FLEET_SEARCH_BY_TYPE[f.type]) || (f.family && FLEET_SEARCH_BY_FAMILY[f.family]) || '';
  return { search, type: '', wifi: '', status: f.starlink === true ? 'starlink' : '' };
}

/** The families the Fleet tab (mainline only) can show. */
export const FLEET_FAMILIES = Object.freeze(Object.keys(FLEET_SEARCH_BY_FAMILY));

/**
 * The stat strip's on-time percentage and its verdict word ("ROUGH", "GOOD") describe the HUB. A
 * status filter — the board's own Status select, or an ask for late / on time / canceled — picks
 * rows by what happened to them, so a percentage over what is left is circular: "Late" arrivals
 * at DEN read "0% On-Time ROUGH", true of the late rows and false of Denver. While one is on, the
 * percentage (and so the word) is withheld; every count stays, because the counts are facts about
 * the rows on screen. Filters that pick by aircraft, route or time are not outcomes and keep it.
 *
 * @template {{otp: number|null}} S
 * @param {S} stats  computeScheduleStatCounts() over the filtered rows.
 * @param {{statusFilter?: string, askStatus?: string|boolean|null}} active
 * @returns {S & {otpWithheld: boolean}}
 */
export function withholdOtpWhenStatusFiltered(stats, { statusFilter, askStatus } = {}) {
  if (!statusFilter && !askStatus) return { ...stats, otpWithheld: false };
  return { ...stats, otp: null, otpWithheld: true };
}
