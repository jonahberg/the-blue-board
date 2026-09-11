// ═══ STARLINK TAB HELPERS ═══
// Recency badges, the verification-ledger integrity guard, the departures board's
// time formatting and cap policy, and the airborne-tail index.
//
// Extracted verbatim from src/dashboard/main.js (:2779-2815, :2906-2923, and the
// board cap rule at :3176-3271). The clock, the served fleet and the timezone
// abbreviation are injected so the module stays pure.

import { HUB_TZ } from './hubTz.js';

/**
 * Has upstream first recorded this tail's Starlink within the last 7 days?
 *
 * A day of forward skew is tolerated because the upstream clock is not ours; any
 * further into the future is treated as bad data.
 *
 * @param {string|null|undefined} dateFound
 * @param {number} [now]  epoch ms.
 * @returns {boolean}
 */
export function isRecentlyFound(dateFound, now = Date.now()) {
  if (!dateFound) return false;
  const t = Date.parse(dateFound);
  if (isNaN(t)) return false;
  return t <= now + 86400000 && (now - t) <= 7 * 86400000;
}

/**
 * Disputed tails that are STILL in the served fleet snapshot — a real pipeline fault.
 *
 * Propagation guard: the fleet comes from the 4-hourly sync-starlink snapshot while the disputed
 * ledger is near-live (45-min cache), so a tail verified AFTER the served snapshot was taken is a
 * normal, self-healing race (next cron prunes it) — not a pipeline fault. Alert only when the
 * snapshot POST-dates the verification and still contains the tail. Observed live Jul 2 2026:
 * N34131 verified 18:17Z against a 16:00Z snapshot rendered a false "check the data pipeline".
 *
 * When either timestamp is unknown the tail IS flagged — the guard fails loud.
 *
 * @param {Array<{tail?: string, verifiedAt?: string}|null>} disputed
 * @param {{has: (tail: string) => boolean}} tails  the served Starlink fleet.
 * @param {string|null|undefined} syncedAt  when the served snapshot was taken.
 * @returns {Set<string>}
 */
export function getServedConflictTails(disputed, tails, syncedAt) {
  const set = new Set();
  const syncedMs = syncedAt ? Date.parse(syncedAt) : NaN;
  for (const d of (disputed || [])) {
    if (!d || !d.tail || !tails.has(d.tail)) continue;
    const verifiedMs = d.verifiedAt ? Date.parse(d.verifiedAt) : NaN;
    // Both timestamps known and the dispute is newer than the served snapshot → propagation lag.
    if (!isNaN(syncedMs) && !isNaN(verifiedMs) && verifiedMs > syncedMs) continue;
    set.add(d.tail);
  }
  return set;
}

/**
 * Format an upstream departure timestamp (UNIX seconds) as a short HH:MM hint.
 *
 * Hub-local with the hub TZ abbreviation when the airport is a known hub — the
 * Schedule tab is hub-local, and the FIDS board showing unlabeled viewer-local
 * times next to it was silently inconsistent (audit Jul 3 2026). Non-hub airports
 * fall back to viewer-local but ALWAYS carry a TZ label so the time is never
 * ambiguous.
 *
 * @param {number|null|undefined} ts  unix seconds.
 * @param {string} airportIata
 * @param {(hub: string) => string} tzAbbrev  hub → 'CDT'/'JST'/…; injected so the one
 *   implementation in main.js stays the only one.
 * @returns {string} '' for a missing or invalid timestamp.
 */
export function formatFlightTime(ts, airportIata, tzAbbrev) {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  if (isNaN(d.getTime())) return '';
  const tz = HUB_TZ[airportIata];
  if (tz) {
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz })
      + ' ' + tzAbbrev(airportIata);
  }
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZoneName: 'short' });
}

/**
 * Map of tail → live airborne flight from the LIVE OPS feed. One pass over the feed;
 * cheap enough to rebuild per render.
 *
 * @param {Array<Object>} flights
 * @param {{has: (reg: string) => boolean}} starlinkTails
 * @returns {Record<string, Object>} keyed by normalised (hyphen-free, upper-case) tail.
 */
export function airborneByTail(flights, starlinkTails) {
  const live = {};
  for (const f of (flights || [])) {
    if (f.onGround) continue;
    const reg = (f.reg || '').replace(/-/g, '').toUpperCase();
    if (reg && starlinkTails.has(reg)) live[reg] = f;
  }
  return live;
}

/**
 * How many rows per hub the departures board renders.
 *
 * Tame the default. The all-hubs 12h list is ~180 rows — a wall that buries the roster and the
 * ledger below it. Cap to a tight per-hub slice in the all-hubs view (the "Show all" button
 * expands it); a single-hub 12h view shows everything; the wide 48h view stays capped at 40/hub.
 *
 * @param {{showAll: boolean, hub: string|null|undefined, windowH: number}} opts
 * @returns {number} Infinity when uncapped.
 */
export function boardCapPolicy({ showAll, hub, windowH }) {
  return showAll ? Infinity
    : !hub ? 6
    : windowH >= 48 ? 40
    : Infinity;
}
