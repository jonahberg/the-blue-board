// Pure helpers for the deploy-time Starlink figure refresh
// (scripts/refresh-starlink-facts.mjs), plus United's stated Starlink target, which the
// dashboard's Starlink tab prints. Kept dependency-free so the build script (node), the
// dashboard and vitest can all import them.

/** Floor to the nearest 25 for a "500+"-style prose label that can only be stale conservatively. */
export function starlinkLabel(count) {
  return `${Math.floor(count / 25) * 25}+`;
}

// ── United's own Starlink target (Nov 12 2026) ──
// The Starlink tab's velocity card printed "Express · 100% ETA ~Sep '31", a date of our own made by
// dividing a backlog by a pace. It contradicted United's stated target, and the backlog was mostly
// single-cabin jets outside United's stated plan. The tile now states United's target and its
// source instead, and we compute no completion date anywhere. Edit the target here, in one place.

/**
 * United's stated fleet-wide Starlink target, as the Starlink tab's tile prints it.
 * Source: United Airlines Holdings Form 8-K, Exhibit 99.1, filed Oct 20 2026 (the third-quarter
 * results; the same text is on United's newsroom). Checked against the filed exhibit 2026-11-12.
 */
export const UNITED_STARLINK_TARGET = Object.freeze({
  label: "United's target",
  value: 'End of 2027',
  note: 'fleet-wide · stated Oct 20, 2026',
  statedOn: '2026-10-20',
  quote: 'United expects it to be available fleet-wide by the end of 2027.',
  source: Object.freeze({
    name: 'United Airlines Holdings, Form 8-K, Exhibit 99.1 (third-quarter 2026 results), Oct 20 2026',
    url: 'https://www.sec.gov/Archives/edgar/data/100517/000010051726000184/ual_erx09302026xex991.htm',
  }),
});

