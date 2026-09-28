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
import { starlinkCountsByType, starlinkRosterAsOf } from '../lib/starlink-facts.js';

/** Starlink-equipped aircraft count — refreshed at build by scripts/refresh-starlink-facts.mjs. */
export const STARLINK_EQUIPPED = starlinkLive.live.count;

/** Floored prose label ("500+") — can only be stale in the conservative direction. */
export const STARLINK_EQUIPPED_LABEL = starlinkLive.live.label;

/** "August 2026" — the month the count was fetched. */
export const STARLINK_AS_OF = starlinkLive.live.asOf;

// ─── Per-type Starlink counts for the fleet guide pages ───
// The build-time roster (starlink-live.json → roster, refreshed by the same script) joined to the
// fleet DB by registration. Both sides of "N of the M" come from data, so the sentence can never
// drift from the registry table rendered beneath it.

/** { [fleet.json type]: { equipped, total } } */
export const STARLINK_BY_TYPE = starlinkCountsByType(fleetDb, starlinkLive.roster?.tails ?? []);

/** '28 Sep 2026' — the day the roster was fetched (UTC). */
export const STARLINK_ROSTER_AS_OF = starlinkRosterAsOf(starlinkLive.roster?.syncedAt);

/** { equipped, total } for one type; zeros for a type absent from the fleet DB. */
export function starlinkForType(type) {
  return STARLINK_BY_TYPE[type] ?? { equipped: 0, total: 0 };
}
