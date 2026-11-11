// ═══ STARLINK ROSTER / BOARD / LEDGER TEXT HELPERS ═══
// The rest of the Starlink tab's non-visual logic: the roster's filter + sort predicate, the
// "next flight" pick, the departures board's row labels, and the freshness / industry-strip
// maths. Extracted from src/dashboard/main.js (renderSlTable, renderSlExpand, renderSlBoardRow,
// renderSlIndustry, renderSlHero's source line) so the TSX is layout only.
//
// The chart lives next door in starlink-chart.js; the recency badge, the integrity tripwire,
// the hub-local time format and the board cap policy live in starlink-view.js.

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
 * @param {{syncedAt?: string|null, servedFrom?: string|null, nowMs?: number}} input
 * @returns {string}
 */
export function starlinkBoardFooter({ syncedAt, servedFrom, nowMs = Date.now() } = {}) {
  const { ago, stale } = starlinkScheduleAge({ syncedAt, servedFrom, nowMs });
  const lead = 'A NOC departures board, not a passenger FIDS. Callsigns are the operating carrier (SkyWest, Republic, Mesa…), not United marketing flight numbers.';
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

/**
 * The industry coverage strip's rows, sorted best-covered first.
 *
 * Returns null — meaning "render nothing" — unless EVERY row has a finite percentage. A
 * partial strip would rank carriers against each other on data we only have for some of them,
 * which is the one thing a comparison bar chart must never do.
 *
 * @param {Array<{code?:string,name?:string,installed?:number,total?:number,percentage?:number|string}>|null|undefined} airlines
 */
export function buildIndustryRows(airlines) {
  if (!Array.isArray(airlines) || airlines.length === 0) return null;
  const parsed = airlines.map((r) => {
    if (!r || r.percentage == null || r.percentage === '') return null;
    const p = typeof r.percentage === 'string' ? parseFloat(r.percentage) : Number(r.percentage);
    if (!Number.isFinite(p)) return null;
    const code = String(r.code || '').toUpperCase();
    return {
      code,
      isUA: code === 'UA',
      pct: Math.round(p),
      width: Math.max(0, Math.min(100, p)),
      installed: Number.isFinite(Number(r.installed)) ? Number(r.installed) : null,
      total: Number.isFinite(Number(r.total)) ? Number(r.total) : null,
      raw: p,
    };
  });
  if (parsed.some((r) => r === null)) return null;
  return parsed.sort((a, b) => b.raw - a.raw);
}

/**
 * The hero's Express / Mainline rollout bars.
 *
 * The Mainline bar is `starlinkMainlineShare()` — the same count, denominator and percentage
 * the Fleet tab's ring prints — so the two tabs cannot quote different mainline totals (they
 * did: "Mainline 261 / 1161" here beside 1,139 on Fleet and Stats). Express is the tracker's
 * count: we keep no Express database.
 *
 * Returns null in the degraded tier: the static fallback roster carries no fleet
 * denominators, and a percentage bar with a guessed denominator is a lie with a ruler on it.
 *
 * @param {{express?: number, expressTotal?: number, expressPct?: number}|null|undefined} stats
 * @param {{count: number, total: number, pct: number}|null|undefined} mainlineShare
 */
export function rolloutBars(stats, mainlineShare) {
  if (!stats || !stats.expressTotal || !mainlineShare || !(mainlineShare.total > 0)) return null;
  const pct = (value, total, given) =>
    given != null ? given : Math.round((value / total) * 100);
  return [
    {
      label: 'Express',
      installed: stats.express,
      total: stats.expressTotal,
      pct: pct(stats.express, stats.expressTotal, stats.expressPct),
    },
    {
      label: 'Mainline',
      installed: mainlineShare.count,
      total: mainlineShare.total,
      pct: mainlineShare.pct,
    },
  ];
}

/**
 * The line under the rollout bars: whose denominator each bar is (D15, applied to this tab).
 *
 * @param {{count: number, total: number, source?: string}|null|undefined} mainlineShare
 * @returns {string}
 */
export function rolloutBarsNote(mainlineShare) {
  if (!mainlineShare) return '';
  if (mainlineShare.source === 'tracker') return 'Mainline and Express: per the Starlink tracker';
  return `Mainline: ${starlinkShareCaption(mainlineShare)} · Express: per the Starlink tracker`;
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
