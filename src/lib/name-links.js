// ═══ NAMES MY FLIGHTS AND THE OVERLAYS LINK ═══
// The row-model decisions behind the links on the My Flights tab and in the overlays (the flight
// sheet, the aircraft dialog, the FR24 lookup, the delay explanation): which piece of a printed
// string is the code that links, and which provider type strings may decide a type link. The rule
// for each kind of name is the foundation's (hub-link.js, tail-link.js, fleet-type-link.js,
// flight-link.js); this only hands it the right piece.
//
// DOM-free; tested in tests/name-links.test.js.

import { FLEET_TYPE_SLUGS } from './fleet-type-link.js';
import { nonMainlineAircraftSummary } from './fleet-view.js';

/** The Starlink tab: where a Starlink badge on a flight or an aircraft goes. */
export const STARLINK_TAB_HREF = '/#starlink';

/** Two airport codes (or none) joined by the arrow, as `${orig}→${dest}` builds them. */
const ROUTE_RE = /^([A-Z0-9]{3,4})?→([A-Z0-9]{3,4})?$/;

/**
 * A route printed as one string, split into its two ends so each can link: the delay
 * explanation's `route`, which My Flights and the Schedule board both build as
 * `${origCode}→${destCode}`. An end the caller had no code for stays empty, as the string printed
 * it. Null for anything else, which the caller prints as it was sent.
 *
 * @param {unknown} route  e.g. 'ORD→DEN'.
 * @returns {{origin: string, destination: string} | null}
 */
export function routeEnds(route) {
  if (typeof route !== 'string') return null;
  const match = ROUTE_RE.exec(route.trim());
  if (!match || (!match[1] && !match[2])) return null;
  return { origin: match[1] ?? '', destination: match[2] ?? '' };
}

/**
 * One end of a My Flights card's route: "Chicago (ORD)", or the code alone when there is no city
 * name for it ("EUG", not "EUG (EUG)"), and "?" for an end with no code. The code is printed (and
 * linked, when it is a hub) apart from the city.
 *
 * @param {string} code  the airport code, '' when unknown.
 * @param {string} city  its city name, '' or the code itself when there is none.
 * @returns {{city: string, code: string}}  `city` is '' when only the code prints.
 */
export function routeEndLabel(code, city) {
  const printedCode = code || '?';
  return { city: city && city !== code ? city : '', code: printedCode };
}

/**
 * An ICAO type designator: a letter, then one to three letters or digits (B739, A21N, E75L). Two
 * fleet type codes have this shape, A319 and A320, because they are designators too.
 */
const ICAO_DESIGNATOR_RE = /^[A-Z][A-Z0-9]{1,3}$/;

/**
 * A provider's aircraft type string (FR24's `aircraft.type`, flight-times' `aircraft`), passed on
 * as `fleetTypeCodeFor`'s `typeText` only when it may decide a type link for a row with no tail:
 * exactly one of the fleet database's type codes, and not an ICAO designator. A provider that
 * sends "A320" is sending the designator, which is A320 and also B739 (the 737-900 and the
 * 737-900ER) for other rows, so neither prints as a link without a tail. Spelled-out or clipped
 * text ("Boeing 737-900") and regional types never match. With a tail, `fleetTypeCodeFor` reads
 * only the tail and ignores this.
 *
 * @param {unknown} text
 * @returns {string | null}
 */
export function providerTypeText(text) {
  if (typeof text !== 'string' || !Object.hasOwn(FLEET_TYPE_SLUGS, text)) return null;
  return ICAO_DESIGNATOR_RE.test(text) ? null : text;
}

/**
 * Whether the flight sheet's "unmatched" line ("E75L · N123 (not in mainline fleet DB)") links its
 * tail to the aircraft dialog. That line prints only when neither the mainline fleet database nor
 * the United Express fleet knows the tail, so the dialog has no card of its own for it. Its
 * fallback repeats what the sheet already shows (the same flight, the feed's ICAO type,
 * Planespotters), and on the ground it says the tail "may be a United Express aircraft", the guess
 * the sheet's note exists to avoid for a recent mainline delivery. The one thing it adds is what
 * the Starlink roster knows (type, operator, Starlink), so the tail links only when the roster
 * knows it: the dialog's own summary with the live flight left out
 * (`nonMainlineAircraftSummary(reg, roster, null)`). Plan ruling 6: a class of tail whose dialog
 * is thin stays plain.
 *
 * @param {unknown} reg  the registration as printed.
 * @param {Array<{tail: string}> | null | undefined} roster  the Starlink roster (`useFleet().starlink.aircraft`).
 * @returns {boolean}
 */
export function unmatchedTailLinks(reg, roster) {
  if (typeof reg !== 'string' || !reg) return false;
  return nonMainlineAircraftSummary(reg, roster, null) !== null;
}
