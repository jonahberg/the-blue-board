// ═══ LIVE OPS STAT BAR ═══
// The nine numbers along the bottom of the Live tab, plus the sidebar's phase counts.
//
// Extracted verbatim from src/dashboard/main.js (:1853-1914). The DOM writes and the
// phase-row markup stay in updateStats().
//
// Two things worth keeping straight: "ground" comes from the feed's onGround flag,
// not from the computed phase, and the averages only count airborne aircraft that
// actually reported a value — a zero altitude is a missing reading, not sea level.

import { getPhase, getPhaseGroup } from './flight-phase.js';

/**
 * @param {Array<Object>} flights  every flight in the feed (drives the sidebar counts).
 * @param {Array<Object>} filtered  the currently filtered set (drives the stat bar).
 * @param {number} fleetSize  FLEET_DB length; 0 until the fleet loads.
 * @param {{has: (reg: string) => boolean}} starlinkTails
 * @param {{matchAircraft: (f: Object) => {r: string}|null, isFiltered: boolean}} deps
 * @returns {{airborne: number, ground: number, climbing: number, cruising: number,
 *   descending: number, starlink: number, avgAlt: string, avgSpd: string,
 *   utilization: string, note: string, phaseGroups: Record<string, number>}}
 *   avgAlt/avgSpd/utilization are the display strings, '--' when unknown.
 */
export function computeLiveStats(flights, filtered, fleetSize, starlinkTails, { matchAircraft, isFiltered }) {
  let airborne = 0, ground = 0, climbing = 0, cruising = 0, descending = 0;
  let totalAlt = 0, altCount = 0, totalSpd = 0, spdCount = 0, starlinkAirborne = 0;

  filtered.forEach(f => {
    const p = getPhase(f.alt, f.vr, f.spd);
    if (f.onGround) ground++;
    else {
      airborne++;
      if (p.phase === 'Climb' || p.phase === 'Takeoff') climbing++;
      else if (p.phase === 'Cruise' || p.phase === 'En Route') cruising++;
      else if (p.phase === 'Descent' || p.phase === 'Approach') descending++;

      if (f.alt) { totalAlt += f.alt * 3.28084; altCount++; }
      if (f.spd) { totalSpd += f.spd * 1.944; spdCount++; }

      const ac = matchAircraft(f);
      if (ac && starlinkTails.has(ac.r)) starlinkAirborne++;
      else if (f.reg && starlinkTails.has(f.reg)) starlinkAirborne++;
    }
  });

  const note = isFiltered ? ' (filtered)' : '';
  // Small filtered samples produce a misleadingly precise/low % (e.g. "0% (filtered)"
  // for 1 airborne flight matching a narrow hub+phase filter) — below a small threshold,
  // say so plainly instead of asserting a number (P2-A item 5b).
  const utilization = !fleetSize
    ? '--'
    : (isFiltered && airborne < 10)
      ? 'n/a (small sample)'
      : Math.round((airborne / fleetSize) * 100) + '%' + note;

  // Phase stats sidebar (always show total counts from every flight, not the filtered set)
  const phaseGroups = { Ground: 0, Climb: 0, Cruise: 0, Descent: 0, Approach: 0 };
  flights.forEach(f => {
    const g = getPhaseGroup(getPhase(f.alt, f.vr, f.spd).phase);
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
