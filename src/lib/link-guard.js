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
// A self-link is plain text by rule (the links plan, ruling 1): ORD in the rows of ORD's own
// Schedule board does nothing when clicked, so it is not a link. The caller passes the view's own
// hub as `self`, and a plain hub code equal to it is not a violation. A view marks the region it
// is about with `data-link-self="ORD"` (the Schedule board does); the audit hands each run its
// region's hub, and `findUnlinkedNamesByRegion` checks each region with its own.
//
// A name a view prints plain on purpose, in a row that also holds names that must link, sits in
// an element of its own marked `data-link-row="<what it is>"` (a Fleet row's free-text status
// note). The audit reads that element as its own row and names it in `where`
// (`td[data-link-row=status-note]`), so an allowlist entry can excuse exactly it and never the
// tail beside it in the same table row.
//
// DOM-free; tested in tests/link-guard.test.js.

import { flightLink } from './flight-link.js';
import { tailLink } from './tail-link.js';

/**
 * The dashboard tabs the audit checks, by tab id (src/app/tabs.ts): every tab whose rows print
 * names. What the audit reads on each is the tab's panel as the visitor first sees it (the Fleet
 * tab's All Aircraft list, not its other sub-views), except Live, whose rows exist only once a
 * search is typed: the audit types one (scripts/ui-audit.mjs `LINK_GUARD_SEARCH`), in the sidebar
 * at `lg`+ and in the Filters sheet below it, and reads the rows it lists.
 *
 * Left out:
 *  - My Flights: its rows are the reader's watched flights, and watching one in the audit would
 *    poll /api/flight, which nothing may script. With none it prints no rows.
 *  - Sources: no table or list rows, and no flight, tail or hub in what it prints.
 */
export const LINK_GUARD_TABS = Object.freeze(['live', 'schedule', 'fleet', 'starlink', 'weather', 'stats']);

/**
 * What a run of the check on a tab must have examined before its pass means anything, by kind.
 * A tab not listed here needs at least one name of any kind.
 *  - starlink: all three whenever its schedule feed is up; without it the tab shows the roster
 *    alone, every tail inside its expand button, and a pass would say nothing about the board.
 *  - live: the search rows' flight numbers and their hub ends (the hub traffic rows are buttons
 *    that print hub codes too). Their tails are checked whenever the page knows them.
 *  - schedule: flight numbers and the other hub of each route. Tails print only once the feed
 *    names the aircraft, an hour or two before departure, so they are checked when present.
 *  - fleet: the All Aircraft list's tails.
 *  - weather: the hub cards' codes, and the NAS items' hub tags when there are programs.
 *  - stats: the hub matrix's headers and the top routes' hub ends.
 */
export const LINK_GUARD_EXPECT = Object.freeze({
  starlink: Object.freeze(['flight', 'tail', 'hub']),
  live: Object.freeze(['flight', 'hub']),
  schedule: Object.freeze(['flight', 'hub']),
  fleet: Object.freeze(['tail']),
  weather: Object.freeze(['hub']),
  stats: Object.freeze(['hub']),
});

/**
 * Rows whose names may print without a link: `where` is matched against the row's `where`
 * (`<tab> <viewport> <section> <row>`), and `reason` says why. Each entry names one element a view
 * marked for it, never a whole table row or list item that also holds names that must link. A
 * name with no home is not a name here at all (a non-hub airport, an operating callsign such as
 * SKW5575, a G7 number, a ★ name), so it needs no entry; neither does a hub, tail or type link
 * that takes no taps on a touch screen, which is still an `<a>`.
 */
export const LINK_GUARD_ALLOW = Object.freeze([
  Object.freeze({
    where: /^fleet \S+ .*td\[data-link-row=status-note\]$/,
    reason:
      "the fleet site's free-text status note in a Fleet row (\"SFO Stored 10/30/26\", \"IAH Maint 10/12/26\"): a hub code there is where the aircraft sits, not a name with a home; the row's tail and type are checked as usual",
  }),
  Object.freeze({
    where: /^fleet \S+ .*span\[data-link-row=health-category\]$/,
    reason:
      'a Fleet Health category label ("Future GUM"): a status category, not the hub; its bar and count sit beside it',
  }),
  Object.freeze({
    where: /^weather \S+ #nas-section li$/,
    reason:
      "a NAS item's title, badges and detail are the FAA's own words (\"EWR ground stop/delay program possible\"); the item's hub tags are links in a row of their own ([data-link-row]), which stays checked",
  }),
]);

