// ═══ LIVE MAP FILTERING + HUB TRAFFIC ═══
// The two pure calculations behind the Live Ops tab's sidebar: which flights the current
// filters allow onto the map, and the inbound/outbound traffic split per hub.
//
// Extracted verbatim from src/dashboard/main.js (getFilteredFlights :1059-1076,
// updateHubStats :1945-1976). The DOM writes, the marker diffing and the toggle state
// stay with their callers; only the maths lives here.

import { getPhase, getPhaseGroup } from './flight-phase.js';
import { haversineNm } from './geo.js';

/**
 * A hub filter matches a flight out to 93 NAUTICAL MILES (~172 km), not just at the gate:
 * aircraft still on the ground at a hub often report no origin/dest yet, so proximity is
 * the only thing left to match them on.
 *
 * The unit matters and this comment used to get it wrong — it read "~50 nm out … 93 km",
 * which is a single distance stated twice, but the constant is compared against
 * `haversineNm()`, so the radius the code actually applies is 93 nm. Widening the prose to
 * match the code rather than narrowing the code to match the prose is deliberate: the value
 * has shipped since the Live tab existed and `tests/live-filters.test.js` pins it at 93, so
 * changing it is a product decision about which parked aircraft belong to a hub, not a typo
 * fix. Note that the proximity branch only ever fires for `onGround` traffic, which is why
 * a radius this generous has not visibly pulled in a neighbouring airport's flights.
 */
export const HUB_PROXIMITY_NM = 93;

/**
 * Apply the Live tab's three filters.
 *
 * Hub: FR24's own origin/dest first, falling back to physical proximity for aircraft that
 * are ON THE GROUND — an airborne flight near a hub it is neither leaving nor entering is
 * not that hub's traffic.
 *
 * @param {Array<Object>} flights  every flight in the feed.
 * @param {Object} filters
 * @param {string} [filters.hub]  IATA code, or '' for no hub filter.
 * @param {string} [filters.phaseGroup]  one of Ground/Climb/Cruise/Descent/Approach, or ''.
 * @param {boolean} [filters.starlinkOnly]
 * @param {Object} deps
 * @param {Array<{iata: string, lat: number, lon: number}>} deps.hubs  hub coordinates.
 * @param {(f: Object) => boolean} [deps.isStarlink]  required only when starlinkOnly is set.
 * @returns {Array<Object>} the flights that pass every active filter.
 */
export function filterLiveFlights(flights, filters = {}, deps = {}) {
  const { hub = '', phaseGroup = '', starlinkOnly = false } = filters;
  const { hubs = [], isStarlink } = deps;
  const hubEntry = hub ? hubs.find((h) => h.iata === hub) : null;

  return (flights || []).filter((f) => {
    if (hub) {
      const matchesHub =
        f.origin === hub ||
        f.dest === hub ||
        (f.onGround && hubEntry && haversineNm(f.lat, f.lon, hubEntry.lat, hubEntry.lon) < HUB_PROXIMITY_NM);
      if (!matchesHub) return false;
    }
    if (phaseGroup) {
      if (getPhaseGroup(getPhase(f.alt, f.vr, f.spd).phase) !== phaseGroup) return false;
    }
    if (starlinkOnly && !(isStarlink && isStarlink(f))) return false;
    return true;
  });
}

/**
 * Inbound/outbound counts per hub, plus the busiest hub and the bar scale.
 *
 * Aircraft on the ground are excluded on purpose: the panel answers "what is moving in and
 * out of this hub right now", and parked metal would swamp a quiet hub's bar.
 *
 * @param {Array<Object>} flights
 * @param {string[]} hubCodes  the hubs to report, in display order.
 * @returns {{rows: Array<{hub: string, inbound: number, outbound: number, total: number, pct: number, busiest: boolean}>, maxTotal: number, busiest: string}}
 *   `pct` is the share of the busiest hub's total, for the bar width.
 */
export function hubTraffic(flights, hubCodes) {
  const codes = hubCodes || [];
  const counts = {};
  for (const hub of codes) counts[hub] = { inbound: 0, outbound: 0 };

  for (const f of flights || []) {
    if (f.onGround) continue;
    if (f.origin && counts[f.origin]) counts[f.origin].outbound += 1;
    if (f.dest && counts[f.dest]) counts[f.dest].inbound += 1;
  }

  let maxTotal = 0;
  let busiest = '';
  for (const hub of codes) {
    const total = counts[hub].inbound + counts[hub].outbound;
    if (total > maxTotal) { maxTotal = total; busiest = hub; }
  }

  const rows = codes.map((hub) => {
    const total = counts[hub].inbound + counts[hub].outbound;
    return {
      hub,
      inbound: counts[hub].inbound,
      outbound: counts[hub].outbound,
      total,
      pct: maxTotal > 0 ? (total / maxTotal) * 100 : 0,
      busiest: hub === busiest,
    };
  });

  return { rows, maxTotal, busiest };
}
