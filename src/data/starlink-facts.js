/**
 * starlink-facts.js — the JSON-backed Starlink figures, split out of facts.js.
 *
 * Vite-bundled only (src/** + Astro). NEVER import this module from api/** — a bare JSON
 * import crashes Vercel's Node-ESM functions at module load (ERR_IMPORT_ATTRIBUTE_MISSING;
 * prod incidents 2026-06-01 and 2026-08-11). facts.js stays JSON-free so api/waitlist.ts can
 * keep importing the plain string facts. Guarded by tests/api-esm-json-imports.test.js.
 */
import starlinkLive from './starlink-live.json';
import fleetDb from '../../public/data/fleet.json';
import {
  STARLINK_EQUIPPED_SCOPE as EQUIPPED_SCOPE, STARLINK_SOURCE_TRACKER,
  starlinkCountsByType, starlinkFleetSharePct, starlinkRosterAsOf,
} from '../lib/starlink-facts.js';

/** Starlink-equipped aircraft count — refreshed at build by scripts/refresh-starlink-facts.mjs. */
export const STARLINK_EQUIPPED = starlinkLive.live.count;

/** Floored prose label ("500+") — can only be stale in the conservative direction. */
export const STARLINK_EQUIPPED_LABEL = starlinkLive.live.label;

/** "August 2026" — the month of the count's source (since Nov 2026; was the month it was fetched). */
export const STARLINK_AS_OF = starlinkLive.live.asOf;

/**
 * What STARLINK_EQUIPPED counts: "mainline + Express" — every United aircraft on the tracker. It is
 * NOT a mainline figure, so a tile beside "Mainline Aircraft" must say so (/fleet, Nov 2026).
 */
export const STARLINK_EQUIPPED_SCOPE = starlinkLive.live.scope ?? EQUIPPED_SCOPE;

/**
 * ISO time the count is as of: its source's own time since Nov 2026 (`asOfDate`); the fetch time on
 * a committed file from before then. For a <time datetime>.
 */
export const STARLINK_EQUIPPED_AS_OF_ISO = starlinkLive.live.asOfDate ?? starlinkLive.live.fetchedAt ?? null;

/** '11 Nov 2026' — the same instant as a day, for the tile's "as of" line. '' when unknown. */
export const STARLINK_EQUIPPED_AS_OF_DAY = STARLINK_EQUIPPED_AS_OF_ISO ? starlinkRosterAsOf(STARLINK_EQUIPPED_AS_OF_ISO) : '';

/** Where the count came from: 'unitedstarlinktracker.com' or 'theblueboard.co snapshot'. */
export const STARLINK_EQUIPPED_SOURCE = starlinkLive.live.source ?? STARLINK_SOURCE_TRACKER;

// ─── Per-type Starlink counts for the fleet guide pages ───
// The build-time roster (starlink-live.json → roster, refreshed by the same script) joined to the
// fleet DB by registration. Both sides of "N of the M" come from data, so the sentence can never
// drift from the registry table rendered beneath it.

/** { [fleet.json type]: { equipped, total } } */
export const STARLINK_BY_TYPE = starlinkCountsByType(fleetDb, starlinkLive.roster?.tails ?? []);

/** '28 Sep 2026' — the day the roster is as of (UTC): its source's sync time since Nov 2026. */
export const STARLINK_ROSTER_AS_OF = starlinkRosterAsOf(starlinkLive.roster?.syncedAt);

/**
 * Mainline aircraft in the fleet DB that are on the Starlink roster — the mainline-only count a
 * mainline page can print beside "Mainline Aircraft" (the sum of the per-type "N of the M").
 */
export const STARLINK_MAINLINE_EQUIPPED = Object.values(STARLINK_BY_TYPE).reduce((n, row) => n + row.equipped, 0);

/** { equipped, total } for one type; zeros for a type absent from the fleet DB. */
export function starlinkForType(type) {
  return STARLINK_BY_TYPE[type] ?? { equipped: 0, total: 0 };
}

// ─── Starlink share of the combined fleet, for the hub pages ───
// Was hand-typed "about 24%" on seven hub pages while the live share was ~37%. Computed from
// the same build-time roster snapshot: mainline tails inside fleet.json over fleet.json (the
// dashboard's mainline total), plus the tracker's Express count over its Express fleet.

const fleetSharePct = starlinkFleetSharePct(fleetDb, starlinkLive.roster?.tails ?? [], starlinkLive.roster?.express);
if (fleetSharePct == null) {
  // Only reachable if the committed JSON is hand-broken: the refresh script never writes a
  // roster without a plausible Express block. Fail the build rather than print "NaN%".
  throw new Error('starlink-live.json roster.express is missing or invalid — cannot compute the fleet share');
}

/** 37 — whole-percent Starlink share of the combined mainline + Express fleet. */
export const STARLINK_FLEET_SHARE_PCT = fleetSharePct;
