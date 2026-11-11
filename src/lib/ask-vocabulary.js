// ═══ ASK THE BOARD: THE VOCABULARY ═══
// "Ask the board" turns a plain question typed into ⌘K into filters the dashboard already has. The
// answer is never prose: it is ONE of these result shapes, and every value in it is an enum below or
// a value checked against data the repo already carries (the nine hubs, the airport table, the map
// region presets, the fleet's ICAO type codes). Free text never reaches the page — chip labels come
// from the label tables here, never from a parser or a model.
//
//   { view, filters }   view    one of VIEWS
//                       filters a subset of FILTER_NAMES, each validated by validateAskResult()
//
// The same validator runs on the server (api/ask.ts, on the model's JSON) and again in the browser (on
// the server's response), so a hostile query can at worst produce a wrong filter from this list.
//
// DOM-free and JSON-free on purpose: api/ask.ts imports it (tests/api-esm-json-imports.test.js).

import { AIRPORTS, IATA_CITIES } from './airports.js';
import { INTL_AIRPORTS, US_AIRPORTS } from './airport-metadata.js';
import { ICAO_TO_FLEET_TYPE } from './equipment-swaps.js';
import { HUB_ORDER } from './hub-health.js';
import { MAP_REGIONS } from './map-regions.js';

/** Where an answer can land. `flight` is one flight (flight sheet) or one airframe (tail). */
export const ASK_VIEWS = Object.freeze(['live', 'schedule', 'fleet', 'starlink', 'weather', 'flight']);

export const ASK_VIEW_LABELS = Object.freeze({
  live: 'the live map',
  schedule: 'the schedule board',
  fleet: 'the fleet',
  starlink: 'the Starlink tab',
  weather: 'Delays · Weather · Hubs',
  flight: 'a flight',
});

export const ASK_HUBS = Object.freeze([...HUB_ORDER]);

export const ASK_DIRECTIONS = Object.freeze(['departures', 'arrivals']);

/**
 * Aircraft families. The first six are the schedule board's own "Fleet family" values
 * (src/lib/schedule-filters.js); 737MAX, E175 and CRJ are narrower or regional groups the board's
 * select does not offer, so they are matched by the ask predicate instead (ask-apply.js).
 */
export const ASK_FAMILIES = Object.freeze(['737', '737MAX', 'A320', '757', '767', '777', '787', 'E175', 'CRJ']);

export const ASK_FAMILY_LABELS = Object.freeze({
  737: '737 family',
  '737MAX': '737 MAX',
  A320: 'A320 family',
  757: '757',
  767: '767',
  777: '777',
  787: '787 family',
  E175: 'Embraer 175',
  CRJ: 'CRJ',
});

/** ICAO type designators — the code the live feed and the schedule rows both carry. */
export const ASK_TYPES = Object.freeze(Object.keys(ICAO_TO_FLEET_TYPE).filter((code) => code !== 'B77E'));

/** Type → the fleet database's name for it ('B789' → '787-9'), which is also its chip label. */
export const ASK_TYPE_LABELS = Object.freeze(
  Object.fromEntries(ASK_TYPES.map((code) => [code, ICAO_TO_FLEET_TYPE[code]])),
);

/** Type → its family, so a type filter and a family filter never disagree. */
export const ASK_TYPE_FAMILY = Object.freeze({
  A319: 'A320', A320: 'A320', A21N: 'A320',
  B737: '737', B738: '737', B739: '737', B38M: '737', B39M: '737',
  B752: '757', B753: '757',
  B763: '767', B764: '767',
  B772: '777', B77W: '777',
  B788: '787', B789: '787', B78X: '787',
});

/**
 * Status buckets for the schedule board. `delayed` is the board's own idea of late (its stat strip's
 * 30-minute rule for operated rows, plus upcoming rows it prints as delayed); `canceled` includes the
 * provider's unconfirmed "Likely Canceled", as the board's own Canceled filter does.
 */
export const ASK_STATUSES = Object.freeze(['delayed', 'canceled', 'on-time']);

export const ASK_STATUS_LABELS = Object.freeze({ delayed: 'Late', canceled: 'Canceled', 'on-time': 'On time' });

export const ASK_REGIONS = Object.freeze(MAP_REGIONS.map((region) => region.id));

const REGION_LABELS = Object.freeze(Object.fromEntries(MAP_REGIONS.map((region) => [region.id, region.label])));

/** Every airport code the dashboard knows anything about. Origin and destination must be one. */
export const ASK_AIRPORTS = Object.freeze(
  new Set([...AIRPORTS.map((a) => a.iata), ...INTL_AIRPORTS, ...US_AIRPORTS, ...HUB_ORDER]),
);

