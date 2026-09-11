// ═══ STATS TAB AGGREGATIONS ═══
// The five datasets behind the Stats tab's charts. Pure counting — every chart's
// markup, colour ramp and SVG stays in updateAnalytics().
//
// Extracted verbatim from src/dashboard/main.js (:4105-4266).

import { getPhase } from './flight-phase.js';

/**
 * The 19 mainline types, in the fixed display order the Fleet and Stats tabs share.
 * @type {string[]}
 */
export const TYPE_ORDER = ["A319","A320","A321neo","737-700","737-800","737-900","737-900ER","737 MAX 8","737 MAX 9","757-200","757-300","767-300ER","767-400ER","777-200","777-200ER","777-300ER","787-8","787-9","787-10"];

/** The phases the donut slices, in render order. */
const PHASE_ORDER = ['Cruise', 'Climb', 'Descent', 'En Route', 'Takeoff', 'Approach', 'Ground'];

/**
 * Airborne count vs fleet total for each mainline type.
 *
 * @param {Array<Object>} airborneFlights  flights already filtered to airborne.
 * @param {Array<{t: string}>} fleetDb
 * @param {{matchAircraft: (f: Object) => {t: string}|null}} deps
 * @returns {Array<{type: string, flying: number, total: number, pct: number}>} all 19 types, in order.
 */
export function typeUtilization(airborneFlights, fleetDb, { matchAircraft }) {
  const typeTotals = {};
  const typeAirborne = {};
  fleetDb.forEach(a => { typeTotals[a.t] = (typeTotals[a.t] || 0) + 1; });
  TYPE_ORDER.forEach(t => { typeAirborne[t] = 0; });

  airborneFlights.forEach(f => {
    const ac = matchAircraft(f);
    if (ac && typeAirborne[ac.t] !== undefined) typeAirborne[ac.t]++;
  });

  return TYPE_ORDER.map(t => {
    const total = typeTotals[t] || 0;
    const flying = typeAirborne[t] || 0;
    return { type: t, flying, total, pct: total > 0 ? Math.round((flying / total) * 100) : 0 };
  });
}

/**
 * Flight-phase histogram across the whole feed.
 *
 * Unlike the Live sidebar this keeps Cruise and En Route apart — the donut shows
 * all seven phases. `total` floors at 1 so the percentage maths never divides by
 * zero on an empty feed.
 *
 * @param {Array<Object>} flights
 * @returns {{counts: Record<string, number>, total: number, order: string[]}}
 *   `order` is the render order with zero-count phases dropped.
 */
export function phaseBreakdown(flights) {
  const counts = { 'Takeoff': 0, 'Climb': 0, 'Cruise': 0, 'En Route': 0, 'Descent': 0, 'Approach': 0, 'Ground': 0 };
  flights.forEach(f => {
    const p = getPhase(f.alt, f.vr, f.spd);
    if (counts[p.phase] !== undefined) counts[p.phase]++;
  });
  const total = Object.values(counts).reduce((a, b) => a + b, 0) || 1;
  return { counts, total, order: PHASE_ORDER.filter(p => counts[p] > 0) };
}

/**
 * Directional hub-to-hub flow matrix. ORD→DEN and DEN→ORD are separate cells; the
 * diagonal stays empty.
 *
 * @param {Array<Object>} airborneFlights
 * @param {string[]} hubs
 * @returns {{matrix: Record<string, Record<string, number>>, rowTotals: Record<string, number>, max: number}}
 *   `max` floors at 1 for colour scaling.
 */
export function hubMatrix(airborneFlights, hubs) {
  const hubSet = new Set(hubs);
  const matrix = {};
  hubs.forEach(o => { matrix[o] = {}; hubs.forEach(d => { matrix[o][d] = 0; }); });

  airborneFlights.forEach(f => {
    if (f.origin && f.dest && hubSet.has(f.origin) && hubSet.has(f.dest) && f.origin !== f.dest) {
      matrix[f.origin][f.dest]++;
    }
  });

  let max = 1;
  const rowTotals = {};
  hubs.forEach(o => {
    let rowTotal = 0;
    hubs.forEach(d => { if (matrix[o][d] > max) max = matrix[o][d]; rowTotal += matrix[o][d]; });
    rowTotals[o] = rowTotal;
  });

  return { matrix, rowTotals, max };
}

/**
 * Busiest city pairs in the live feed, directional.
 *
 * @param {Array<Object>} airborneFlights
 * @param {number} limit  the chart shows 15.
 * @returns {Array<{route: string, count: number}>} sorted busiest-first.
 */
export function topRoutes(airborneFlights, limit) {
  const routeCount = {};
  airborneFlights.filter(f => f.origin && f.dest).forEach(f => {
    const key = f.origin + '→' + f.dest;
    routeCount[key] = (routeCount[key] || 0) + 1;
  });
  return Object.entries(routeCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([route, count]) => ({ route, count }));
}

/**
 * Mean aircraft age per type, plus the fleet-wide mean.
 *
 * Aircraft with an unparseable delivery year are skipped rather than counted as
 * brand new.
 *
 * @param {Array<{t: string, d?: string}>} fleetDb
 * @param {number} [currentYear]  injectable for deterministic tests.
 * @returns {{rows: Array<{type: string, avg: string|number}>, fleetAvg: string}}
 *   `avg` is a one-decimal string, or the number 0 for a type with no aircraft.
 *   `fleetAvg` is '--' when nothing has a delivery year.
 */
export function avgAgeByType(fleetDb, currentYear = new Date().getFullYear()) {
  const ages = fleetDb.filter(a => parseInt(a.d)).map(a => currentYear - parseInt(a.d));
  const fleetAvg = ages.length ? (ages.reduce((a, b) => a + b, 0) / ages.length).toFixed(1) : '--';

  const typeAges = {};
  fleetDb.forEach(a => {
    const y = parseInt(a.d);
    if (y) {
      if (!typeAges[a.t]) typeAges[a.t] = [];
      typeAges[a.t].push(currentYear - y);
    }
  });

  const rows = TYPE_ORDER.map(t => {
    const tAges = typeAges[t] || [];
    return { type: t, avg: tAges.length ? (tAges.reduce((a, b) => a + b, 0) / tAges.length).toFixed(1) : 0 };
  });

  return { rows, fleetAvg };
}
