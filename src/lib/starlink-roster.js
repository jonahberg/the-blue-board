// ═══ STARLINK ROSTER / BOARD / LEDGER TEXT HELPERS ═══
// The rest of the Starlink tab's non-visual logic: the roster's filter + sort predicate, the
// "next flight" pick, the departures board's row labels, and the freshness / industry-strip
// maths. Extracted from src/dashboard/main.js (renderSlTable, renderSlExpand, renderSlBoardRow,
// renderSlIndustry, renderSlHero's source line) so the TSX is layout only.
//
// The chart lives next door in starlink-chart.js; the recency badge, the integrity tripwire,
// the hub-local time format and the board cap policy live in starlink-view.js.

import { flightLink, unitedNumber } from './flight-link.js';
import { starlinkShareCaption } from './fleet-utils.js';
import { isRecentlyFound } from './starlink-view.js';

/**
 * Filter the Starlink roster.
 *
 * Search matches the TAIL only — the shipped control is labelled "Search tail...", and
 * widening it to type/operator would silently change what an empty result means.
 *
 * @param {Array<{tail:string,fleet?:string,type?:string,operator?:string,dateFound?:string}>} aircraft
 * @param {{search?:string, fleet?:string, type?:string, operator?:string, newOnly?:boolean}} filters
 * @param {number} [now] epoch ms, for the "new this week" predicate.
 */
export function filterRoster(aircraft, filters = {}, now = Date.now()) {
  const search = String(filters.search || '').trim().toUpperCase();
  const { fleet = '', type = '', operator = '', newOnly = false } = filters;
  return (aircraft || []).filter((s) => {
    if (!s) return false;
    if (search && !String(s.tail || '').toUpperCase().includes(search)) return false;
    if (fleet && s.fleet !== fleet) return false;
    if (type && s.type !== type) return false;
    if (operator && s.operator !== operator) return false;
    if (newOnly && !isRecentlyFound(s.dateFound, now)) return false;
    return true;
  });
}

/**
 * Sort the roster by one of its four string columns. Case-insensitive, locale-aware, and a
 * COPY — the caller's array is a memo input and must not be reordered underneath it.
 *
 * @param {Array<Object>} rows
 * @param {'tail'|'fleet'|'type'|'operator'} key
 * @param {boolean} asc
 */
export function sortRoster(rows, key, asc = true) {
  return (rows || []).slice().sort((a, b) => {
    const va = String((a && a[key]) || '').toLowerCase();
    const vb = String((b && b[key]) || '').toLowerCase();
    return asc ? va.localeCompare(vb) : vb.localeCompare(va);
  });
}

/**
 * The type and operator dropdown options, taken from the data rather than a fixed list —
 * upstream adds regional operators without warning.
 *
 * @returns {{types: string[], operators: string[]}} sorted, de-duplicated, blanks dropped.
 */
export function rosterOptions(aircraft) {
  const types = new Set();
  const operators = new Set();
  for (const s of aircraft || []) {
    if (s && s.type) types.add(s.type);
    if (s && s.operator) operators.add(s.operator);
  }
  return {
    types: [...types].sort(),
    operators: [...operators].sort(),
  };
}

/** @typedef {{search: string, fleet: string, type: string, operator: string, newOnly: boolean}} RosterFilters */

/**
 * The roster's filters at rest: what the controls show before anyone touches them.
 * @type {Readonly<RosterFilters>}
 */
export const ROSTER_DEFAULT_FILTERS = Object.freeze({ search: '', fleet: '', type: '', operator: '', newOnly: false });

/**
 * The roster's filters after one of the hero's buttons: exactly what the button names, with every
 * other filter back at rest (Nov 12 2026). Setting only the named filter could land on "No
 * aircraft match your filters" behind a type, operator or search left over from before.
 *
 * @param {'Mainline'|'Express'|'new'} target  a bar's fleet, or the "+N NEW THIS WEEK" chip.
 * @returns {RosterFilters}
 */
