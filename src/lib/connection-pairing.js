// ═══ CONNECTION PAIRING — which watched flights actually connect ═══
// The search that finds a connection among the watch list, the MCT/walk inputs that
// feed the verdict, the index the AI context reads, and the three-way outcome of the
// manual checker.
//
// Extracted from src/dashboard/main.js (:5986-6026 detectAndRenderConnections,
// :6027-6057 computeConnectionRisk, :6095-6139 checkManualConnection). The VERDICT
// itself is ./connection-risk.js and is never re-implemented here — that module exists
// because a cancelled leg and a missing gate time both used to score SAFE.

import { INTL_AIRPORTS } from './airport-metadata.js';
import {
  MIN_CONNECTION_TIMES,
  TERMINAL_WALK_TIMES,
  classifyConnection,
} from './connection-risk.js';
import { getUnitedTerminal } from './hub-terminals.js';

/** Longest layover still treated as one itinerary, in minutes. */
export const MAX_CONNECTION_MINUTES = 480;

/**
 * Every ordered pair of watched flights that meets at a United hub.
 *
 * Ordered, not combinatorial: A→B followed by B→C is a connection, C→B→A is a
 * different one, and both are worth showing when someone watches a round trip.
 *
 * @param {Array<{flight: string, route?: string}>} flights  watch entries.
 * @param {Array<Object|null>} timeDataArray  their /api/flight-times payloads, index-aligned.
 * @param {string[]} hubCodes
 * @returns {Array<{inbound: {w: Object, td: Object}, outbound: {w: Object, td: Object}, hub: string, minutes: number}>}
 */
export function findWatchedConnections(flights, timeDataArray, hubCodes) {
  const hubs = new Set(hubCodes || []);
  const connections = [];
  for (let i = 0; i < flights.length; i += 1) {
    for (let j = 0; j < flights.length; j += 1) {
      if (i === j) continue;
      const td1 = timeDataArray[i];
      const td2 = timeDataArray[j];
      if (!td1 || !td2 || td1.success === false || td2.success === false) continue;
      const arrHub = td1.destination?.iata;
      const depHub = td2.origin?.iata;
      if (!arrHub || arrHub !== depHub || !hubs.has(arrHub)) continue;
      const arrTime = td1.arrival?.gate?.estimated || td1.arrival?.gate?.scheduled;
      const depTime = td2.departure?.gate?.estimated || td2.departure?.gate?.scheduled;
      if (!arrTime || !depTime) continue;
      const minutes = (new Date(depTime).getTime() - new Date(arrTime).getTime()) / 60000;
      if (!(minutes > 0 && minutes < MAX_CONNECTION_MINUTES)) continue;
      connections.push({
        inbound: { w: flights[i], td: td1 },
        outbound: { w: flights[j], td: td2 },
        hub: arrHub,
        minutes,
      });
    }
  }
  return connections;
}

/**
 * Score one connection.
 *
 * The MCT key is (domestic-in)(domestic-out) against `INTL_AIRPORTS`, so an arrival
 * from Frankfurt is an international inbound even at a domestic hub. Walking is five
 * minutes within one terminal and the published pair time otherwise.
 *
 * @param {{hub: string, inbound: {w: Object, td: Object}, outbound: {w: Object, td: Object}}} conn
 * @returns {Object} the `classifyConnection()` result plus `inTerminal`/`outTerminal`.
 */
export function computeConnectionRisk(conn) {
  const hub = conn.hub;
  const inTd = conn.inbound.td;
  const outTd = conn.outbound.td;

  const isDomIn = !INTL_AIRPORTS.has(inTd.origin?.iata || '');
  const isDomOut = !INTL_AIRPORTS.has(outTd.destination?.iata || '');
  const mctKey = (isDomIn ? 'd' : 'i') + (isDomOut ? 'd' : 'i');
  const mct = MIN_CONNECTION_TIMES[hub]?.[mctKey] || 60;

  const inTerminal =
    inTd.destination?.terminal || getUnitedTerminal(hub, inTd.origin?.iata || '', hub) || '?';
  const outTerminal =
    outTd.origin?.terminal || getUnitedTerminal(hub, hub, outTd.destination?.iata || '') || '?';
  const walkKey = [inTerminal, outTerminal].sort().join('-');
  const walkTime =
    inTerminal === outTerminal
      ? 5
      : TERMINAL_WALK_TIMES[hub]?.[walkKey] || TERMINAL_WALK_TIMES[hub]?.default || 10;

  // `new Date('')`/`new Date(undefined)` → NaN, which classifyConnection reads as
  // "insufficient" rather than falling through to a green verdict (F003/F055).
  const arrMs = new Date(
    inTd.arrival?.gate?.estimated || inTd.arrival?.gate?.scheduled,
  ).getTime();
  const depMs = new Date(
    outTd.departure?.gate?.estimated || outTd.departure?.gate?.scheduled,
  ).getTime();

  const result = classifyConnection({
    arrMs,
    depMs,
    mct,
    walkTime,
    inboundCancelled: !!inTd.cancelled,
    outboundCancelled: !!outTd.cancelled,
    inboundDiverted: !!inTd.diverted,
    outboundDiverted: !!outTd.diverted,
    inboundFlight: conn.inbound?.w?.flight || 'the inbound flight',
    outboundFlight: conn.outbound?.w?.flight || 'the outbound flight',
  });
  return { ...result, inTerminal, outTerminal };
}

