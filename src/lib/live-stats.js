// ═══ LIVE OPS STAT BAR ═══
// The nine numbers along the bottom of the Live tab, plus the sidebar's phase counts.
//
// Extracted verbatim from src/dashboard/main.js (:1853-1914). The DOM writes and the
// phase-row markup stay in updateStats().
//
// Three things worth keeping straight:
//  - "on the ground" has ONE definition, `isOnGround()` below, used by the stat bar, the
//    sidebar's Ground bucket, and (through `isAirborne`) the Stats and Fleet tabs. The bar
//    used to trust only the feed's onGround flag while the sidebar used the computed phase,
//    so the same screen said Ground 55 and Ground 56 (F67).
//  - utilization is `fleetUtilization()` from fleet-utils.js — matched mainline airframes
//    over the fleet database, the definition every tab shares (F8/F92).
//  - the averages only count airborne aircraft that actually reported a value — a zero
//    altitude is a missing reading, not sea level.

import { getPhase, getPhaseGroup } from './flight-phase.js';
import { fleetUtilization } from './fleet-utils.js';

/**
 * On the ground: the feed says so, OR the telemetry does (under 100 ft and 50 kt — the
 * `getPhase()` Ground rule). One definition for every count on every tab.
 * @param {Object} f
 * @returns {boolean}
 */
export function isOnGround(f) {
  if (!f) return true;
  if (f.onGround) return true;
  return getPhase(f.alt, f.vr, f.spd).phase === 'Ground';
}

/** The complement of `isOnGround` — the one "airborne" filter the tabs share. */
export function isAirborne(f) {
  return !isOnGround(f);
}

/**
 * The Starlink test a stat-bar caller passes: either the shared predicate
 * (`makeIsStarlinkFlight` — preferred) or, for older callers, the roster Set, in which case
 * the same rule is applied here: fleet match first, then the hyphen-free upper-cased reg
 * (F101 — the bar used to test the raw, un-normalised reg).
 */
function toStarlinkPredicate(starlink, matchAircraft) {
  if (typeof starlink === 'function') return starlink;
  const tails = starlink;
  return (f) => {
    if (!tails || !tails.size) return false;
    const ac = matchAircraft ? matchAircraft(f) : null;
    if (ac && ac.r) return tails.has(ac.r);
    return Boolean(f.reg) && tails.has(String(f.reg).replace(/-/g, '').toUpperCase());
  };
}

/**
 * @param {Array<Object>} flights  every flight in the feed (drives the sidebar counts).
 * @param {Array<Object>} filtered  the currently filtered set (drives the stat bar).
 * @param {number} fleetSize  FLEET_DB length; 0 until the fleet loads.
 * @param {((f: Object) => boolean)|{has: (reg: string) => boolean, size: number}} starlink
 *   the shared Starlink predicate, or the roster Set (see toStarlinkPredicate).
 * @param {{matchAircraft: (f: Object) => {r: string}|null, isFiltered: boolean}} deps
 * @returns {{airborne: number, ground: number, climbing: number, cruising: number,
 *   descending: number, starlink: number, avgAlt: string, avgSpd: string,
 *   utilization: string, note: string, phaseGroups: Record<string, number>}}
 *   avgAlt/avgSpd/utilization are the display strings, '--' when unknown.
 */
export function computeLiveStats(flights, filtered, fleetSize, starlink, { matchAircraft, isFiltered }) {
  let airborne = 0, ground = 0, climbing = 0, cruising = 0, descending = 0;
  let totalAlt = 0, altCount = 0, totalSpd = 0, spdCount = 0, starlinkAirborne = 0;
  const isStarlink = toStarlinkPredicate(starlink, matchAircraft);
  const airborneFlights = [];

  filtered.forEach(f => {
    const p = getPhase(f.alt, f.vr, f.spd);
    if (isOnGround(f)) ground++;
    else {
      airborneFlights.push(f);
      airborne++;
      if (p.phase === 'Climb' || p.phase === 'Takeoff') climbing++;
      else if (p.phase === 'Cruise' || p.phase === 'En Route') cruising++;
      else if (p.phase === 'Descent' || p.phase === 'Approach') descending++;

      if (f.alt) { totalAlt += f.alt * 3.28084; altCount++; }
      if (f.spd) { totalSpd += f.spd * 1.944; spdCount++; }

      if (isStarlink(f)) starlinkAirborne++;
    }
  });

  const note = isFiltered ? ' (filtered)' : '';
  // Small filtered samples produce a misleadingly precise/low % (e.g. "0% (filtered)"
  // for 1 airborne flight matching a narrow hub+phase filter) — below a small threshold,
  // say so plainly instead of asserting a number (P2-A item 5b).
  const util = fleetUtilization(airborneFlights, fleetSize, matchAircraft);
  const utilization = util.pct == null
    ? '--'
    : (isFiltered && airborne < 10)
      ? 'n/a (small sample)'
      : util.pct + '%' + note;

  // Phase stats sidebar (always show total counts from every flight, not the filtered set).
  // Same ground rule as the bar: a flight the feed flags onGround is Ground here too.
  const phaseGroups = { Ground: 0, Climb: 0, Cruise: 0, Descent: 0, Approach: 0 };
  flights.forEach(f => {
    const g = isOnGround(f) ? 'Ground' : getPhaseGroup(getPhase(f.alt, f.vr, f.spd).phase);
    if (phaseGroups[g] !== undefined) phaseGroups[g]++;
  });

  return {
    airborne,
    ground,
    climbing,
    cruising,
    descending,
    starlink: starlinkAirborne,
    avgAlt: altCount ? Math.round(totalAlt / altCount).toLocaleString() + 'ft' : '--',
    avgSpd: spdCount ? Math.round(totalSpd / spdCount) + 'kts' : '--',
    utilization,
    note,
    phaseGroups,
  };
}
