// ═══ FLEET TYPE PAGES — THIS TYPE IN THE AIR RIGHT NOW ═══
// The /fleet/{type} pages show how many of that aircraft type are airborne, and a few of them, from
// the same free live feed the dashboard's map reads (`/api/fr24-feed?airline=UAL`, CDN-cached for
// 15 s). No metered provider is involved, and the page asks for the one URL the dashboard already
// keeps warm at the edge — so a fleet page adds a feed read only when no dashboard tab has that
// edge warm (at most one per 15 s window, and only while a fleet tab is visible).
//
// Matching is by REGISTRATION against the page's own registry rows, never by the feed's type
// designator: the feed calls both the 737-900 and the 737-900ER "B739", and both the 777-200 and
// the 777-200ER "B772" (checked against a live read on Nov 10 2026), so a designator match would
// count one type's jets on the other's page.
//
// "Airborne" is the dashboard's own rule (flight-phase.js `isOnGround`: the feed's flag, or under
// 100 ft and 50 kt), the one the Live tab's count uses (airborne-count.js).

import { parseFr24Feed } from './feed-health.js';
import { isOnGround } from './flight-phase.js';

/** Flights listed under the count. */
export const FLEET_LIVE_ROWS = 4;

/** "N12-345" / " n26960 " → "N12345". */
export function normalizeTail(reg) {
  return String(reg || '')
    .trim()
    .toUpperCase()
    .replace(/-/g, '');
}

/** The flight number a passenger knows: the feed's IATA number, else UAL123 → UA123. */
export function feedFlightIdent(flight) {
  const iata = String(flight?.flightIATA || '').trim().toUpperCase();
  if (iata) return iata;
  const m = /^UAL(\d{1,4}[A-Z]?)$/.exec(String(flight?.callsign || '').trim().toUpperCase());
  return m ? `UA${m[1]}` : '';
}

const identNumber = (ident) => {
  const m = /(\d+)/.exec(ident);
  return m ? Number(m[1]) : Number.POSITIVE_INFINITY;
};

/**
 * This type's aircraft in one feed read.
 *
 * @param {any} payload  the raw `/api/fr24-feed` body.
 * @param {Iterable<string>} tails  the type's registrations (the page's registry rows).
 * @param {number} [limit]
 * @returns {{airborne: number, onGround: number,
 *   flights: Array<{ident: string, origin: string, dest: string, reg: string, href: string}>}|null}
 *   null when the feed parsed to nothing — a failed read (feed-health.js), never "none airborne".
 *   `flights` lists airborne ones with a known route first, then by flight number.
 */
export function airborneOfType(payload, tails, limit = FLEET_LIVE_ROWS) {
  const parsed = parseFr24Feed(payload);
  if (!parsed.length) return null;
  const wanted = new Set([...(tails || [])].map(normalizeTail).filter(Boolean));
  const seen = new Set();
  const airborne = [];
  let onGround = 0;
  for (const f of parsed) {
    const reg = normalizeTail(f.reg);
    if (!reg || !wanted.has(reg) || seen.has(reg)) continue;
    seen.add(reg);
    if (isOnGround(f)) onGround++;
    else airborne.push(f);
  }

  const routed = (f) => (f.origin && f.dest ? 0 : 1);
  const listed = airborne
    .map((f) => ({ f, ident: feedFlightIdent(f) }))
    .sort((a, b) => routed(a.f) - routed(b.f) || identNumber(a.ident) - identNumber(b.ident))
    .slice(0, limit)
    .map(({ f, ident }) => {
      const reg = normalizeTail(f.reg);
      return {
        ident,
        origin: String(f.origin || '').toUpperCase(),
        dest: String(f.dest || '').toUpperCase(),
        reg,
        // The dashboard's `?flight=` deep link opens the flight panel for an airborne flight; it
        // matches a tail as well as a flight number (src/app/state/deep-links.ts).
        href: `/?flight=${encodeURIComponent(ident || reg)}`,
      };
    });

  return { airborne: airborne.length, onGround, flights: listed };
}
