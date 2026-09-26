/**
 * One answer to "where is this flight going?", shared by the map and the flight panel.
 *
 * FR24 reports origin and destination for most flights but not all. When it does not, the
 * route is ESTIMATED from position, heading and flight number (`src/lib/route-estimate.js`).
 * Both surfaces have to agree: the panel used to estimate while the map drew only
 * feed-reported routes, so a flight with a blank origin/dest showed "SFO → SIN (estimated)"
 * in the panel and no line on the map at all — which is also how the legacy dashboard
 * behaved (`main.js:1361-1363` fell back to the estimate for the line too).
 *
 * Resolving once, here, is what keeps them in step.
 */

import { AIRPORTS } from '@/lib/airports.js';
import { estimateRoute } from '@/lib/route-estimate.js';
import type { Flight } from './types';

export type RouteAirport = { iata: string; lat: number; lon: number; hub?: boolean };

export type ResolvedRoute = {
  /** Display code, from the feed when it has one, else the estimate, else ''. */
  originIata: string;
  destIata: string;
  /** Coordinates, when the airport is one of the ~150 this app knows. */
  origin: RouteAirport | null;
  dest: RouteAirport | null;
  /** True when either end came from the estimator — the UI must say so. */
  estimated: boolean;
};

const AIRPORT_LIST = AIRPORTS as RouteAirport[];

function byIata(iata: string): RouteAirport | null {
  if (!iata) return null;
  return AIRPORT_LIST.find((airport) => airport.iata === iata) ?? null;
}

export function resolveFlightRoute(flight: Flight | null): ResolvedRoute {
  const empty: ResolvedRoute = {
    originIata: '',
    destIata: '',
    origin: null,
    dest: null,
    estimated: false,
  };
  if (!flight) return empty;

  if (flight.origin && flight.dest) {
    return {
      originIata: flight.origin,
      destIata: flight.dest,
      origin: byIata(flight.origin),
      dest: byIata(flight.dest),
      estimated: false,
    };
  }

  const guess = estimateRoute(
    flight.lat,
    flight.lon,
    flight.hdg,
    flight.alt ? flight.alt * 3.28084 : null,
    flight.vr,
    flight.flightIATA || flight.callsign,
  ) as { origin: RouteAirport | null; dest: RouteAirport | null };

  const origin = flight.origin ? byIata(flight.origin) : (guess.origin ?? null);
  const dest = flight.dest ? byIata(flight.dest) : (guess.dest ?? null);
  return {
    originIata: flight.origin || origin?.iata || '',
    destIata: flight.dest || dest?.iata || '',
    origin,
    dest,
    // Either end coming from the estimator makes the whole route an estimate.
    estimated: !flight.origin || !flight.dest,
  };
}
