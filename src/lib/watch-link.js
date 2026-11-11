// ═══ ?watch=UA929 — "Watch this flight" from a page outside the dashboard ═══
// The flight page (/flight/UA929) cannot reach the dashboard's watch store: it used to write
// `bb_watched_flights` itself and open /#myflight, which skipped the store's push-subscription
// sync and its first-watch alert prompt. It now links here instead, and the dashboard adds the
// flight through the same path its eye buttons use (state/deep-links.ts → WatchProvider.add).
//
// Both ends of the link live in this module so the page that builds it and the dashboard that
// reads it cannot drift apart:
//   ?watch=UA929   the flight, canonical only (UA + 1–4 digits, no leading zero). Anything else
//                  is ignored: nothing is watched and the tab does not change.
//   &route=ORD-SFO the leg's route, shown on the card before /api/flight-times answers.
//   &dep=<epoch s> the leg's scheduled departure, so the watch follows THAT leg (watch-utils.js
//                  `evaluateWatchObservation` pins an entry to one `dep`). The page sends it only
//                  for a leg that has not left yet; a leg already flown or flying is left for the
//                  dashboard's first /api/flight-times answer to pin, as a fresh eye-button watch is.
//                  A value outside a few days of now is dropped, never trusted.

import { FLIGHT_IDENT_RE } from './flight-page.js';

/** Every parameter the link may carry. The dashboard strips all of them once it has acted. */
export const WATCH_LINK_PARAMS = Object.freeze(['watch', 'route', 'dep']);

/** A pinned departure may be this far in the past (the flight page shows yesterday's legs)… */
export const WATCH_DEP_PAST_SEC = 36 * 3600;
/** …or this far ahead (it shows tomorrow's). */
export const WATCH_DEP_FUTURE_SEC = 4 * 86400;

const ROUTE_ARROW_RE = /^([A-Z]{3})→([A-Z]{3})$/;
const ROUTE_PARAM_RE = /^([A-Z]{3})-([A-Z]{3})$/;

/**
 * The dashboard address that watches a flight: `/?watch=UA929&route=ORD-SFO&dep=…#myflight`.
 * The `#myflight` hash makes My Flights the tab on first paint, so the map never flashes first.
 *
 * @param {{flight: string, route?: string, dep?: number}} watch
 * @returns {string}
 */
export function watchLinkHref({ flight, route = '', dep = 0 }) {
  const params = new URLSearchParams({ watch: String(flight || '') });
  const m = ROUTE_ARROW_RE.exec(String(route || ''));
  if (m) params.set('route', `${m[1]}-${m[2]}`);
  if (Number.isInteger(dep) && dep > 0) params.set('dep', String(dep));
  return `/?${params.toString()}#myflight`;
}

/**
 * Read `?watch=` strictly. Null when there is no `watch` parameter or its value is not a
 * canonical United flight number; a bad `route` or `dep` is dropped on its own.
 *
 * @param {URLSearchParams} params
 * @param {number} nowSec
 * @returns {{flight: string, route: string, dep: number} | null}
 */
export function parseWatchLink(params, nowSec) {
  const raw = params.get('watch');
  if (raw == null) return null;
  const flight = raw.trim().toUpperCase();
  if (!FLIGHT_IDENT_RE.test(flight)) return null;
  const r = ROUTE_PARAM_RE.exec(String(params.get('route') || '').trim().toUpperCase());
  const route = r && r[1] !== r[2] ? `${r[1]}→${r[2]}` : '';
  const depText = String(params.get('dep') || '').trim();
  const depNum = /^\d{9,11}$/.test(depText) ? Number(depText) : 0;
  const dep = depNum > nowSec - WATCH_DEP_PAST_SEC && depNum < nowSec + WATCH_DEP_FUTURE_SEC ? depNum : 0;
  return { flight, route, dep };
}

/**
 * The same address without the watch link's parameters (every other parameter and the hash
 * kept), or null when it has no `?watch=`. `route` and `dep` are generic names, so they are
 * removed only alongside a `watch`.
 *
 * @param {{pathname: string, search: string, hash: string}} loc
 * @returns {string|null}
 */
export function withoutWatchParams({ pathname, search, hash }) {
  const params = new URLSearchParams(search);
  if (!params.has('watch')) return null;
  for (const key of WATCH_LINK_PARAMS) params.delete(key);
  const q = params.toString();
  return `${pathname}${q ? `?${q}` : ''}${hash || ''}`;
}
