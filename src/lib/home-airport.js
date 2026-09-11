// ═══ HOME AIRPORT ═══
// The viewer's home hub: drives the initial map centre/zoom, the Schedule tab's
// default hub, the 🏠 marker in the hub-health bar and the tracker briefing.
//
// Extracted verbatim from src/dashboard/main.js (:298-309 read/write, :7577-7584 the
// header-button cycle). Storage is injected so the module stays DOM-free.
//
// No try/catch here on purpose: main.js has never guarded these two calls, and
// adding a guard would change behaviour in private-mode browsers.

const HOME_AIRPORT_KEY = 'bb_home_airport';

/**
 * The order the header 🏠 button cycles through. The leading empty string is the
 * "no preference" slot, so a viewer can cycle back to no home hub.
 * @type {string[]}
 */
export const HOME_HUB_CYCLE = ['','ORD','DEN','IAH','EWR','SFO','IAD','LAX','NRT','GUM'];

/**
 * @param {{getItem: (k: string) => string|null}} storage
 * @returns {string} the stored IATA code, or '' when unset.
 */
export function readHomeAirport(storage) {
  return storage.getItem(HOME_AIRPORT_KEY) || '';
}

/**
 * Persist the home hub. An empty/missing code REMOVES the key rather than storing
 * an empty string, so "no preference" leaves no trace.
 *
 * @param {{setItem: (k: string, v: string) => void, removeItem: (k: string) => void}} storage
 * @param {string|null|undefined} code  IATA code, or falsy to clear.
 */
export function writeHomeAirport(storage, code) {
  if (code) storage.setItem(HOME_AIRPORT_KEY, code);
  else storage.removeItem(HOME_AIRPORT_KEY);
}

/**
 * Next hub in the header button's cycle. A code that is not in the cycle (or no
 * code at all) lands on the "no preference" slot.
 *
 * @param {string|undefined} current
 * @returns {string}
 */
export function nextHomeAirport(current) {
  const idx = HOME_HUB_CYCLE.indexOf(current);
  return HOME_HUB_CYCLE[(idx + 1) % HOME_HUB_CYCLE.length];
}