/**
 * The payloads a page loads that list tails, by URL. The check knows a tail only when the page
 * loaded it, never from a list kept here: the Starlink roster and the fleet database
 * (`/data/fleet.json`, every mainline tail). An Express tail the Starlink roster does not list is
 * not known, so it is not checked.
 */
export const LINK_GUARD_TAIL_SOURCES = Object.freeze([
  /\/api\/starlink-data(?:\?|$)/,
  /\/api\/starlink-mismatches(?:\?|$)/,
  /\/data\/starlink\.json(?:\?|$)/,
  /\/data\/fleet\.json(?:\?|$)/,
]);

// One candidate name: a United number written with a space or hyphen ("UA 576"), a hyphenated
// registration ("N-613UX"), or any run of letters and digits. Whole words only.
const NAME_RE = /(?<![A-Za-z0-9])(?:UAL?[ -]\d{1,4}[A-Za-z]?|N-[1-9][0-9A-Z]{1,4}|[A-Za-z0-9]+)(?![A-Za-z0-9])/g;

/** @typedef {'flight' | 'tail' | 'hub'} NameKind */
/**
 * One run of text in a row. `self`: the hub of the region it sits in (`data-link-self`), when the
 * view marked one.
 * @typedef {{ text: string, linked: boolean, where: string, self?: string | null }} TextRun
 */
/** @typedef {{ hubs: string[], tails: Set<string> }} KnownNames */
/** @typedef {{ where: RegExp, reason: string }} AllowEntry */
/**
 * What the view being checked is itself about: the hub of a Schedule board. A hub code equal to it
 * prints plain by rule (a self-link), so it is not a violation. No `type` yet: the guard reads no
 * type names, and a field it ignored would excuse nothing when it starts to.
 * @typedef {{ hub?: string | null }} SelfNames
 */

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
 * The names printed with no link or button around them, less the rows the allowlist covers and
 * less a plain hub code that is the view's own (`self.hub`, a self-link by rule).
 * An allowlist entry without a RegExp or without a reason throws, whether or not it matches.
 *
 * @param {TextRun[]} rows
 * @param {KnownNames} known
 * @param {AllowEntry[]} allow
 * @param {SelfNames} [self]  the view's own hub, when it has one.
 * @returns {Array<{ text: string, kind: NameKind, where: string }>}
 */
export function findUnlinkedNames(rows, known, allow, self = {}) {
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
  const selfHub = typeof self?.hub === 'string' ? self.hub.trim().toUpperCase() : '';
  return findNames(rows, known)
    .filter((name) => !name.linked && !patterns.some((re) => re.test(name.where)))
    .filter((name) => !(selfHub && name.kind === 'hub' && name.text === selfHub))
    .map(({ text, kind, where }) => ({ text, kind, where }));
}

/**
 * Each region's names printed with no link (`findUnlinkedNames`), each region checked once with
 * its own hub as `self`: runs that carry the same `self` are one region, and runs with none are
 * checked with no self. Regions in the order their first run came.
 *
 * @param {TextRun[]} rows
 * @param {KnownNames} known
 * @param {AllowEntry[]} allow
 * @returns {Array<{ text: string, kind: NameKind, where: string }>}
 */
export function findUnlinkedNamesByRegion(rows, known, allow) {
  // The allowlist is checked even when there is nothing to read.
  if (!rows.length) return findUnlinkedNames([], known, allow);
  /** @type {Map<string, TextRun[]>} */
  const regions = new Map();
  for (const run of rows) {
    const hub = typeof run.self === 'string' ? run.self.trim().toUpperCase() : '';
    if (!regions.has(hub)) regions.set(hub, []);
    regions.get(hub)?.push(run);
  }
  return [...regions].flatMap(([hub, runs]) => findUnlinkedNames(runs, known, allow, hub ? { hub } : {}));
}

/**
 * The US registrations in a payload a page loaded: every string under a `tail` key or, in the
 * fleet database, an `r` key, and the keys of a `flightsByTail` object, in canonical form
 * (`tailLink`).
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
        if ((key === 'tail' || key === 'r') && typeof child === 'string') add(child);
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
