// ═══ FLEET TAB VIEW MODELS ═══
// The counting, bucketing and geometry the Fleet tab's three zones render from.
// Pure, injected, and tested — the React views own markup and nothing else.
//
// Extracted verbatim from src/dashboard/main.js: renderAgeChart() (:2237-2340,
// the 8-colour family map, the year buckets, the decade breakdown), renderFleetHealth()
// (:1949-1981), showConfigGallery() (:2177-2206), renderAirborneTable() (:2035-2097),
// applyFleetDeepLinkFilter() (:486-508) and the seat bar in buildAircraftDetailHTML()
// (:7385-7395).

import { getPhase } from './flight-phase.js';
import { matchAircraft } from './fleet-match.js';
import { categorizeFleetStatus, FLEET_HEALTH_CATEGORIES, normalizeWifi } from './fleet-utils.js';
import { CABIN_COLORS, SEAT_BAR_COLORS } from './special-aircraft.js';

/**
 * Delivery-chart colour per type: one hue per airframe family, a lighter tint for the
 * A321neo so the newest Airbus separates from the legacy A320s.
 * @type {Record<string, string>}
 */
export const FLEET_FAMILY_COLORS = {
  A319: '#8b5cf6', A320: '#8b5cf6', A321neo: '#a78bfa',
  '737-700': '#3b82f6', '737-800': '#3b82f6', '737-900': '#3b82f6', '737-900ER': '#3b82f6',
  '737 MAX 8': '#22c55e', '737 MAX 9': '#22c55e',
  '757-200': '#f59e0b', '757-300': '#f59e0b',
  '767-300ER': '#ef4444', '767-400ER': '#ef4444',
  '777-200': '#ec4899', '777-200ER': '#ec4899', '777-300ER': '#ec4899',
  '787-8': '#06b6d4', '787-9': '#06b6d4', '787-10': '#06b6d4',
};

/** Colour → the legend's name for that family. @type {Record<string, string>} */
export const FLEET_FAMILY_COLOR_NAMES = {
  '#8b5cf6': 'A320 family', '#a78bfa': 'A321neo', '#3b82f6': '737NG',
  '#22c55e': '737 MAX', '#f59e0b': '757', '#ef4444': '767',
  '#ec4899': '777', '#06b6d4': '787',
};

/** The colour a type with no family entry falls back to in the stacked bars. */
export const FLEET_FAMILY_FALLBACK_COLOR = '#64748b';

/** Deliveries outside this window are chart noise (a typo'd year, a future order). */
const CHART_MIN_YEAR = 1990;
const CHART_MAX_YEAR = 2030;

/**
 * Aircraft per type.
 * @param {Array<{t?: string}>} fleetDb
 * @returns {Record<string, number>}
 */
export function typeCounts(fleetDb) {
  /** @type {Record<string, number>} */
  const counts = {};
  (fleetDb || []).forEach((a) => {
    if (!a || !a.t) return;
    counts[a.t] = (counts[a.t] || 0) + 1;
  });
  return counts;
}

/**
 * The WiFi dropdown's options: every normalised value present in the fleet, sorted.
 * @param {Array<{w?: string}>} fleetDb
 * @returns {string[]}
 */
export function wifiFilterOptions(fleetDb) {
  return [...new Set((fleetDb || []).map((a) => normalizeWifi(a && a.w)).filter(Boolean))].sort();
}

/**
 * The Delivery Timeline's stacked bars.
 *
 * One bar per year between the first and last delivery year actually present (clamped to
 * 1990–2030), including the empty years in between so the x-axis stays linear. Each bar's
 * segments are the families delivered that year, tallest first. Heights are in pixels so the
 * proportional maths — including the 1 px floor that keeps a single aircraft visible — is
 * tested here rather than inline in a component.
 *
 * @param {Array<{t?: string, d?: string|number}>} fleetDb
 * @param {{barHeight?: number}} [options]
 * @returns {{years: Array<{year: number, total: number, segments: Array<{color: string, count: number, height: number}>, height: number, showCount: boolean, showYear: boolean}>, minYear: number|null, maxYear: number|null, maxCount: number, legend: Array<{color: string, name: string}>}}
 *   `years` is empty (and the year bounds null) when nothing has a usable delivery year.
 */
