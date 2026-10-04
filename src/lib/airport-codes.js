// ═══ AIRPORT NAME → IATA CODE ═══
// Codes on every route, not cities (live audit Oct 4 2026): AeroDataBox sends a handful of rows with
// an airport name and no code, and the board printed "San Francisco → DEN" (UA599) beside a column of
// "SFO → DEN". When the name is EXACTLY one city of the airport table (src/lib/airports.js
// IATA_CITIES) and no other airport shares it, that airport's code is the answer; anything fuzzier
// ("Washington" — Dulles or Reagan?) stays a name. Used by the AeroDataBox normalizer (so new
// snapshots carry the code) and by the board's route cell (so old snapshots read right too).

import { IATA_CITIES } from './airports.js';

// City names other airports United flies to also answer to, so the table's one airport for the name
// is not proof: Portland is PDX or PWM, Panama City is PTY or ECP, Santiago is SCL or STI,
// Fayetteville is XNA or FAY, Rochester is ROC or RST, Columbus is CMH or CSG, and so on.
const AMBIGUOUS_CITY_NAMES = new Set([
  'portland', 'panama city', 'santiago', 'fayetteville', 'rochester', 'columbus', 'charleston',
  'jacksonville', 'albany', 'richmond', 'birmingham', 'manchester', 'springfield', 'wilmington',
  'greenville', 'burlington', 'lafayette', 'ontario', 'kansas city', 'melbourne', 'sydney', 'dublin',
  'san josé', 'san jose', 'cambridge', 'london',
]);

const NAME_TO_IATA = (() => {
  const counts = new Map();
  for (const city of Object.values(IATA_CITIES)) {
    const key = city.toLowerCase();
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const map = new Map();
  for (const [iata, city] of Object.entries(IATA_CITIES)) {
    const key = city.toLowerCase();
    if (counts.get(key) === 1 && !AMBIGUOUS_CITY_NAMES.has(key)) map.set(key, iata);
  }
  return map;
})();

/** Provider placeholders that are not a name at all. */
const NOT_A_NAME = new Set(['unknown', 'n/a', 'na', '-', '—', '?']);

/**
 * The IATA code for an airport NAME, when the name is unambiguous.
 *
 * Tries the name as given, then without the "International" / "Airport" words the board strips.
 *
 * @param {string|null|undefined} name
 * @returns {string} the code, or '' when the name does not name exactly one airport.
 */
export function iataForAirportName(name) {
  const raw = String(name || '').trim();
  if (!raw) return '';
  const candidates = [raw, raw.replace(/ Airport| International/g, '').trim()];
  for (const candidate of candidates) {
    const hit = NAME_TO_IATA.get(candidate.toLowerCase());
    if (hit) return hit;
  }
  return '';
}

/**
 * Is this "name" a provider placeholder ("Unknown") rather than an airport?
 *
 * @param {string|null|undefined} name
 * @returns {boolean}
 */
export function isPlaceholderAirportName(name) {
  return NOT_A_NAME.has(String(name || '').trim().toLowerCase());
}
