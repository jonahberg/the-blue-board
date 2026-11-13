// ═══ LINK GUARD: A NAME IN A ROW THAT IS NOT A LINK ═══
// Every name the dashboard prints that has a home links to it (links everywhere, Nov 12 2026):
// a United flight number to its flight page, a tail to its aircraft dialog, a hub to its Schedule
// board. scripts/ui-audit.mjs reads the rendered tab in a real browser and hands this module what
// it found inside table rows, list items and `[data-link-row]` elements: each run of text, whether
// a link or button is around it, and where it is. This decides which of those runs print a name
// with no link around it.
//
// A name, for this check:
//   - a United flight number with a page (`flightLink`): UA576, UAL347, "UA 576". An operating
//     callsign (SKW5415, UCA5004), a provider suffix (UA526H) and a bare "UA" are not;
//   - a US registration the page itself loaded (`known.tails`), so an N-number that is not one of
//     ours is not a name;
//   - one of the nine hub codes, in capitals, as a whole word. A non-hub airport (LHR, DSM) has no
//     home and stays plain by rule.
// Operators, regional types and fleet families have no home either and are never names here.
//
// DOM-free; tested in tests/link-guard.test.js.

import { flightLink } from './flight-link.js';
import { tailLink } from './tail-link.js';

/**
 * The dashboard tabs the audit checks, by tab id (src/app/tabs.ts). Parts 2 and 3 of "links
 * everywhere" add the rest of the dashboard here; scripts/ui-audit.mjs needs no other change.
 */
export const LINK_GUARD_TABS = Object.freeze(['starlink']);

/**
 * What a run of the check on a tab must have examined before its pass means anything, by kind.
 * A tab not listed here needs at least one name of any kind. The Starlink tab prints all three
 * whenever its schedule feed is up; without it the tab shows the roster alone, every tail inside
 * its expand button, and a pass would say nothing about the board.
 */
export const LINK_GUARD_EXPECT = Object.freeze({ starlink: Object.freeze(['flight', 'tail', 'hub']) });

/**
 * Rows whose names may print without a link: `where` is matched against the row's `where`
 * (`<tab> <viewport> <section> <row>`), and `reason` says why. Empty: on the Starlink tab, every
 * name has its link at every viewport (a fine-pointer-only hub or type is still an `<a>` on a
 * touch screen, so it needs no entry).
 */
export const LINK_GUARD_ALLOW = Object.freeze([]);

/**
 * The payloads a page loads that list tails, by URL. The check knows a tail only when the page
 * loaded it, never from a list kept here.
 */
export const LINK_GUARD_TAIL_SOURCES = Object.freeze([
  /\/api\/starlink-data(?:\?|$)/,
  /\/api\/starlink-mismatches(?:\?|$)/,
  /\/data\/starlink\.json(?:\?|$)/,
]);

// One candidate name: a United number written with a space or hyphen ("UA 576"), a hyphenated
// registration ("N-613UX"), or any run of letters and digits. Whole words only.
const NAME_RE = /(?<![A-Za-z0-9])(?:UAL?[ -]\d{1,4}[A-Za-z]?|N-[1-9][0-9A-Z]{1,4}|[A-Za-z0-9]+)(?![A-Za-z0-9])/g;

/** @typedef {'flight' | 'tail' | 'hub'} NameKind */
/** @typedef {{ text: string, linked: boolean, where: string }} TextRun */
/** @typedef {{ hubs: string[], tails: Set<string> }} KnownNames */
/** @typedef {{ where: RegExp, reason: string }} AllowEntry */

/**
 * @param {string} word
 * @param {KnownNames} known
 * @returns {NameKind | null}
 */
function kindOf(word, known) {
  if (flightLink(word)) return 'flight';
  const tail = tailLink(word);
  if (tail && known.tails.has(tail.reg)) return 'tail';
  if (known.hubs.includes(word)) return 'hub';
  return null;
}

/**
 * Every name in the runs of text, linked or not: what the check examined.
 *
 * @param {TextRun[]} rows
 * @param {KnownNames} known
 * @returns {Array<{ text: string, kind: NameKind, where: string, linked: boolean }>}
 */
export function findNames(rows, known) {
  const names = [];
  for (const { text, linked, where } of rows) {
    for (const [word] of String(text ?? '').matchAll(NAME_RE)) {
      const kind = kindOf(word, known);
      if (kind) names.push({ text: word, kind, where, linked: Boolean(linked) });
    }
  }
  return names;
}

/**
 * The names printed with no link or button around them, less the rows the allowlist covers.
 * An allowlist entry without a RegExp or without a reason throws, whether or not it matches.
 *
 * @param {TextRun[]} rows
 * @param {KnownNames} known
 * @param {AllowEntry[]} allow
 * @returns {Array<{ text: string, kind: NameKind, where: string }>}
 */
export function findUnlinkedNames(rows, known, allow) {
  allow.forEach((entry, index) => {
    if (!(entry?.where instanceof RegExp)) {
      throw new Error(`link-guard allowlist entry ${index}: \`where\` must be a RegExp`);
    }
    if (typeof entry.reason !== 'string' || entry.reason.trim() === '') {
      throw new Error(`link-guard allowlist entry ${index} (${entry.where}): a reason is required`);
    }
  });
  // A `g` or `y` pattern keeps `lastIndex` between `test` calls; a fresh copy without them does not.
  const patterns = allow.map(({ where }) => new RegExp(where.source, where.flags.replace(/[gy]/g, '')));
  return findNames(rows, known)
    .filter((name) => !name.linked && !patterns.some((re) => re.test(name.where)))
    .map(({ text, kind, where }) => ({ text, kind, where }));
}

/**
 * The US registrations in a payload a page loaded: every string under a `tail` key, and the keys
 * of a `flightsByTail` object, in canonical form (`tailLink`).
 *
 * @param {unknown} payload  parsed JSON.
 * @returns {string[]}
 */
export function tailsInPayload(payload) {
  const tails = new Set();
  const add = (value) => {
    const link = tailLink(value);
    if (link) tails.add(link.reg);
  };
  (function walk(value) {
    if (Array.isArray(value)) {
      value.forEach(walk);
    } else if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) {
        if (key === 'tail' && typeof child === 'string') add(child);
        else if (key === 'flightsByTail' && child && typeof child === 'object' && !Array.isArray(child)) {
          Object.keys(child).forEach(add);
        } else walk(child);
      }
    }
  })(payload);
  return [...tails];
}

/**
 * Why a run of the check on one tab at one viewport cannot count as a pass: it examined no rows,
 * the page had loaded no tails to know, or the tab showed none of a kind it must
 * (`LINK_GUARD_EXPECT`). Empty when the run means something.
 *
 * @param {string} tab
 * @param {{ rows: number, names: Record<NameKind, number>, knownTails: number }} seen
 * @returns {string[]}
 */
export function coverageGaps(tab, { rows, names, knownTails }) {
  const gaps = [];
  if (rows === 0) gaps.push('no rows examined (is the tab empty, or its data not loaded?)');
  if (knownTails === 0) gaps.push('no known tails: the page loaded none of LINK_GUARD_TAIL_SOURCES to check tails against');
  const expected = LINK_GUARD_EXPECT[tab];
  if (expected) {
    for (const kind of expected) {
      if (!names[kind]) gaps.push(`no ${kind} names examined; this tab must show some`);
    }
  } else if (!Object.values(names).some(Boolean)) {
    gaps.push('no names examined');
  }
  return gaps;
}