export function buildDeliveryTimeline(fleetDb, { barHeight = 140 } = {}) {
  /** @type {Record<number, {total: number, families: Record<string, number>}>} */
  const yearData = {};
  (fleetDb || []).forEach((a) => {
    if (!a) return;
    const y = parseInt(a.d, 10);
    if (!y || y < CHART_MIN_YEAR || y > CHART_MAX_YEAR) return;
    if (!yearData[y]) yearData[y] = { total: 0, families: {} };
    yearData[y].total++;
    const color = FLEET_FAMILY_COLORS[a.t] || FLEET_FAMILY_FALLBACK_COLOR;
    yearData[y].families[color] = (yearData[y].families[color] || 0) + 1;
  });

  const presentYears = Object.keys(yearData).map(Number);
  if (!presentYears.length) {
    return { years: [], minYear: null, maxYear: null, maxCount: 1, legend: [] };
  }

  const minYear = Math.min(...presentYears);
  const maxYear = Math.max(...presentYears);
  const maxCount = Math.max(...Object.values(yearData).map((d) => d.total), 1);

  const years = [];
  for (let y = minYear; y <= maxYear; y++) {
    // Year labels: every fifth year, plus both ends, so the axis reads at any width. A
    // multiple of five immediately beside an end loses — two four-digit labels one slot
    // apart run together into "20252026", and the end of the range is the more useful of
    // the two to keep.
    const isEnd = y === minYear || y === maxYear;
    const crowdsAnEnd = Math.abs(y - minYear) < 2 || Math.abs(y - maxYear) < 2;
    const showYear = isEnd || (y % 5 === 0 && !crowdsAnEnd);
    const d = yearData[y];
    if (!d) {
      years.push({ year: y, total: 0, segments: [], height: 0, showCount: false, showYear });
      continue;
    }
    const height = (d.total / maxCount) * barHeight;
    const segments = Object.entries(d.families)
      .sort((a, b) => b[1] - a[1])
      .map(([color, count]) => ({
        color,
        count,
        // A one-aircraft segment in a tall bar would otherwise round away to nothing.
        height: Math.max(1, (count / d.total) * height),
      }));
    // Only the tall bars get a printed count; on the thin ones it would not fit.
    years.push({ year: y, total: d.total, segments, height, showCount: d.total >= 15, showYear });
  }

  // Legend order is first-seen order through the fleet, which groups the Airbus and Boeing
  // entries the way the database itself is ordered.
  const legend = [];
  const seen = new Set();
  (fleetDb || []).forEach((a) => {
    const color = a && FLEET_FAMILY_COLORS[a.t];
    if (!color || seen.has(color)) return;
    seen.add(color);
    legend.push({ color, name: FLEET_FAMILY_COLOR_NAMES[color] || '?' });
  });

  return { years, minYear, maxYear, maxCount, legend };
}

/** The five age buckets under the delivery chart, in render order. */
const DECADE_BUCKETS = ['0-5y', '6-10y', '11-15y', '16-20y', '20y+'];

/**
 * The stats line under the Delivery Timeline: mean age, the newest and oldest airframes,
 * and the age histogram.
 *
 * @param {Array<{r?: string, d?: string|number}>} fleetDb
 * @param {number} [currentYear]  injectable so the test does not drift each January.
 * @returns {{avgAge: string, newest: {r?: string, d?: string|number}|null, oldest: {r?: string, d?: string|number}|null, decades: Array<{label: string, count: number}>}}
 *   `avgAge` is '--' when no aircraft has a usable delivery year.
 */
export function deliveryStats(fleetDb, currentYear = new Date().getFullYear()) {
  const dated = (fleetDb || []).filter((a) => a && parseInt(a.d, 10));
  const ages = dated.map((a) => currentYear - parseInt(a.d, 10));
  const avgAge = ages.length ? (ages.reduce((a, b) => a + b, 0) / ages.length).toFixed(1) : '--';
  const newest = [...dated].sort((a, b) => parseInt(b.d, 10) - parseInt(a.d, 10))[0] || null;
  const oldest = [...dated].sort((a, b) => parseInt(a.d, 10) - parseInt(b.d, 10))[0] || null;

  /** @type {Record<string, number>} */
  const counts = { '0-5y': 0, '6-10y': 0, '11-15y': 0, '16-20y': 0, '20y+': 0 };
  ages.forEach((age) => {
    if (age <= 5) counts['0-5y']++;
    else if (age <= 10) counts['6-10y']++;
    else if (age <= 15) counts['11-15y']++;
    else if (age <= 20) counts['16-20y']++;
    else counts['20y+']++;
  });

  return {
    avgAge,
    newest,
    oldest,
    decades: DECADE_BUCKETS.map((label) => ({ label, count: counts[label] })),
  };
}