export function rosterFiltersShowing(target) {
  if (target === 'new') return { ...ROSTER_DEFAULT_FILTERS, newOnly: true };
  return { ...ROSTER_DEFAULT_FILTERS, fleet: target === 'Mainline' || target === 'Express' ? target : '' };
}

/**
 * What the Starlink tab prints for a flight number (Nov 12 2026).
 *
 * One printed form for every United number on the tab: where the number has a flight page, the tab
 * prints that page's ident, so the feed's mainline "UAL347" reads "UA347" and an Express leg the
 * feed marks United ("SKW5415" with `airline: 'UA'`, `unitedNumber`) reads "UA5415". A number with
 * no page prints exactly what the feed sent ("SKW5415" on a row not marked United, "UCA5004").
 *
 * The label is the one decision: `FlightLink` links what it is given when `flightLink` reads it,
 * and a label is either a page's ident (which `flightLink` reads as itself) or a number it rejected.
 *
 * @param {unknown} printed  the number as the feed sent it.
 * @param {{airline?: string} | null} [row]  the feed row it came from.
 * @returns {string}
 */
export function starlinkFlightLabel(printed, row = null) {
  const text = typeof printed === 'string' ? printed : '';
  return flightLink(unitedNumber(text, row) ?? text)?.ident ?? text;
}

/**
 * The live feed's rows are United's. The dashboard's live feed is `/api/fr24-feed?airline=UAL`,
 * which carries only United flights: FR24's `airline=UAL` rows, plus the operator rows whose
 * flight number is United's (`mergeUnitedFeed`, src/lib/united-feed.js); any other airline is a
 * separate request no dashboard view makes. So a number on it is read as on a Starlink row marked
 * United.
 */
const LIVE_FEED_ROW = Object.freeze({ airline: 'UA' });

/**
 * The number the departures board's "inbound on …" reads for the flight the aircraft is flying
 * now: the live feed's `flightIATA`, else its callsign (`buildDeparturesBoard` stores it as
 * `inbound.flight`).
 *
 * The feed is United-only (`LIVE_FEED_ROW`), so an Express operator number FR24 prints as the
 * flight number reads as its United number: `flightIATA` "YX3568" reads "UA3568", as "UA4190"
 * beside it does (Nov 12 2026 preview). Only `flightIATA` is read that way. A callsign is the
 * operator's own radio call (RPA3568, SKW5123), and nothing has checked that its digits are the
 * United number (`EXPRESS_NUMBER_CHECK` covered the Starlink feed's flight numbers), so a callsign
 * fallback stays exactly as sent; a mainline UAL callsign is United's own number (UAL347 → UA347)
 * and `starlinkInboundLabel` reads it so.
 *
 * @param {{flightIATA?: unknown, callsign?: unknown} | null | undefined} live  the live feed's flight.
 * @returns {string}
 */
export function starlinkInboundNumber(live) {
  const iata = typeof live?.flightIATA === 'string' ? live.flightIATA.trim() : '';
  if (iata) return starlinkFlightLabel(iata, LIVE_FEED_ROW);
  return typeof live?.callsign === 'string' ? live.callsign.trim() : '';
}

/**
 * What the departures board prints for its "inbound on …" number (`inbound.flight`, chosen by
 * `starlinkInboundNumber`): a United number as its page's ident ("UAL347" reads "UA347"),
 * anything else exactly as given. It reads no operator prefix itself: that reading belongs to the
 * feed's `flightIATA` alone, and is done where that field is known.
 *
 * @param {unknown} printed  the inbound leg's number, `inbound.flight`.
 * @returns {string}
 */
export function starlinkInboundLabel(printed) {
  return starlinkFlightLabel(printed);
}

/** 30 minutes: a flight that has just pushed back is still "the next one" on this board. */
export const DEPARTURE_GRACE_SEC = 1800;

