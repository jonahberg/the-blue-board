// ═══ THE UNITED EXPRESS SUMMARY'S COUNTS, AS SEARCH BUTTONS ═══
// The Fleet tab's United Express panel counts its fleet by operator ("SkyWest Airlines 259"), by
// type ("E175 253") and on Starlink ("354 Starlink"). A count that summarizes rows is a button that
// sets the filter of the list it summarizes (the links plan, ruling 7). The list's one filter is its
// search box (`filterExpressFleet`), so a chip's button puts its own word in the search, and pressed
// again clears it.
//
// A chip is a button only when that search lists exactly the rows it counts: the search also reads
// the registration, cabin, Wi-Fi and last flight, so a word that appears elsewhere would show more
// rows than the chip says. The "Unknown operator" / "Unknown type" buckets have no word at all (the
// field is empty on those rows), so they stay text. Checked against the live fleet on Nov 12 2026:
// all five operators, all six types and "Starlink" list exactly their counts.
//
// DOM-free; tested in tests/express-fleet-chips.test.js.

import { expressCountRows, filterExpressFleet } from './express-fleet-view.js';

/** A search compared the way `filterExpressFleet` reads it. */
function normalize(search) {
  return String(search ?? '').trim().toLowerCase();
}

/**
 * One count as a search chip.
 *
 * @param {string} label  the chip's printed name, e.g. 'SkyWest Airlines', 'E175', 'Starlink'.
 * @param {number} count  how many entries the chip says carry it.
 * @param {Array<object>} list  the whole Express fleet (`buildExpressFleet` output), not the searched rows.
 * @returns {{label: string, count: number, search: string|null}}  `search` is the word the button
 *   puts in the search box, or null when the chip stays text.
 */
export function expressSearchChip(label, count, list) {
  const exact = normalize(label) !== '' && !/^Unknown /.test(label) && filterExpressFleet(list, label).length === count && count > 0;
  return { label, count, search: exact ? label : null };
}

/**
 * `summarizeExpressFleet()`'s counts (by operator or by type) as search chips, in the summary's order
 * (`expressCountRows`: most aircraft first, the "Unknown …" bucket last).
 *
 * @param {Record<string, number>|null|undefined} counts
 * @param {Array<object>} list  the whole Express fleet.
 * @returns {Array<{label: string, count: number, search: string|null}>}
 */
export function expressSearchChips(counts, list) {
  return /** @type {{label: string, count: number}[]} */ (expressCountRows(counts)).map((row) =>
    expressSearchChip(row.label, row.count, list),
  );
}

/**
 * Whether a chip's search is the one showing.
 *
 * @param {{search: string|null}} chip
 * @param {string} search  the Express search now.
 */
export function isExpressChipPressed(chip, search) {
  return chip.search !== null && normalize(chip.search) === normalize(search);
}

/**
 * The search after a chip is pressed: its word, replacing whatever was typed, or nothing when its
 * word is already the search.
 *
 * @param {{search: string|null}} chip
 * @param {string} search  the Express search now.
 * @returns {string}
 */
export function nextExpressSearch(chip, search) {
  if (chip.search === null) return search;
  return isExpressChipPressed(chip, search) ? '' : chip.search;
}