/**
 * The Fleet Health panel: how much of the fleet is actually flyable today.
 *
 * Categories with no aircraft are dropped rather than shown as zero — an empty
 * "Painting" row reads as a measurement, and there is nothing to measure.
 *
 * @param {Array<{s?: string}>} fleetDb
 * @returns {{total: number, active: number, nonActive: number, activePct: string, bars: Array<{key: string, label: string, color: string, count: number, pct: string}>}|null}
 *   null on an empty fleet — the caller shows its load state, never "0 aircraft".
 */
export function fleetHealthCounts(fleetDb) {
  if (!fleetDb || !fleetDb.length) return null;
  /** @type {Record<string, number>} */
  const counts = {};
  FLEET_HEALTH_CATEGORIES.forEach((c) => { counts[c.key] = 0; });
  fleetDb.forEach((a) => {
    const cat = categorizeFleetStatus(a && a.s);
    counts[cat] = (counts[cat] || 0) + 1;
  });
  const total = fleetDb.length;
  const active = counts.active || 0;
  return {
    total,
    active,
    nonActive: total - active,
    activePct: ((active / total) * 100).toFixed(1),
    bars: FLEET_HEALTH_CATEGORIES.filter((cat) => (counts[cat.key] || 0) > 0).map((cat) => ({
      key: cat.key,
      label: cat.label,
      color: cat.color,
      count: counts[cat.key],
      pct: ((counts[cat.key] / total) * 100).toFixed(1),
    })),
  };
}

/**
 * The seat-configuration gallery for one type: every distinct cabin layout that type flies,
 * with a block per cabin whose width is proportional to its seat count.
 *
 * The 30 px floor is deliberate — an 8-seat Polaris cabin drawn to scale would be 4 px wide
 * and unlabelable, and the point of the gallery is to name the cabins.
 *
 * @param {Array<{t?: string, c?: string, tot?: number, seats?: Record<string, number>}>} fleetDb
 * @param {string} type
 * @returns {Array<{config: string, count: number, total: number|null, blocks: Array<{cabin: string, count: number, width: number, color: string}>}>}
 */
export function buildConfigGallery(fleetDb, type) {
  /** @type {Record<string, {count: number, seats: Record<string, number>|undefined, total: number|null}>} */
  const configs = {};
  (fleetDb || []).filter((a) => a && a.t === type).forEach((a) => {
    const key = a.c || 'Unknown';
    if (!configs[key]) configs[key] = { count: 0, seats: a.seats, total: a.tot ?? null };
    configs[key].count++;
  });

  return Object.entries(configs).map(([config, data]) => ({
    config,
    count: data.count,
    total: data.total,
    blocks: Object.entries(data.seats || {}).map(([cabin, count]) => ({
      cabin,
      count,
      width: Math.max(30, count / 2),
      color: CABIN_COLORS[cabin] || '#475569',
    })),
  }));
}

/**
 * The aircraft dialog's proportional seat bar.
 *
 * `flex` is the raw seat count: the bar is a flex row, so the browser does the division and
 * a rounding error can never leave a gap. A segment under 8 % of the cabin loses its label
 * rather than overflowing it into its neighbour.
 *
 * @param {Record<string, number>|null|undefined} seats
 * @param {number|null|undefined} tot
 * @returns {Array<{cabin: string, count: number, flex: number, color: string, showLabel: boolean}>}
 */
export function buildSeatBar(seats, tot) {
  return Object.entries(seats || {}).map(([cabin, count]) => ({
    cabin,
    count,
    flex: count,
    color: SEAT_BAR_COLORS[cabin] || 'rgba(100,116,139,.5)',
    showLabel: tot ? (count / tot) * 100 > 8 : false,
  }));
}

/**
 * The "Airborne Now" table: every live flight the fleet database can name, with the type and
 * search filters from the shared controls applied.
 *
 * Flights that do not resolve to a mainline airframe are dropped, not shown as blanks — this
 * table is the fleet's view of the sky, and a United Express regional is not in the fleet.
 *
 * @param {Array<Object>} flights
 * @param {{fleetByReg: Record<string, Object>, starlinkTails: Set<string>, special: Map<string, {name: string, type: string}>, type?: string, search?: string}} deps
 * @returns {Array<{reg: string, type: string, flight: string, route: string, alt: string, altRaw: number, phase: string, starlink: boolean, special: {name: string}|null, icao24: string}>}
 */