/** The order filters are listed in, and the only names a result may carry. */
export const ASK_FILTER_NAMES = Object.freeze([
  'flight', 'tail', 'family', 'type', 'starlink', 'hub', 'direction', 'origin', 'destination',
  'region', 'airborne', 'status',
]);

/**
 * Which filters each view can actually apply. A filter outside its view's list is dropped by the
 * validator, so a chip can never show a filter that is not in force.
 */
export const ASK_VIEW_FILTERS = Object.freeze({
  live: Object.freeze(['hub', 'direction', 'origin', 'destination', 'family', 'type', 'starlink', 'region', 'airborne']),
  schedule: Object.freeze(['hub', 'direction', 'origin', 'destination', 'family', 'type', 'starlink', 'status']),
  fleet: Object.freeze(['family', 'type', 'starlink', 'tail']),
  starlink: Object.freeze(['hub', 'tail']),
  weather: Object.freeze(['hub']),
  flight: Object.freeze(['flight', 'tail']),
});

/** Families the Fleet tab (mainline aircraft only) can list. */
const FLEET_TAB_FAMILIES = Object.freeze(['737', '737MAX', 'A320', '757', '767', '777', '787']);

/** Views that are fine with no filter at all: opening them IS the answer. */
const NAVIGATION_VIEWS = new Set(['weather', 'fleet', 'starlink']);

const FLIGHT_RE = /^(?:UAL?)?\s*0*(\d{1,4})$/i;
const TAIL_RE = /^N[1-9]\d{0,4}[A-Z]{0,2}$/;

/** 'ua 1432', 'UAL1432', '1432' → 'UA1432'; anything else → null. */
export function normalizeFlight(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const m = String(value).trim().match(FLIGHT_RE);
  if (!m || Number(m[1]) === 0) return null;
  return `UA${Number(m[1])}`;
}

/** 'n12345', 'N-12345' → 'N12345' when it is a well-formed US registration; else null. */
export function normalizeTail(value) {
  if (typeof value !== 'string') return null;
  const tail = value.trim().toUpperCase().replace(/-/g, '');
  return TAIL_RE.test(tail) && tail.length <= 6 ? tail : null;
}

/** A known airport code, upper-cased; else null. */
export function normalizeAirport(value) {
  if (typeof value !== 'string') return null;
  const code = value.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) && ASK_AIRPORTS.has(code) ? code : null;
}

function pickEnum(value, allowed) {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (allowed.includes(v)) return v;
  const lower = v.toLowerCase();
  const hit = allowed.find((a) => a.toLowerCase() === lower);
  return hit ?? null;
}

function pickBool(value) {
  return typeof value === 'boolean' ? value : null;
}

/**
 * Each filter's own value check. Returns the clean value or null (dropped).
 * @type {Record<string, (v: unknown) => unknown>}
 */
const FIELD_CHECKS = {
  flight: normalizeFlight,
  tail: normalizeTail,
  hub: (v) => pickEnum(typeof v === 'string' ? v.toUpperCase() : v, ASK_HUBS),
  direction: (v) => pickEnum(v, ASK_DIRECTIONS),
  origin: normalizeAirport,
  destination: normalizeAirport,
  family: (v) => pickEnum(typeof v === 'number' ? String(v) : v, ASK_FAMILIES),
  type: (v) => pickEnum(typeof v === 'string' ? v.toUpperCase() : v, ASK_TYPES),
  starlink: pickBool,
  region: (v) => pickEnum(v, ASK_REGIONS),
  airborne: pickBool,
  status: (v) => pickEnum(v, ASK_STATUSES),
};

/**
 * Which view a filter set belongs on when none was named (or the named one is not a view).
 * One flight or tail → the flight; a status or a board direction → the schedule board; anything
 * else → the live map.
 * @param {Record<string, unknown>} filters
 */
export function inferAskView(filters) {
  if (filters.flight || filters.tail) return 'flight';
  if (filters.status) return 'schedule';
  if (filters.direction && !filters.region && filters.airborne == null) return 'schedule';
  return 'live';
}

/**
 * Make the filter set coherent for its view (pure; returns a new object).
 *  - a type implies its family, so the family is dropped beside it;
 *  - origin and destination may not be the same airport;
 *  - on the schedule board the board's hub is one end of every row, so an origin or destination
 *    that IS the hub becomes the hub, and only the other end stays a filter (departures filter by
 *    destination, arrivals by origin);
 *  - on the live map a direction means nothing without a hub;
 *  - on the flight view a flight number wins over a tail.
 */
