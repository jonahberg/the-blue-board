// Pure helpers for the deploy-time Starlink figure refresh
// (scripts/refresh-starlink-facts.mjs). Kept dependency-free so both the build
// script (node) and vitest can import them.

/** Floor to the nearest 25 for a "500+"-style prose label that can only be stale conservatively. */
export function starlinkLabel(count) {
  return `${Math.floor(count / 25) * 25}+`;
}

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
