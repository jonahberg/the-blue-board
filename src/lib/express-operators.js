// ═══ OPERATING CARRIER FROM A CALLSIGN ═══
// Who is actually flying a United-branded aircraft in the live feed.
//
// The feed's `airline` field is the MARKETING carrier and reads 'UAL' on every row (821 of 821
// aircraft, measured Oct 4 2026), so it cannot tell a SkyWest E175 from a mainline 737. The
// callsign can: a United Express flight files under its operator's own ICAO prefix
// (SKW5123, RPA3401, GJS3375, …) while mainline files as UAL. On that sample the prefixes were
// UAL 586, SKW 112, ASH 36, RPA 34, GJS 28, UCA 22 and 3 blank.
//
// Display only. Nothing here may be used as a flight key — search, watch, deep links and
// schedule matching keep the feed's own idents (a GoJet row's flightIATA is 'G73375').
//
// The same operator set the schedule ingest trusts as "United flies this"
// (api/_schedule-aerodatabox.ts UNITED_OPERATOR_CALLSIGNS), minus the two retired carriers
// (ExpressJet ASQ, Trans States LOF). An unknown prefix returns null rather than a guess.

/** ICAO callsign prefix → operating carrier. `express` = flies as United Express. */
export const UNITED_OPERATORS = Object.freeze({
  UAL: Object.freeze({ name: 'United Airlines', express: false }),
  SKW: Object.freeze({ name: 'SkyWest Airlines', express: true }),
  RPA: Object.freeze({ name: 'Republic Airways', express: true }),
  GJS: Object.freeze({ name: 'GoJet Airlines', express: true }),
  // The carrier spells itself "CommutAir" (no e); api/_starlink-normalize.ts agrees.
  UCA: Object.freeze({ name: 'CommutAir', express: true }),
  ASH: Object.freeze({ name: 'Mesa Airlines', express: true }),
  AWI: Object.freeze({ name: 'Air Wisconsin', express: true }),
});

/**
 * The operating carrier behind a callsign.
 *
 * @param {string|null|undefined} callsign  e.g. 'SKW5123', ' gjs3375 ', 'UAL1'.
 * @returns {{code: string, name: string, express: boolean} | null}  null for a blank callsign
 *   or a prefix we do not know — never a guess.
 */
export function operatorFromCallsign(callsign) {
  const match = /^([A-Z]{3})\d/.exec(String(callsign ?? '').trim().toUpperCase());
  if (!match) return null;
  const code = match[1];
  const entry = Object.prototype.hasOwnProperty.call(UNITED_OPERATORS, code)
    ? UNITED_OPERATORS[code]
    : null;
  return entry ? { code, name: entry.name, express: entry.express } : null;
}

/**
 * Is this live-feed row a United Express flight?
 *
 * @param {{callsign?: string|null}|null|undefined} flight
 * @returns {boolean}
 */
export function isExpressFlight(flight) {
  return Boolean(operatorFromCallsign(flight?.callsign)?.express);
}

/**
 * The flight panel's "operated by" line, or null when the operator is unknown.
 *
 * @param {{callsign?: string|null}|null|undefined} flight
 * @returns {string|null}  'Operated by SkyWest Airlines (United Express)' /
 *   'Operated by United Airlines' / null.
 */
export function operatedByLine(flight) {
  const operator = operatorFromCallsign(flight?.callsign);
  if (!operator) return null;
  return operator.express
    ? `Operated by ${operator.name} (United Express)`
    : `Operated by ${operator.name}`;
}
