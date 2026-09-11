/**
 * starlink-facts.js — the JSON-backed Starlink figures, split out of facts.js.
 *
 * Vite-bundled only (src/** + Astro). NEVER import this module from api/** — a bare JSON
 * import crashes Vercel's Node-ESM functions at module load (ERR_IMPORT_ATTRIBUTE_MISSING;
 * prod incidents 2026-06-01 and 2026-08-11). facts.js stays JSON-free so api/waitlist.ts can
 * keep importing the plain string facts. Guarded by tests/api-esm-json-imports.test.js.
 */
import starlinkLive from './starlink-live.json';

/** Starlink-equipped aircraft count — refreshed at build by scripts/refresh-starlink-facts.mjs. */
export const STARLINK_EQUIPPED = starlinkLive.live.count;

/** Floored prose label ("500+") — can only be stale in the conservative direction. */
export const STARLINK_EQUIPPED_LABEL = starlinkLive.live.label;

/** "August 2026" — the month the count was fetched. */
export const STARLINK_AS_OF = starlinkLive.live.asOf;
