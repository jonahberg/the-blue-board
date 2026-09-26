// ═══ UNITED HUB TERMINALS ═══
// Fallback terminal letters for the schedule board's Term/Gate column and the My
// Flights gate grid, used when the schedule feed doesn't publish a terminal.
//
// Extracted verbatim from src/dashboard/main.js (:384-400).

import { INTL_AIRPORTS } from './airport-metadata.js';

// Known United Airlines terminals at each hub (fallback when API doesn't provide terminal data)
/** @type {Record<string, {domestic: string, international: string}>} */
export const UNITED_HUB_TERMINALS = {
  ORD:{domestic:'1',international:'1'},       // Terminal 1 (B & C); Express uses T2
  DEN:{domestic:'B',international:'B'},       // Concourse B
  EWR:{domestic:'C',international:'C'},       // Terminal C (primary)
  IAH:{domestic:'C',international:'E'},       // Terminal C (domestic), Terminal E (international)
  SFO:{domestic:'3',international:'G'},       // Terminal 3 (domestic), International Terminal G
  LAX:{domestic:'7',international:'7'},       // Terminals 7 & 8
  IAD:{domestic:'C',international:'D'},       // Concourse C (domestic), Concourse D (international)
  NRT:{domestic:'1',international:'1'},       // Terminal 1
  GUM:{domestic:'1',international:'1'},       // Single terminal
};

/**
 * United's terminal at `iata` for a given city pair.
 *
 * A route counts as international when EITHER end is in INTL_AIRPORTS, so an
 * arrival from Frankfurt lands at the international concourse even though the hub
 * itself is domestic.
 *
 * @param {string|undefined} iata  the hub whose terminal we want.
 * @param {string|undefined} origIata  route origin.
 * @param {string|undefined} destIata  route destination.
 * @returns {string} terminal letter/number, or '' when United does not hub there.
 */
export function getUnitedTerminal(iata, origIata, destIata) {
  const hub = UNITED_HUB_TERMINALS[iata];
  if (!hub) return '';
  const isIntl = INTL_AIRPORTS.has(origIata) || INTL_AIRPORTS.has(destIata);
  return isIntl ? hub.international : hub.domestic;
}