/**
 * The row's "Next Flight": the first departure still ahead of us (with the grace window),
 * falling back to the LAST known flight so a tail whose feed has run out still shows what it
 * last did rather than an em-dash.
 *
 * @param {Array<{departure_ts?:number}>} flights chronological, as upstream serves them
 * @param {number} nowSec
 */
export function nextFlight(flights, nowSec) {
  if (!Array.isArray(flights) || flights.length === 0) return null;
  return (
    flights.find((f) => (Number(f && f.departure_ts) || 0) >= nowSec - DEPARTURE_GRACE_SEC) ||
    flights[flights.length - 1]
  );
}

/** Up to `limit` departures still ahead of us — the expansion's flight timeline. */
export function upcomingFlights(flights, nowSec, limit = 5) {
  if (!Array.isArray(flights)) return [];
  return flights
    .filter((f) => (Number(f && f.departure_ts) || 0) >= nowSec - DEPARTURE_GRACE_SEC)
    .slice(0, limit);
}

/**
 * Carrier label for a board row. Upstream's operator strings carry the DOT certificate's
 * " dba United Express" tail, which is noise three times per row.
 */
export function operatorLabel(operator) {
  return String(operator || '').replace(/\s*dba\b.*$/i, '').trim() || 'United';
}

/** '12m ago' / '+45m' / '+3h 20m' — how far from now a departure sits. */
export function relativeDeparture(deltaSec) {
  const mins = Math.round(deltaSec / 60);
  if (mins < 0) return `${Math.abs(mins)}m ago`;
  if (mins < 60) return `+${mins}m`;
  const h = Math.floor(mins / 60);
  const mm = mins % 60;
  return `+${h}h${mm ? ` ${mm}m` : ''}`;
}

/**
 * '12m ago' / '4h ago' / '3d ago' for a payload timestamp, or null when there isn't one.
 * The caller supplies the sentence around it — the hero says "Updated …", the departures
 * board says "updated …", and neither may imply live ATC.
 */
export function freshnessAgo(lastUpdated, now = Date.now()) {
  const ms = lastUpdated ? Date.parse(lastUpdated) : NaN;
  if (isNaN(ms)) return null;
  const mins = Math.round((now - ms) / 60000);
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
}

// ── Starlink schedule freshness (Nov 2026) ──
// The departures board and the source line used to say "updated 16d ago" from the tracker's own
// `lastUpdated`, a field frozen at 2026-10-27T05:05Z while the tracker kept changing — above rows
// whose departure times count down live and whose Airborne marks come from the live feed. What the
// rows are actually as old as is the schedule: OUR sync's `syncedAt` (served from a Supabase
// snapshot, ~22 h old on Nov 11 2026 while the tracker returned 521). `servedFrom` is
// /api/starlink-data's source word; a "-stale" source means the tracker did not answer.

/** A schedule synced longer ago than this, or served from a "-stale" source, is from an offline tracker. */
export const STARLINK_SCHEDULE_STALE_MS = 6 * 60 * 60 * 1000;

/**
 * Whether the served schedule is stale, and how old it is in words.
 * @param {{syncedAt?: string|null, servedFrom?: string|null, nowMs?: number}} input
 * @returns {{ago: string|null, stale: boolean}}
 */
export function starlinkScheduleAge({ syncedAt, servedFrom, nowMs = Date.now() } = {}) {
  const ago = freshnessAgo(syncedAt, nowMs);
  const syncedMs = syncedAt ? Date.parse(syncedAt) : NaN;
  const source = String(servedFrom || '');
  const stale = source.endsWith('-stale') || source === 'static' || (!Number.isNaN(syncedMs) && nowMs - syncedMs > STARLINK_SCHEDULE_STALE_MS);
  return { ago, stale };
}

/**
 * The departures board's subtitle freshness phrase (and the source line's), replacing
 * `freshnessAgo(lastUpdated)`:
 *   "schedule synced 2h ago · airborne live"
 *   "tracker offline, schedule from 22h ago"   (a "-stale" source, or older than 6 h)
 *   "scheduled times"                          (no sync time: the static roster)
 * @param {{syncedAt?: string|null, servedFrom?: string|null, nowMs?: number}} input
 * @returns {string}
 */
