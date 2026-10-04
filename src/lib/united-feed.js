// ═══ THE COMPLETE UNITED LIVE FEED ═══
// Which FlightRadar24 feed requests add up to "every United flight", and how to merge them.
//
// Measured Oct 4 2026 against a plain `feed.js?airline=UAL` (what every server read used):
//  - FR24 files some United Express flights under the OPERATOR, not United. 14 SkyWest flights
//    with UA flight numbers (10 airborne — UA5793 IDA-DEN, UA5068 MEI-IAH, UA5139 IAH-HEZ…) came
//    back only under `airline=SKW`, so they were never on the map, the boards' LIVE badges or the
//    airborne count. That same SKW feed also carries SkyWest's American and Delta flying (AA/DL
//    flight numbers), which must stay out — so an operator row counts only when its flight number
//    is United's (UA…, or G7… for GoJet, which flies only for United).
//  - The default request also leaves out two kinds of position FR24's own site shows:
//    estimated positions for flights out of receiver range over an ocean (UA15 LHR-EWR,
//    UA1111 SFO-LIH, ~5 airborne) and aircraft seen only by FAA airport-surface surveillance
//    (~56 on the ground, which the "landed" evidence needs). FR24_FEED_PARAMS asks for both.
// Cross-checked the same afternoon against the nine hubs' boards: every board flight still
// missing after the merge was not in FR24 at all, and an independent ADS-B network (adsb.lol)
// saw those tails parked — landed flights whose board snapshot had not caught the arrival.
//
// Pure: no network, no data imports, so api/ can import it.

import { UNITED_OPERATORS } from './express-operators.js';

/** The source and position switches FR24's own map sends. `maxage` bounds an estimated position. */
export const FR24_FEED_PARAMS =
  'faa=1&satellite=1&mlat=1&flarm=1&adsb=1&gnd=1&air=1&vehicles=0&estimated=1&maxage=14400&gliders=0';

const FEED_BASE = 'https://data-cloud.flightradar24.com/zones/fcgi/feed.js';

/** ICAO codes of the United Express operators (express-operators.js), for the operator request. */
export const UNITED_EXPRESS_AIRLINES = Object.freeze(
  Object.entries(UNITED_OPERATORS)
    .filter(([, op]) => op.express)
    .map(([code]) => code),
);

/** The feed URL for one airline code (or a comma list), with the full source switches. */
export function feedUrl(airline) {
  return `${FEED_BASE}?airline=${encodeURIComponent(airline)}&${FR24_FEED_PARAMS}`;
}

/** The two requests that make up the United feed. */
export function unitedFeedUrls() {
  return { united: feedUrl('UAL'), express: feedUrl(UNITED_EXPRESS_AIRLINES.join(',')) };
}

/**
 * Is this raw feed row a United-marketed flight? Index 13 is the flight number. GoJet files its
 * United flying under its own G7 code (G73375) and flies for no one else.
 *
 * @param {unknown} row  a raw FR24 aircraft array.
 */
export function isUnitedMarketedRow(row) {
  if (!Array.isArray(row)) return false;
  return /^(UA|G7)\d/i.test(String(row[13] ?? '').trim());
}

/**
 * The United feed: every row of the `airline=UAL` payload (its meta keys included), plus each
 * United-marketed row of the operator payload that is not already there. Never mutates either
 * input. A missing or malformed operator payload just yields the United payload.
 *
 * @param {Record<string, unknown>} unitedPayload
 * @param {Record<string, unknown> | null | undefined} expressPayload
 * @returns {{payload: Record<string, unknown>, added: number}}
 */
export function mergeUnitedFeed(unitedPayload, expressPayload) {
  const payload = { ...(unitedPayload || {}) };
  let added = 0;
  if (expressPayload && typeof expressPayload === 'object') {
    for (const [id, row] of Object.entries(expressPayload)) {
      if (!Array.isArray(row) || Object.prototype.hasOwnProperty.call(payload, id)) continue;
      if (!isUnitedMarketedRow(row)) continue;
      payload[id] = row;
      added++;
    }
  }
  return { payload, added };
}

/** Index 7 is the receiver; FR24 marks a projected (out-of-coverage) position "F-EST". */
export function isEstimatedPosition(receiver) {
  return /^F-EST/i.test(String(receiver ?? ''));
}
