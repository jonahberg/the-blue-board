/**
 * "Does this live flight have Starlink?" — one definition, used by the map colours, the
 * Starlink-only filter and the stat bar so they can never disagree.
 *
 * Matching goes through the fleet database first (`matchAircraft` resolves an ICAO24 to a
 * registration when the feed omits one) and only then falls back to the raw registration,
 * normalised the way the roster stores it. An empty roster answers `false` for everything —
 * in the degraded tier the dashboard must not claim Starlink it cannot verify.
 */

import { matchAircraft } from '@/lib/fleet-match.js';
import type { FleetAircraft, Flight } from '../../data/types';

export function makeIsStarlinkFlight(
  tails: Set<string>,
  fleetByReg: Record<string, FleetAircraft>,
): (flight: Flight) => boolean {
  return (flight: Flight) => {
    if (tails.size === 0 || !flight) return false;
    const aircraft = matchAircraft(flight, fleetByReg) as { r?: string } | null;
    if (aircraft?.r) return tails.has(aircraft.r);
    return Boolean(flight.reg) && tails.has(flight.reg.replace(/-/g, '').toUpperCase());
  };
}