export function starlinkScheduleFreshness({ syncedAt, servedFrom, nowMs = Date.now() } = {}) {
  const { ago, stale } = starlinkScheduleAge({ syncedAt, servedFrom, nowMs });
  if (!ago) return 'scheduled times';
  return stale ? `tracker offline, schedule from ${ago}` : `schedule synced ${ago} · airborne live`;
}

/**
 * The tab's source line freshness ("Starlink data via … · <this> · 681 aircraft"): the schedule
 * freshness when there is a sync time, otherwise null and the line says nothing about freshness.
 * It used to print the tracker's frozen `lastUpdated` ("Updated 16d ago"), and "live" when that was
 * missing.
 * @param {{syncedAt?: string|null, servedFrom?: string|null, nowMs?: number}} input
 * @returns {string|null}
 */
export function starlinkSourceFreshness({ syncedAt, servedFrom, nowMs = Date.now() } = {}) {
  if (!syncedAt || Number.isNaN(Date.parse(syncedAt))) return null;
  return starlinkScheduleFreshness({ syncedAt, servedFrom, nowMs });
}

/**
 * The latest scheduled departure (UNIX seconds) in the served per-tail schedules, or null.
 * @param {Record<string, Array<{departure_ts?: number}>>|null|undefined} flightsByTail
 * @returns {number|null}
 */
export function latestScheduledDepartureTs(flightsByTail) {
  let latest = 0;
  for (const flights of Object.values(flightsByTail || {})) {
    for (const f of Array.isArray(flights) ? flights : []) {
      const ts = Number(f?.departure_ts);
      if (Number.isFinite(ts) && ts > latest) latest = ts;
    }
  }
  return latest > 0 ? latest : null;
}

/**
 * What the departures board says when its window is empty. When the stored schedule has run out
 * (no departure after now) the feed is offline — "no departures" would be false. While the tracker
 * is offline but the stored schedule still reaches into the window, an empty window is still
 * empty, but on a schedule of that age.
 * @param {{hub?: string|null, windowH: number, latestDepartureTs: number|null, nowSec: number,
 *   syncedAt?: string|null, servedFrom?: string|null}} input
 * @returns {string}
 */
export function starlinkBoardEmptyText({ hub, windowH, latestDepartureTs, nowSec, syncedAt, servedFrom }) {
  const where = hub || 'the hubs';
  const { ago, stale } = starlinkScheduleAge({ syncedAt, servedFrom, nowMs: nowSec * 1000 });
  if (latestDepartureTs === null || latestDepartureTs <= nowSec) {
    return ago
      ? `The Starlink schedule feed is offline and the last schedule we have (synced ${ago}) has run out, so this board cannot show departures.`
      : 'The Starlink schedule feed is offline, so this board cannot show departures.';
  }
  if (stale && ago) {
    return `No United Starlink departures from ${where} in the next ${windowH}h on the schedule synced ${ago} (the tracker is offline).`;
  }
  return `No United Starlink departures from ${where} in the next ${windowH}h.`;
}

/**
 * The departures board's footer, with the schedule's real age in place of the fixed "served
 * through The Blue Board's cache (up to 6h)" (false whenever the tracker is down: 22 h on Nov 11).
 * Its lead says whose numbers the board prints: the ones shown as UA are United's (a number with no
 * flight page prints as the feed sent it, `starlinkFlightLabel`), with the operating carrier named
 * under each. It used to say the numbers were the operating carrier's callsigns, which stopped
 * being true when Express legs began printing their United number (Nov 12 2026).
 * @param {{syncedAt?: string|null, servedFrom?: string|null, nowMs?: number}} input
 * @returns {string}
 */
