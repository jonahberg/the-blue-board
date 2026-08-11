/**
 * facts.js — single source of truth for page-level factual numbers/claims.
 *
 * Every page-level factual number (hub counts, Starlink equipped count,
 * fleet database size, social-proof user count, etc.) must import from
 * this file rather than being hardcoded inline. When a fact changes,
 * update it HERE ONCE, then grep the repo for the old value to catch any
 * stragglers that couldn't import directly (see note below).
 *
 * Static, non-importable surfaces (public/index.html, public/llms.txt,
 * public/llms-full.txt, README.md) cannot `import` this module. Their
 * Starlink figures are no longer hand-synced: scripts/stamp-seo-build-date.mjs
 * rewrites them in dist/ at build from src/data/starlink-live.json, so the
 * committed source keeps readable last-good strings. Only the NON-Starlink
 * facts in those files (hub counts, fleet database size) still need hand-sync,
 * per the comment near each file's top.
 *
 * Verified against United's FY2025 10-K, United newsroom releases, and
 * Federal Register orders as of FACTS_AS_OF below.
 */

/** United's 8 FAA/10-K-recognized hub airports (IATA codes). */
export const OFFICIAL_HUBS = ['ORD', 'DEN', 'IAH', 'EWR', 'SFO', 'IAD', 'LAX', 'GUM'];

/** Tokyo-Narita: United's Asia-Pacific gateway (intra-Asia 737 network) — not an official hub. */
export const GATEWAY = 'NRT';

/** Number of airport boards The Blue Board tracks (8 official hubs + the NRT gateway). */
export const TRACKED_BOARDS = 9;

/** Long-form approved editorial line for hub-count claims. Adapt grammar per surface. */
export const HUB_LINE_LONG = "all 8 United hubs plus the Tokyo-Narita gateway";

/** Short-label approved editorial line for hub-count claims (tight spaces). */
export const HUB_LINE_SHORT = "8 hubs + NRT gateway";

// Vite-bundled only (src/** + Astro). NEVER import facts.js from api/** — a
// bare JSON import crashes Vercel's Node-ESM functions (prod incident 2026-06-01).
import starlinkLive from './starlink-live.json';

/** Starlink-equipped aircraft count — refreshed at build by scripts/refresh-starlink-facts.mjs. */
export const STARLINK_EQUIPPED = starlinkLive.live.count;

/** Floored prose label ("500+") — can only be stale in the conservative direction. */
export const STARLINK_EQUIPPED_LABEL = starlinkLive.live.label;

/** "August 2026" — the month the count was fetched. */
export const STARLINK_AS_OF = starlinkLive.live.asOf;

/** United's public target for Starlink-equipped aircraft by end of 2026. */
export const STARLINK_TARGET_2026 = '~1,000';

/** Airframe count in The Blue Board's fleet database (Q1-2026 snapshot — NOT United's live fleet size). */
export const FLEET_DB_COUNT = 1078;

/** Conservative, verified social-proof user count. Raise via this constant only when re-verified. */
export const SOCIAL_PROOF_USERS = '22,000+';

/** Date these facts were last verified against source (ISO 8601). */
export const FACTS_AS_OF = '2026-07-08';