/**
 * Index both legs of every connection by flight number, so the delay-explain context
 * for either flight knows about the other.
 *
 * @param {Array<Object>} connections
 * @param {Array<Object>} risks  index-aligned with `connections`.
 * @returns {Record<string, Object>}
 */
export function buildConnectionIndex(connections, risks) {
  const index = {};
  connections.forEach((conn, i) => {
    const risk = risks[i];
    const inFlight = conn.inbound.w.flight;
    const outFlight = conn.outbound.w.flight;
    index[inFlight] = {
      connFlight: outFlight,
      hub: conn.hub,
      dest: conn.outbound.td.destination?.iata || '?',
      minutes: risk.connectionMin,
      risk: risk.risk,
      label: risk.label,
    };
    index[outFlight] = {
      connFlight: inFlight,
      hub: conn.hub,
      orig: conn.inbound.td.origin?.iata || '?',
      minutes: risk.connectionMin,
      risk: risk.risk,
      label: risk.label,
      isOutbound: true,
    };
  });
  return index;
}

/**
 * One sentence about this flight's connection, for the AI delay-explanation context.
 * @param {Object|null|undefined} entry  a `buildConnectionIndex()` value.
 * @returns {string}
 */
export function connectionContextStr(entry) {
  if (!entry) return '';
  return entry.isOutbound
    ? `Connecting from ${entry.connFlight} via ${entry.hub}, ${entry.minutes}min layover (${entry.risk})`
    : `Connects to ${entry.connFlight} ${entry.hub}→${entry.dest || '?'}, ${entry.minutes}min layover (${entry.risk})`;
}

/**
 * 'ua 123' / 'UAL123' / '123' → 'UA123'.
 *
 * The shipped checker's `startsWith('UA')` guard let the ICAO spelling `UAL123` through
 * untouched, so /api/flight-times answered `success:false` and the checker told the
 * passenger to "check the flight numbers" for a flight number that was fine.
 */
export function normalizeConnectionFlight(raw) {
  const value = String(raw || '').trim().toUpperCase().replace(/\s+/g, '');
  if (!value) return '';
  if (/^UAL\d/.test(value)) return `UA${value.slice(3)}`;
  return value.startsWith('UA') ? value : `UA${value}`;
}

/**
 * What the manual checker should say.
 *
 * Three distinct failures, because they are three distinct fixes. A null response is
 * the FEED being dark — nothing the visitor typed is wrong, and the shipped copy used
 * to blame them for it on every valid input while flight-times was down. `success:false`
 * is a genuine not-found. A hub mismatch is two real flights that do not meet.
 *
 * @param {Object|null} r1  inbound /api/flight-times payload, null when the request failed.
 * @param {Object|null} r2  outbound.
 * @param {string} inFlight  normalised inbound flight number.
 * @param {string} outFlight
 * @returns {{kind: 'outage'|'not-found'|'not-connecting'|'ok', message?: string, conn?: Object}}
 */
export function manualConnectionOutcome(r1, r2, inFlight, outFlight) {
  if (r1 === null || r2 === null) {
    return {
      kind: 'outage',
      message: 'Flight times are temporarily unavailable. Please try again later.',
    };
  }
  if (r1.success === false || r2.success === false) {
    return {
      kind: 'not-found',
      message: 'Could not find one or both flights. Check the flight numbers.',
    };
  }
  const arrHub = r1.destination?.iata;
  const depHub = r2.origin?.iata;
  if (arrHub !== depHub) {
    return {
      kind: 'not-connecting',
      message: `These flights don't connect — ${inFlight} arrives at ${arrHub || '?'}, ${outFlight} departs from ${depHub || '?'}.`,
    };
  }
  return {
    kind: 'ok',
    conn: {
      inbound: {
        w: {
          flight: inFlight,
          route: `${r1.origin?.iata || ''}→${r1.destination?.iata || ''}`,
        },
        td: r1,
      },
      outbound: {
        w: {
          flight: outFlight,
          route: `${r2.origin?.iata || ''}→${r2.destination?.iata || ''}`,
        },
        td: r2,
      },
      hub: arrHub,
      minutes: 0,
    },
  };
}

/**
 * The detail line under a connection card.
 *
 * The honesty clause is load-bearing: `MIN_CONNECTION_TIMES` is OUR padded comfort
 * guidance, and United's published MCT is lower. A card that presents our number as
 * the airline's would tell someone to rebook a connection the airline sells.
 *
 * @param {Object} risk  a `computeConnectionRisk()` result.
 * @returns {{tone: 'detail'|'muted', text: string}}
 */
export function connectionDetailLine(risk) {
  if (risk.state === 'scored' && risk.hasData) {
    return {
      tone: 'detail',
      text: `${risk.connectionMin}min connection · ${risk.mct}min comfortable minimum (our conservative guidance — United's published MCT is lower) · T${risk.inTerminal} → T${risk.outTerminal} (~${risk.walkTime}min walk) · ${risk.buffer}min buffer after walking`,
    };
  }
  if (risk.state === 'insufficient') {
    return {
      tone: 'muted',
      text: "We don't have gate times for one or both legs yet — check united.com for the latest before relying on this connection.",
    };
  }
  return {
    tone: 'muted',
    text: 'A leg is cancelled or diverted — re-book or confirm with United before counting on this connection.',
  };
}