function reconcile(view, filters) {
  const f = { ...filters };
  if (f.type && f.family && ASK_TYPE_FAMILY[f.type] && (f.family === ASK_TYPE_FAMILY[f.type] || (f.family === '737MAX' && /^B3[89]M$/.test(f.type)))) {
    delete f.family;
  }
  if (f.origin && f.destination && f.origin === f.destination) delete f.destination;
  if (view === 'schedule') {
    if (!f.hub) {
      if (f.origin && ASK_HUBS.includes(f.origin) && f.direction !== 'arrivals') {
        f.hub = f.origin; delete f.origin; f.direction = 'departures';
      } else if (f.destination && ASK_HUBS.includes(f.destination) && f.direction !== 'departures') {
        f.hub = f.destination; delete f.destination; f.direction = 'arrivals';
      }
    }
    if (f.hub && f.origin === f.hub) { delete f.origin; if (!f.direction) f.direction = 'departures'; }
    if (f.hub && f.destination === f.hub) { delete f.destination; if (!f.direction) f.direction = 'arrivals'; }
    // A departures board's rows all leave the hub: only the destination can vary, and vice versa.
    if (f.direction === 'departures') delete f.origin;
    if (f.direction === 'arrivals') delete f.destination;
    if (!f.direction && f.origin && f.destination) delete f.origin;
    if (!f.direction && f.origin) f.direction = 'arrivals';
    if (!f.direction && f.destination) f.direction = 'departures';
  }
  if (view === 'live') {
    if (f.direction && !f.hub) delete f.direction;
    // "Arrivals into DEN" with DEN as the hub is the direction; an origin of the same hub would contradict it.
    if (f.hub && f.direction === 'arrivals' && f.destination === f.hub) delete f.destination;
    if (f.hub && f.direction === 'departures' && f.origin === f.hub) delete f.origin;
  }
  if (view === 'flight' && f.flight && f.tail) delete f.tail;
  if (view === 'fleet') {
    // One search box: a tail outranks a type, a type outranks a family. The Fleet tab is mainline
    // only, so the regional families have nothing to show there.
    if (f.tail) { delete f.type; delete f.family; }
    if (f.type) delete f.family;
    if (f.family && !FLEET_TAB_FAMILIES.includes(/** @type {string} */ (f.family))) delete f.family;
  }
  if (view === 'starlink' && f.tail) delete f.hub;
  return f;
}

/**
 * The one gate every ask result passes through, from the rules parser, from the model and from the
 * network. Drops every unknown key and every invalid value, drops filters the view cannot apply,
 * reconciles what is left, and says whether anything usable remains.
 *
 * @param {unknown} raw  { view?, filters?: {...} } or a flat { view?, hub?, ... } object (the model's).
 * @returns {{ok: true, result: {view: string, filters: Record<string, unknown>}} | {ok: false, reason: 'unsupported'|'empty'}}
 */
export function validateAskResult(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reason: 'empty' };
  const obj = /** @type {Record<string, unknown>} */ (raw);
  if (obj.supported === false) return { ok: false, reason: 'unsupported' };
  const source = obj.filters && typeof obj.filters === 'object' && !Array.isArray(obj.filters)
    ? /** @type {Record<string, unknown>} */ (obj.filters)
    : obj;
  /** @type {Record<string, unknown>} */
  const clean = {};
  for (const name of ASK_FILTER_NAMES) {
    if (!Object.prototype.hasOwnProperty.call(source, name)) continue;
    const value = FIELD_CHECKS[name](source[name]);
    if (value !== null && value !== undefined) clean[name] = value;
  }
  const named = pickEnum(obj.view, ASK_VIEWS);
  let view = named ?? inferAskView(clean);
  // A flight number or a tail is a better answer than any list it was asked inside.
  if ((clean.flight || clean.tail) && view !== 'fleet' && view !== 'starlink') view = 'flight';
  if ((view === 'fleet' || view === 'starlink') && clean.flight) view = 'flight';
  // A named view that cannot hold anything that was asked loses to the inferred one.
  const allowed = ASK_VIEW_FILTERS[view];
  const fits = Object.keys(clean).filter((k) => allowed.includes(k)).length;
  if (fits === 0 && Object.keys(clean).length > 0 && !NAVIGATION_VIEWS.has(view)) {
    view = inferAskView(clean);
  }
  const allowedFinal = ASK_VIEW_FILTERS[view];
  /** @type {Record<string, unknown>} */
  let filters = {};
  for (const name of ASK_FILTER_NAMES) if (name in clean && allowedFinal.includes(name)) filters[name] = clean[name];
  // The fleet and Starlink tabs list aircraft with Starlink; "without Starlink" has no control there.
  if ((view === 'fleet') && filters.starlink === false) delete filters.starlink;
  filters = reconcile(view, filters);
  if (view === 'flight' && !filters.flight && !filters.tail) return { ok: false, reason: 'empty' };
  if (Object.keys(filters).length === 0 && !NAVIGATION_VIEWS.has(view) && !(named && view === 'schedule')) {
    return { ok: false, reason: 'empty' };
  }
  return { ok: true, result: { view, filters } };
}

