// ═══ SPECIAL LIVERY LOOKUP ═══
// Turns the curated, sourced list in src/data/special-liveries.js into the lookups the flight
// sheet, fleet table, schedule board and live sidebar render from. DOM-free and pure.
//
// This is a different thing from the ⭐ index in special-aircraft.js: that one parses the fleet
// site's free-text "special" column (named airframes, the 100-year sticker); this one is a
// hand-verified list of paint schemes, each with sources. A tail can be in both — N76021 is
// the named "Larry Kellner" AND wears Star Alliance colours — so the two never merge.

import { SPECIAL_LIVERIES } from '../data/special-liveries.js';

/** @typedef {import('../data/special-liveries.js').SpecialLivery} SpecialLivery */

/**
 * The registration as the fleet database and the live feed key it: no whitespace or dashes,
 * uppercase. The feed occasionally carries "N-12345"-style dashes (buildSpecialRows strips
 * them for the same reason).
 *
 * @param {unknown} reg
 * @returns {string} '' for anything that is not a usable registration.
 */
export function normalizeTail(reg) {
  if (reg == null) return '';
  return String(reg).replace(/[\s-]+/g, '').toUpperCase();
}

/**
 * Index a livery list by normalised tail. Later duplicates never overwrite the first entry,
 * so a stray duplicate in the data cannot silently change what a tail shows.
 *
 * @param {SpecialLivery[]} list
 * @returns {Map<string, SpecialLivery>}
 */
export function indexLiveries(list) {
  /** @type {Map<string, SpecialLivery>} */
  const index = new Map();
  for (const entry of list || []) {
    const key = normalizeTail(entry?.tail);
    if (key && !index.has(key)) index.set(key, entry);
  }
  return index;
}

const INDEX = indexLiveries(SPECIAL_LIVERIES);

/**
 * The special livery a registration is wearing, or null.
 *
 * @param {unknown} reg  any spelling: 'N75435', ' n75435 ', 'N-75435'.
 * @param {Map<string, SpecialLivery>} [index]  for tests; defaults to the curated list.
 * @returns {SpecialLivery|null}
 */
export function liveryForTail(reg, index = INDEX) {
  const key = normalizeTail(reg);
  if (!key) return null;
  return index.get(key) ?? null;
}

/**
 * The compact label a table cell or chip shows ("Stars & Stripes"); falls back to the name.
 *
 * @param {{name: string, short?: string}|null|undefined} livery
 * @returns {string}
 */
export function liveryShortName(livery) {
  if (!livery) return '';
  return livery.short || livery.name;
}

/**
 * The words a screen reader hears and a tooltip leads with: "Special livery: Star Alliance".
 *
 * @param {{name: string}|null|undefined} livery
 * @returns {string}
 */
export function liveryLabel(livery) {
  if (!livery) return '';
  return `Special livery: ${livery.name}`;
}

/**
 * Every curated livery, ordered for browsing: grouped by livery name (alphabetical), tails
 * alphabetical inside a group, so the eleven Star Alliance jets sit together.
 *
 * @param {SpecialLivery[]} [list]
 * @returns {SpecialLivery[]}
 */
export function listSpecialLiveries(list = SPECIAL_LIVERIES) {
  return [...list].sort(
    (a, b) => a.name.localeCompare(b.name) || normalizeTail(a.tail).localeCompare(normalizeTail(b.tail)),
  );
}

/** How many tails carry a curated livery. */
export const SPECIAL_LIVERY_COUNT = INDEX.size;
