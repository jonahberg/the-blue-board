// ═══ FLIGHT NUMBER → FLIGHT PAGE ═══
// Every flight number the dashboard prints in link colour is a real link to its page
// (/flight/UA576, src/lib/flight-page.js). The owner clicked the blue "UA576" on the Schedule board
// expecting that page and nothing happened (Nov 2026): it was a plain cell painted like a link.
//
// This decides, for the text a view is about to print, whether it IS a United flight number with a
// page and what the address is. Anything else prints as plain body text, never in link colour.
//
// Stricter than `parseFlightIdent`, which reads what a person types into an address bar:
//   - a United prefix is required. A bare "5123" printed on a board does not say whose flight it
//     is, so it is not linked (parseFlightIdent would read it as UA5123).
//   - the provider's letter suffix ("UA526H") is not a flight page; the board's display layer
//     already prints "UA526" (schedule-row-model.js displayFlightIdent), and that is what links.
//   - an operating callsign (SKW5123, RPA3508, OO4737) is not a United marketing number, and
//     `flightLink` alone never links one.
// "UAL576" (the ICAO callsign of mainline UA576) links to /flight/UA576.
//
// The one exception is a United Express number on a row the Starlink feed marks as United
// (`airline: 'UA'`). There `unitedNumber` reads a tested operating prefix (SKW OO RPA YX GJS G7 ASH
// YV) as the United number, SKW5415 → UA5415, checked against flight_history (EXPRESS_NUMBER_CHECK).
// The caller prints that number and links it through `flightLink`. It does not apply to a row
// without `airline: 'UA'`, to an untested prefix (UCA5004, C55004), to a provider suffix
// (SKW5415A), or anywhere outside the Starlink feed's rows: the Live ticker and map callsigns stay
// as printed and plain.
//
// DOM-free; tested in tests/flight-link.test.js.

import { flightPagePath, parseFlightIdent } from './flight-page.js';

/** The Express operating prefixes checked against United's own numbers (ICAO and IATA forms). */
export const EXPRESS_OPERATING_PREFIXES = Object.freeze(['SKW', 'OO', 'RPA', 'YX', 'GJS', 'G7', 'ASH', 'YV']);

// flight_history, Nov 12: 83 rows joined on route + time (82 matched, all same number) + 42 YV/G7/YX on number + route (42/42).
export const EXPRESS_NUMBER_CHECK = Object.freeze({ date: '2026-11-12', sampled: 125, matched: 124, sameNumber: 124 });

/** A tested prefix, then 1-4 digits and nothing else. Longest prefix first, so G74612 is G7 + 4612. */
const EXPRESS_NUMBER_RE = new RegExp(
  `^(${[...EXPRESS_OPERATING_PREFIXES].sort((a, b) => b.length - a.length).join('|')})(\\d{1,4})$`,
);

/** A United prefix, then the number: UA576, UAL576, UA 576, ua-576. */
const UNITED_PREFIX_RE = /^(?:UAL|UA)[\s-]*\d/i;

/**
 * The flight page for a printed flight number, or null when it has none.
 *
 * @param {unknown} printed  the flight number as the view prints it.
 * @returns {{ident: string, href: string} | null}
 */
export function flightLink(printed) {
  if (typeof printed !== 'string') return null;
  const text = printed.trim();
  if (!UNITED_PREFIX_RE.test(text)) return null;
  const parsed = parseFlightIdent(text);
  if (!parsed) return null;
  return { ident: parsed.ident, href: flightPagePath(parsed.ident) };
}

/**
 * The United number behind an Express operating number, on a row the Starlink feed marks as
 * United; null anywhere else. Apply it before `flightLink`, which never reads a callsign itself.
 *
 * @param {unknown} printed  the flight number as the feed sent it, e.g. 'SKW5415'.
 * @param {{airline?: string} | null} [row]  the feed row it came from.
 * @returns {string | null}  the canonical ident, e.g. 'UA5415' (leading zeros dropped).
 */
export function unitedNumber(printed, row) {
  if (typeof printed !== 'string' || row?.airline !== 'UA') return null;
  const match = EXPRESS_NUMBER_RE.exec(printed.trim().toUpperCase());
  if (!match) return null;
  return parseFlightIdent(`UA${match[2]}`)?.ident ?? null;
}