export function starlinkBoardFooter({ syncedAt, servedFrom, nowMs = Date.now() } = {}) {
  const { ago, stale } = starlinkScheduleAge({ syncedAt, servedFrom, nowMs });
  const lead = "A NOC departures board, not a passenger FIDS. Flight numbers shown as UA are United's; the name under each is the carrier that operates it (SkyWest, Republic, Mesa…).";
  const times = !ago
    ? 'Times are scheduled.'
    : stale
      ? `Times are scheduled, from the last schedule we have (synced ${ago}; the tracker is offline).`
      : `Times are scheduled, from the tracker's schedule synced ${ago}.`;
  return `${lead} ${times} Airborne marks come from the live flight feed — not live ATC.`;
}

/** Whole days since a tail's Starlink was first detected, floored at 0. */
export function daysSinceFound(dateFound, now = Date.now()) {
  const ms = dateFound ? Date.parse(dateFound) : NaN;
  if (isNaN(ms)) return null;
  return Math.max(0, Math.round((now - ms) / 86400000));
}

/** '2026-03-04 · 12d ago', or 'Unknown' when upstream never recorded a date. */
export function starlinkSinceLabel(dateFound, now = Date.now()) {
  const days = daysSinceFound(dateFound, now);
  if (days === null) return 'Unknown';
  return `${dateFound} · ${days === 0 ? 'today' : `${days}d ago`}`;
}