export function buildAirborneRows(flights, { fleetByReg, starlinkTails, special, type = '', search = '' }) {
  const searchUpper = (search || '').toUpperCase();
  const rows = [];
  (flights || []).forEach((f) => {
    if (!f || f.onGround) return;
    const ac = matchAircraft(f, fleetByReg || {});
    if (!ac) return;
    if (type && ac.t !== type) return;
    if (
      searchUpper &&
      !(ac.r || '').toUpperCase().includes(searchUpper) &&
      !(ac.t || '').toUpperCase().includes(searchUpper)
    ) return;
    const phase = getPhase(f.alt, f.vr, f.spd);
    rows.push({
      reg: ac.r,
      type: ac.t,
      flight: f.flightIATA || f.callsign || '',
      route: `${f.origin || '???'} > ${f.dest || '???'}`,
      alt: f.alt ? `${Math.round(f.alt * 3.28084).toLocaleString()}ft` : '--',
      altRaw: f.alt || 0,
      phase: phase.phase,
      starlink: Boolean(starlinkTails && (starlinkTails.has(ac.r) || starlinkTails.has(f.reg))),
      special: (special && special.get(ac.r)) || null,
      icao24: f.icao24 || '',
    });
  });
  return rows;
}

/**
 * Sort the airborne rows. `alt` sorts on the raw metres, everything else on the display
 * string, which is what the shipped table did.
 *
 * @param {Array<Object>} rows
 * @param {string} col
 * @param {boolean} asc
 * @returns {Array<Object>} a new array.
 */
export function sortAirborneRows(rows, col, asc) {
  return [...(rows || [])].sort((a, b) => {
    let va;
    let vb;
    if (col === 'alt') { va = a.altRaw; vb = b.altRaw; }
    else { va = a[col] || ''; vb = b[col] || ''; }
    return asc ? (va > vb ? 1 : -1) : (va < vb ? 1 : -1);
  });
}

/**
 * Resolve `?type=` / `?filter=` against the controls that actually exist.
 *
 * Status wins over type, and the loser is cleared, so a deep link can never leave the table
 * showing the intersection of two filters the visitor did not ask for. A value matching
 * neither is ignored rather than guessed at — `?type=B789` is an ICAO code the Fleet tab has
 * never filtered on, and silently showing zero aircraft would read as "United has no 787-9s".
 *
 * @param {string|null|undefined} filter
 * @param {{typeValues: Iterable<string>, statusValues: Iterable<string>}} options
 * @returns {{status: string, type: string}|null} null when nothing matched.
 */
export function resolveFleetDeepLinkFilter(filter, { typeValues, statusValues }) {
  if (!filter) return null;
  if (new Set(statusValues).has(filter)) return { status: filter, type: '' };
  if (new Set(typeValues).has(filter)) return { status: '', type: filter };
  return null;
}

/**
 * The special-aircraft panel's rows, cross-referenced against the live feed so a named
 * aircraft that is in the air right now says so.
 *
 * @param {Map<string, {name: string, type: string}>} special
 * @param {Record<string, Object>} fleetByReg
 * @param {Array<Object>} flights
 * @returns {Array<{reg: string, name: string, kind: string, type: string, delivered: string, airborne: {flight: string, route: string}|null}>}
 */
export function buildSpecialRows(special, fleetByReg, flights) {
  /** @type {Record<string, {flight: string, route: string}>} */
  const airborne = {};
  (flights || []).forEach((f) => {
    if (!f || f.onGround) return;
    const reg = f.reg ? f.reg.replace('-', '') : null;
    if (reg && special && special.has(reg)) {
      airborne[reg] = {
        flight: f.flightIATA || f.callsign || '',
        route: `${f.origin || '???'} > ${f.dest || '???'}`,
      };
    }
  });

  const rows = [];
  (special ? [...special.keys()] : []).forEach((reg) => {
    const ac = fleetByReg && fleetByReg[reg];
    if (!ac) return;
    const entry = special.get(reg);
    rows.push({
      reg,
      name: entry.name,
      kind: entry.type,
      type: ac.t,
      delivered: ac.d || '?',
      airborne: airborne[reg] || null,
    });
  });
  return rows;
}
