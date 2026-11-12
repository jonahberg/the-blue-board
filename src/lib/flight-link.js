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
//   - an operating callsign (SKW5123, RPA3508, OO4737) is not a United marketing number and has no
//     page: the Starlink departures board prints those.
// "UAL576" (the ICAO callsign of mainline UA576) links to /flight/UA576.
//
// DOM-free; tested in tests/flight-link.test.js.

import { flightPagePath, parseFlightIdent } from './flight-page.js';

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