/** 'Mar 4, 2026' for the verification ledger's "Verified" column; '' when unparseable. */
export function formatVerifyDate(iso) {
  const ms = Date.parse(iso);
  if (isNaN(ms)) return '';
  return new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

// ── Alaska + Hawaiian, one row (Nov 12 2026) ──
// The tracker lists Alaska (AS) and Hawaiian (HA) as two carriers. They are one airline now:
// a single operating certificate since Oct 29 2025 (Alaska newsroom), and every flight has carried
// the AS code since Apr 22 2026, while the Hawaiian brand continues. The strip prints them as one
// row, summed from their counts.

/** The merged row's printed code; it fits the strip's `w-10` code column. */
export const ALASKA_HAWAIIAN_CODE = 'AS+HA';
/** The merged row's accessible and hover name. */
export const ALASKA_HAWAIIAN_NAME = 'Alaska Airlines + Hawaiian Airlines';
/** The footnote sentence printed only while the merged row is on the strip. */
export const INDUSTRY_ALASKA_HAWAIIAN_NOTE =
  'Alaska includes Hawaiian, which flies under the Alaska code since April 2026.';
/** The strip's title, and its title when it compares exactly United with the merged Alaska row. */
export const INDUSTRY_TITLE = 'Industry · Starlink Coverage';
export const INDUSTRY_TITLE_UNITED_VS_ALASKA = 'Starlink Coverage · United vs Alaska';

const industryRow = (code, name, installed, total, p) => ({
  code,
  name,
  isUA: code === 'UA',
  pct: Math.round(p),
  width: Math.max(0, Math.min(100, p)),
  installed,
  total,
  raw: p,
});

/**
 * One AS+HA row in place of the AS and HA rows: installed and total SUMMED and the percentage
 * recomputed from them (never an average of two percentages). Left as two rows unless both carry
 * a finite installed count and a total above zero; one of the two alone is left as it is.
 */
function mergeAlaskaHawaiian(rows) {
  const as = rows.find((r) => r.code === 'AS');
  const ha = rows.find((r) => r.code === 'HA');
  const usable = (r) => r && r.installed != null && r.total != null && r.total > 0;
  if (!usable(as) || !usable(ha)) return rows;
  const installed = as.installed + ha.installed;
  const total = as.total + ha.total;
  const merged = industryRow(ALASKA_HAWAIIAN_CODE, ALASKA_HAWAIIAN_NAME, installed, total, (installed / total) * 100);
  return [...rows.filter((r) => r !== as && r !== ha), merged];
}

/**
 * The industry coverage strip's rows, sorted best-covered first, with Alaska and Hawaiian as one
 * row (`mergeAlaskaHawaiian`).
 *
 * Returns null — meaning "render nothing" — unless EVERY row the tracker sent has a finite
 * percentage, checked before any merge. A partial strip would rank carriers against each other
 * on data we only have for some of them, which is the one thing a comparison bar chart must
 * never do.
 *
 * @param {Array<{code?:string,name?:string,installed?:number,total?:number,percentage?:number|string}>|null|undefined} airlines
 * @returns {Array<{code:string,name:string|null,isUA:boolean,pct:number,width:number,installed:number|null,total:number|null,raw:number}>|null}
 */
export function buildIndustryRows(airlines) {
  if (!Array.isArray(airlines) || airlines.length === 0) return null;
  const parsed = airlines.map((r) => {
    if (!r || r.percentage == null || r.percentage === '') return null;
    const p = typeof r.percentage === 'string' ? parseFloat(r.percentage) : Number(r.percentage);
    if (!Number.isFinite(p)) return null;
    const count = (v) => (v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
    const name = String(r.name || '').trim() || null;
    return industryRow(String(r.code || '').toUpperCase(), name, count(r.installed), count(r.total), p);
  });
  if (parsed.some((r) => r === null)) return null;
  return mergeAlaskaHawaiian(parsed).sort((a, b) => b.raw - a.raw);
}

/**
 * The strip's title and the extra footnote sentence for these rows. The title names the two
 * airlines only when the rows are exactly United and the merged Alaska row; the Hawaiian sentence
 * appears only while the merged row does (it would be false beside a lone HA row).
 * @param {Array<{code: string}>|null|undefined} rows  `buildIndustryRows()` output.
 * @returns {{title: string, note: string|null}}
 */
export function industryStripCopy(rows) {
  const codes = (rows || []).map((r) => r.code);
  const merged = codes.includes(ALASKA_HAWAIIAN_CODE);
  const unitedVsAlaska = codes.length === 2 && merged && codes.includes('UA');
  return {
    title: unitedVsAlaska ? INDUSTRY_TITLE_UNITED_VS_ALASKA : INDUSTRY_TITLE,
    note: merged ? INDUSTRY_ALASKA_HAWAIIAN_NOTE : null,
  };
}

// ── What the Express bar counts (Nov 12 2026) ──
// The bar read "Express 355 / 513 · 69%", and the velocity card divided the 158 "remaining" by the
// Express install pace to print "~Sep '31". 145 of those 158 were single-cabin 50-seaters: the
// tracker's `fleetStats.expressTotal` (513) is every United Express airframe, and United's stated
// plan is for its dual-cabin planes. The bar now counts the two-cabin regional fleet, and both of
// its numbers come from one snapshot: the UA row's regional families in the tracker's
// fleet-summary, the payload the industry strip already reads.

/**
 * United Express families the Express bar leaves out: the single-cabin 50-seat regional jets.
 *
 * Why: United's stated plan covers its dual-cabin planes. Its Mar 24 2026 release says Starlink
 * is "expected… to be onboard all United dual-cabin planes by the end of 2027". United has NOT
 * said the single-cabin jets will go without; the "not receiving" label for the CRJ-200 and
 * E145 is The Points Guy's table (Mar 31 2025), not United's. On 2026-11-12 the tracker's
 * fleet-summary listed none of them fitted (CRJ-200 0 of 90, ERJ-145 0 of 55). Checked 2026-11-12.
 *
 * Named on purpose, never inferred from "no installs yet": the two-cabin E170s and CRJ-700s (none
 * fitted on that date) stay in the denominator, and a CRJ-200 converted to the two-cabin CRJ-450
 * gets Starlink and counts as soon as the tracker lists it as a CRJ-450. Matched by name with
 * case, spaces and hyphens ignored ('CRJ200').
 */
export const EXPRESS_FAMILIES_LEFT_OUT = Object.freeze(['CRJ-200', 'ERJ-145']);

const familyKey = (name) => String(name ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const LEFT_OUT_KEYS = new Set(EXPRESS_FAMILIES_LEFT_OUT.map(familyKey));

/** A whole, non-negative count from the payload, or NaN (null and '' are not zero). */
const countOf = (v) => (v === null || v === undefined || v === '' ? NaN : Number(v));

/**
 * The Express rollout from ONE snapshot: the UA row's `body: 'regional'` families in the
 * tracker's fleet-summary, less the named single-cabin families.
 *
 * The percentage is computed from the summed counts, never from the families' own `percentage`
 * fields. Null, and the Express row then shows its equipped count with no bar, when there is no
 * UA row, no regional family, a regional family with an unusable count (a partial sum would print
 * a wrong share), or no two-cabin aircraft at all.
 *
 * @param {Array<{code?: string, families?: Array<{family?: string, body?: string, installed?: number, total?: number}>}>|null|undefined} airlines
 *   `/api/fleet-summary`'s `airlines`.
 * @returns {{installed: number, total: number, pct: number, leftOut: number, leftOutFamilies: string[]}|null}
 *   leftOut: aircraft in the named single-cabin families, from the same payload;
 *   leftOutFamilies: those of the named families the payload lists with any aircraft, in the
 *   constant's order and spelling.
 */
export function expressStarlinkScope(airlines) {
  if (!Array.isArray(airlines)) return null;
  const ua = airlines.find((a) => String(a?.code || '').toUpperCase() === 'UA');
  const regional = (Array.isArray(ua?.families) ? ua.families : []).filter(
    (f) => String(f?.body || '').toLowerCase() === 'regional',
  );
  if (regional.length === 0) return null;
  let installed = 0;
  let total = 0;
  let leftOut = 0;
  const listed = new Set();
  for (const f of regional) {
    const i = countOf(f.installed);
    const t = countOf(f.total);
    if (!Number.isInteger(i) || !Number.isInteger(t) || i < 0 || t < 0 || i > t) return null;
    const key = familyKey(f.family);
    if (LEFT_OUT_KEYS.has(key)) {
      leftOut += t;
      if (t > 0) listed.add(key);
    } else {
      installed += i;
      total += t;
    }
  }
  if (!(total > 0)) return null;
  const leftOutFamilies = EXPRESS_FAMILIES_LEFT_OUT.filter((name) => listed.has(familyKey(name)));
  return { installed, total, pct: Math.round((installed / total) * 100), leftOut, leftOutFamilies };
}

/**
 * The hero's Express / Mainline rollout bars.
 *
 * The Mainline bar is `starlinkMainlineShare()` — the same count, denominator and percentage
 * the Fleet tab's ring prints — so the two tabs cannot quote different mainline totals (they
 * did: "Mainline 261 / 1161" here beside 1,139 on Fleet and Stats).
 *
 * The Express bar is `expressStarlinkScope()`: the two-cabin regional fleet, numerator and
 * denominator from one fleet-summary snapshot. Without it (the endpoint answers 502 while the
 * tracker is down) the Express row is the tracker's equipped count alone, with `total` and `pct`
 * null and no bar. The tracker's `expressTotal` / `expressPct` are not read at all: that
 * denominator counts the single-cabin jets and must never make a percentage again.
 *
 * Returns null in the degraded tier: the static fallback roster carries no fleet stats, and a
 * percentage bar with a guessed denominator is a lie with a ruler on it.
 *
 * @param {{express?: number}|null|undefined} stats  the served `fleetStats`.
 * @param {{count: number, total: number, pct: number}|null|undefined} mainlineShare
 * @param {{installed: number, total: number, pct: number}|null|undefined} [expressScope]
 * @returns {Array<{label: string, installed: number, total: number|null, pct: number|null}>|null}
 */
export function rolloutBars(stats, mainlineShare, expressScope = null) {
  if (!stats || !mainlineShare || !(mainlineShare.total > 0)) return null;
  const equipped = countOf(stats.express);
  let express;
  if (expressScope && expressScope.total > 0) {
    express = {
      label: 'Express',
      installed: expressScope.installed,
      total: expressScope.total,
      pct: expressScope.pct,
    };
  } else if (Number.isFinite(equipped)) {
    express = { label: 'Express', installed: equipped, total: null, pct: null };
  } else {
    return null;
  }
  return [
    express,
    {
      label: 'Mainline',
      installed: mainlineShare.count,
      total: mainlineShare.total,
      pct: mainlineShare.pct,
    },
  ];
}

/**
 * The figure beside a rollout bar: "354 / 368 · 96%", or "355 equipped" when the row has no
 * denominator (the Express row without a fleet-summary).
 * @param {{installed: number, total: number|null, pct: number|null}} bar
 * @returns {string}
 */
export function rolloutBarFigure(bar) {
  if (bar.total == null || bar.pct == null) return `${bar.installed} equipped`;
  return `${bar.installed} / ${bar.total} · ${bar.pct}%`;
}

/** "CRJ-200s and ERJ-145s": the left-out families the payload listed, so the sentence follows the data. */
function leftOutNames(families) {
  const names = (families && families.length ? families : EXPRESS_FAMILIES_LEFT_OUT).map((n) => `${n}s`);
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0];
}

/**
 * The line under the rollout bars: whose denominator each bar is (D15, applied to this tab), and
 * what the Express bar counts. It attributes to United only the dual-cabin plan United stated,
 * and the number left out is the payload's, never a typed one.
 *
 *   "Mainline: 326 of 1,154 aircraft in our fleet database · Express: per the Starlink tracker.
 *    Express counts two-cabin regional jets, the planes United has said will get Starlink. The 145
 *    single-cabin CRJ-200s and ERJ-145s are left out."
 *   "Mainline: 326 of 1,154 aircraft in our fleet database · Express: equipped count per the
 *    Starlink tracker"                                                   (no fleet-summary)
 *
 * @param {{count: number, total: number, source?: string}|null|undefined} mainlineShare
 * @param {{leftOut: number, leftOutFamilies?: string[]}|null|undefined} [expressScope]
 * @returns {string}
 */
export function rolloutBarsNote(mainlineShare, expressScope = null) {
  if (!mainlineShare) return '';
  const tracker = mainlineShare.source === 'tracker';
  if (!expressScope) {
    return tracker
      ? 'Mainline and Express: per the Starlink tracker'
      : `Mainline: ${starlinkShareCaption(mainlineShare)} · Express: equipped count per the Starlink tracker`;
  }
  const sources = tracker
    ? 'Mainline and Express: per the Starlink tracker'
    : `Mainline: ${starlinkShareCaption(mainlineShare)} · Express: per the Starlink tracker`;
  const counts = 'Express counts two-cabin regional jets, the planes United has said will get Starlink.';
  const left = Number(expressScope.leftOut) || 0;
  const leftOut = left > 0
    ? ` The ${left.toLocaleString('en-US')} single-cabin ${leftOutNames(expressScope.leftOutFamilies)} are left out.`
    : '';
  return `${sources}. ${counts}${leftOut}`;
}

/**
 * Does the verification ledger hold anything worth showing?
 *
 * The endpoint's adapter answers HTTP 200 with a zero-filled summary on any upstream shape
 * drift, so "truthy summary" is not enough: a contradictory "0 verified · 0 disputed" panel
 * under a hero reading 400 is worse than no panel.
 */
export function ledgerHasData(disputed, summary) {
  if (Array.isArray(disputed) && disputed.length > 0) return true;
  if (!summary) return false;
  return Boolean(
    summary.verifiedStarlink || summary.disputed || summary.unverified || summary.totalPlanes,
  );
}

/** The integrity alert's sentence. Kept here so the wording is tested, not retyped. */
export function integrityAlertText(tails) {
  const list = [...tails];
  return (
    `${list.length} disputed ${list.length === 1 ? 'tail is' : 'tails are'} still present in the ` +
    `served Starlink fleet: ${list.join(', ')}. These were overruled by official verification ` +
    'and should be excluded — check the data pipeline.'
  );
}