/** The label for one airport: its code (codes on every route, as the board prints them). */
function airportLabel(code) {
  return String(code);
}

/**
 * The removable chips a result shows, in filter order. On the schedule board the hub and direction
 * pick the board (its own controls show them, and the row's sentence names them), so they are not
 * chips there. Every label is from a table in this module or a validated code — never free text.
 *
 * @param {{view: string, filters: Record<string, unknown>}|null|undefined} result
 * @returns {Array<{name: string, label: string, kind: 'starlink'|'plain'}>}
 */
export function askChips(result) {
  if (!result || !result.filters) return [];
  const { view, filters } = result;
  const chips = [];
  for (const name of ASK_FILTER_NAMES) {
    const value = filters[name];
    if (value === undefined || value === null) continue;
    if (view === 'schedule' && (name === 'hub' || name === 'direction')) continue;
    let label = '';
    switch (name) {
      case 'flight': label = String(value); break;
      case 'tail': label = String(value); break;
      case 'hub':
        label = view === 'live' && filters.direction
          ? `${filters.direction === 'arrivals' ? 'Arriving' : 'Leaving'} ${value}`
          : String(value);
        break;
      case 'direction': continue; // folded into the hub chip on the live map
      case 'origin': label = `From ${airportLabel(value)}`; break;
      case 'destination': label = `To ${airportLabel(value)}`; break;
      case 'family': label = ASK_FAMILY_LABELS[/** @type {string} */ (value)] ?? ''; break;
      case 'type': label = ASK_TYPE_LABELS[/** @type {string} */ (value)] ?? ''; break;
      case 'starlink': label = value ? 'Starlink' : 'No Starlink'; break;
      case 'region': label = REGION_LABELS[/** @type {string} */ (value)] ?? ''; break;
      case 'airborne': label = value ? 'In the air' : 'On the ground'; break;
      case 'status': label = ASK_STATUS_LABELS[/** @type {string} */ (value)] ?? ''; break;
      default: label = '';
    }
    if (label) chips.push({ name, label, kind: name === 'starlink' && value ? 'starlink' : 'plain' });
  }
  return chips;
}

/**
 * The result with one chip removed, or null when no chip is left (removing the last chip clears the
 * ask). Removing the live map's hub chip takes its direction with it.
 *
 * @param {{view: string, filters: Record<string, unknown>}} result
 * @param {string} name
 * @returns {{view: string, filters: Record<string, unknown>}|null}
 */
export function withoutAskFilter(result, name) {
  if (!result) return null;
  const filters = { ...result.filters };
  delete filters[name];
  if (name === 'hub' && result.view === 'live') delete filters.direction;
  const next = { view: result.view, filters };
  return askChips(next).length ? next : null;
}

/** The airport-code → city name table, for the model prompt and the rules parser. */
export const ASK_CITY_NAMES = IATA_CITIES;

/**
 * The sentence in front of the chips. The count is whatever the view really shows after filtering;
 * `null` means the view is still loading, which must not read as "nothing matches".
 *
 * @param {{count: number|null, singular: string, pluralNoun?: string, where?: string}} input
 *   `where` is a fixed phrase from the view ("on the map", "at DEN"), never visitor text.
 * @returns {{text: string, hint?: string, empty: boolean, loading: boolean}}
 */
export function askSummaryLine({ count, singular, pluralNoun, where = '' }) {
  const many = pluralNoun || `${singular}s`;
  const tail = where ? ` ${where}` : '';
  if (count === null || count === undefined || !Number.isFinite(count)) {
    return { text: `Finding ${many}${tail}…`, empty: false, loading: true };
  }
  if (count === 0) return { text: `No ${many}${tail} match these filters`, hint: 'Remove one to widen the search.', empty: true, loading: false };
  return { text: `Showing ${count} ${count === 1 ? singular : many}${tail}`, empty: false, loading: false };
}