/** "August 2026" — UTC so the label doesn't depend on the build machine's timezone. */
export function starlinkAsOf(date = new Date()) {
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/**
 * Guard for the fetched count: integer, never below the committed last-good
 * value (installs are monotonic — a lower number means a partial feed), never
 * above the entire tracked fleet (~1,815 as of Aug 2026; 2500 leaves headroom).
 */
export function isPlausibleStarlinkCount(count, committedCount) {
  return Number.isInteger(count) && count >= committedCount && count <= 2500;
}

/**
 * Mainline Starlink tails from the upstream /api/data payload, uppercased, de-duplicated and
 * sorted, plus any evidence-backed overrides the site already serves (so the build-time roster
 * agrees with the live Starlink tab). Express tails are left out: fleet.json is mainline only.
 * @param {any} upstream  the unitedstarlinktracker.com /api/data body
 * @param {ReadonlyArray<{tail: string, fleet?: string}>} [overrides]
 * @returns {string[]}
 */
export function starlinkRosterTails(upstream, overrides = []) {
  const planes = Array.isArray(upstream?.starlinkPlanes) ? upstream.starlinkPlanes : [];
  const tails = new Set();
  for (const p of planes) {
    if (String(p?.fleet ?? '').toLowerCase() !== 'mainline') continue;
    const tail = String(p?.TailNumber ?? '').trim().toUpperCase();
    if (tail) tails.add(tail);
  }
  for (const o of overrides) {
    if (String(o?.fleet ?? '').toLowerCase() === 'mainline' && o.tail) tails.add(String(o.tail).toUpperCase());
  }
  return [...tails].sort();
}

/**
 * Guard for the fetched roster. Unlike the headline count this is NOT strictly monotonic —
 * upstream occasionally drops or renames a tail, and a hard floor would freeze the roster
 * forever — but a roster that lost more than a tenth of its tails is a partial feed.
 */
export function isPlausibleStarlinkRoster(tails, committedLength = 0) {
  return Array.isArray(tails) && tails.length > 0 && tails.length >= Math.floor(committedLength * 0.9) && tails.length <= 2500;
}

/**
 * Per-type Starlink counts: fleet.json rows (the denominator) joined to the roster by
 * registration. Returns { [type]: { equipped, total } } for every type in the fleet DB.
 * @param {ReadonlyArray<{r?: string, t?: string}>} fleetDb
 * @param {Iterable<string>} rosterTails
 */
export function starlinkCountsByType(fleetDb, rosterTails) {
  const onRoster = new Set([...rosterTails].map((t) => String(t).toUpperCase()));
  /** @type {Record<string, {equipped: number, total: number}>} */
  const out = {};
  for (const a of fleetDb || []) {
    if (!a?.t) continue;
    const row = (out[a.t] ||= { equipped: 0, total: 0 });
    row.total += 1;
    if (a.r && onRoster.has(String(a.r).toUpperCase())) row.equipped += 1;
  }
  return out;
}

/**
 * The Express half of the build-time fleet share, read from the SAME upstream /api/data payload
 * as the roster tails (so both halves are one snapshot): `fleetStats.express` is
 * `{ starlink, total }`. We keep no Express database, so the tracker's count is the only one.
 * Null when the block is missing or implausible (non-integers, an empty fleet, more equipped
 * than exist) — the refresh script then keeps the committed roster.
 * @param {any} upstream  the unitedstarlinktracker.com /api/data body
 * @returns {{installed: number, total: number}|null}
 */
export function starlinkExpressCounts(upstream) {
  const e = upstream?.fleetStats?.express;
  const installed = Number(e?.starlink);
  const total = Number(e?.total);
  if (!Number.isInteger(installed) || !Number.isInteger(total)) return null;
  if (total <= 0 || total > 2500 || installed < 0 || installed > total) return null;
  return { installed, total };
}

/**
 * Starlink share of United's combined (mainline + Express) fleet, in whole percent — the
 * figure the hub pages print beside the equipped count.
 *
 * Mainline uses the dashboard's one mainline definition (`starlinkMainlineShare`): roster tails
 * inside fleet.json over fleet.json. The tracker's own mainline total is NOT used — on Oct 3
 * 2026 it carried 16 retired A319/A320s and an undelivered MAX 10. Express is the tracker's.
 *
 * @param {ReadonlyArray<{r?: string}>} fleetDb
 * @param {Iterable<string>} rosterTails  mainline Starlink tails
 * @param {{installed: number, total: number}|null|undefined} express
 * @returns {number|null}  null without an Express block (no denominator to divide by).
 */
export function starlinkFleetSharePct(fleetDb, rosterTails, express) {
  const db = fleetDb || [];
  if (!express || !(express.total > 0) || db.length === 0) return null;
  const onRoster = new Set([...rosterTails].map((t) => String(t).toUpperCase()));
  const mainline = db.filter((a) => a?.r && onRoster.has(String(a.r).toUpperCase())).length;
  return Math.round(((mainline + express.installed) / (db.length + express.total)) * 100);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * '2026-09-28T15:42:05Z' → '28 Sep 2026' (UTC). Hand-rolled rather than toLocaleDateString:
 * Node 24's ICU renders en-GB September as "Sept" while Bun renders "Sep", and the build and
 * CI must produce the same string.
 */
export function starlinkRosterAsOf(syncedAt) {
  const d = new Date(syncedAt);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/**
 * The clause under a fleet type page's registry table when its Starlink marks and the roster
 * disagree, or '' when they agree. The page's "N of the M had Starlink" is the Starlink roster joined
 * to the fleet database (dated by the roster's sync); the table's WiFi column is the fleet database
 * itself (dated by its own snapshot, in the sentence this follows). Two sources on two days, in
 * either order: on Nov 11 2026 the 737 MAX 9 page said 48 above a table marking 42.
 * @param {{marked: number, roster: number, rosterAsOf?: string}} input
 *   marked: rows the table marks Starlink; roster: starlinkForType().equipped; rosterAsOf: '11 Nov 2026'.
 * @returns {string}
 */
export function registryStarlinkNote({ marked, roster, rosterAsOf = '' }) {
  if (!Number.isFinite(marked) || !Number.isFinite(roster) || marked === roster) return '';
  const when = rosterAsOf ? ` on ${rosterAsOf}` : '';
  return `Its WiFi column marks ${marked} with Starlink as of that date; the Starlink tracker's roster listed ${roster}${when}.`;
}

// ── Build-time sources, in order (Nov 2026) ──
// On Nov 11 2026 unitedstarlinktracker.com answered Cloudflare 521 all day, every build kept the
// committed starlink-live.json, and /fleet regressed to "602 Starlink equipped" — a count fetched
// Sep 28 — while the dashboard said 681 from our own snapshot. The committed file never advances
// (CLAUDE.md has every commit `git checkout` it), so the fallback was 44 days stale. The site's
// own /api/starlink-data?fields=roster now stands between the tracker and the committed file: it is
// our 4-hourly sync's Supabase snapshot of the same tracker data, carries its own `syncedAt`, and
// keeps answering while the tracker is down. Every figure is dated by its SOURCE's time.

/** What the equipped count counts: every United aircraft on the tracker, mainline and Express. */
export const STARLINK_EQUIPPED_SCOPE = 'mainline + Express';

/** A tracker `generatedAt` further than this from the fetch is not used to date the count. */
const TRACKER_GENERATED_AT_MAX_SKEW_MS = 24 * 60 * 60 * 1000;

/** Where each build-time figure came from. */
export const STARLINK_SOURCE_TRACKER = 'unitedstarlinktracker.com';
export const STARLINK_SOURCE_SNAPSHOT = 'theblueboard.co snapshot';

/**
 * The sync time of a served /api/starlink-data payload, or null when it is not usable as a
 * source: the static fallback (servedFrom 'static', no sync time), or no parseable time.
 * @param {any} served  /api/starlink-data?fields=roster body
 * @returns {Date|null}
 */
export function servedStarlinkSyncedAt(served) {
  if (!served || served.servedFrom === 'static') return null;
  const d = new Date(served.syncedAt);
  return served.syncedAt && !Number.isNaN(d.getTime()) ? d : null;
}

/** The equipped count from a served payload (fleetStats.total), or null. */
export function starlinkCountFromServed(served) {
  if (!servedStarlinkSyncedAt(served)) return null;
  const total = Number(served?.fleetStats?.total);
  return Number.isInteger(total) && total > 0 ? total : null;
}

/** Mainline tails from a served payload's `aircraft`, same rules as starlinkRosterTails. */
export function starlinkRosterTailsFromServed(served, overrides = []) {
  if (!servedStarlinkSyncedAt(served)) return [];
  const planes = (Array.isArray(served?.aircraft) ? served.aircraft : []).map((a) => ({ TailNumber: a?.tail, fleet: a?.fleet }));
  return starlinkRosterTails({ starlinkPlanes: planes }, overrides);
}

/** The Express counts from a served payload (fleetStats.express / expressTotal), same guards. */
export function starlinkExpressCountsFromServed(served) {
  if (!servedStarlinkSyncedAt(served)) return null;
  const fs = served?.fleetStats;
  return starlinkExpressCounts({ fleetStats: { express: { starlink: fs?.express, total: fs?.expressTotal } } });
}

/**
 * The headline figure to publish: the tracker's fleet-summary when it answers plausibly, else the
 * site's served snapshot, else null (keep the committed file). Dated by the source.
 * @param {{summary?: any, served?: any, committedCount: number, now?: Date}} input
 * @returns {{count: number, label: string, asOf: string, asOfDate: string, scope: string, source: string, fetchedAt: string}|null}
 */
export function chooseStarlinkLive({ summary = null, served = null, committedCount, now = new Date() }) {
  const ua = (summary?.airlines ?? []).find((a) => a?.code === 'UA');
  const trackerCount = ua?.installed;
  if (summary && isPlausibleStarlinkCount(trackerCount, committedCount)) {
    // The tracker's own timestamps are not trusted blindly: its /api/data `lastUpdated` has been
    // frozen since Oct 27 2026 while its counts moved. Its fleet-summary `generatedAt` dates the
    // count only when it is within a day of the fetch; otherwise the fetch time does.
    const generated = new Date(summary.generatedAt);
    const plausible = summary.generatedAt && !Number.isNaN(generated.getTime())
      && Math.abs(now.getTime() - generated.getTime()) <= TRACKER_GENERATED_AT_MAX_SKEW_MS;
    return liveFigure(trackerCount, plausible ? generated : now, STARLINK_SOURCE_TRACKER, now);
  }
  const servedCount = starlinkCountFromServed(served);
  if (served && isPlausibleStarlinkCount(servedCount, committedCount)) {
    return liveFigure(servedCount, servedStarlinkSyncedAt(served), STARLINK_SOURCE_SNAPSHOT, now);
  }
  return null;
}

function liveFigure(count, asOfDate, source, now) {
  return {
    count,
    label: starlinkLabel(count),
    asOf: starlinkAsOf(asOfDate),
    asOfDate: asOfDate.toISOString(),
    scope: STARLINK_EQUIPPED_SCOPE,
    source,
    fetchedAt: now.toISOString(),
  };
}

/**
 * The mainline roster + Express counts to publish: the tracker's /api/data when it answers
 * plausibly, else the site's served snapshot, else null (keep the committed roster).
 * @param {{upstream?: any, served?: any, committedLength: number, overrides?: ReadonlyArray<{tail: string, fleet?: string}>, now?: Date}} input
 * @returns {{syncedAt: string, tails: string[], express: {installed: number, total: number}, source: string}|null}
 */
export function chooseStarlinkRoster({ upstream = null, served = null, committedLength, overrides = [], now = new Date() }) {
  if (upstream) {
    const tails = starlinkRosterTails(upstream, overrides);
    const express = starlinkExpressCounts(upstream);
    if (isPlausibleStarlinkRoster(tails, committedLength) && express) {
      return { syncedAt: now.toISOString(), tails, express, source: STARLINK_SOURCE_TRACKER };
    }
  }
  const syncedAt = servedStarlinkSyncedAt(served);
  if (syncedAt) {
    const tails = starlinkRosterTailsFromServed(served, overrides);
    const express = starlinkExpressCountsFromServed(served);
    if (isPlausibleStarlinkRoster(tails, committedLength) && express) {
      return { syncedAt: syncedAt.toISOString(), tails, express, source: STARLINK_SOURCE_SNAPSHOT };
    }
  }
  return null;
}
