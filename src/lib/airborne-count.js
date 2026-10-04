// ═══ AIRBORNE COUNT ═══
// The one "how many United flights are airborne" count, shared by the Live tab's stat bar
// (through computeLiveStats in live-stats.js) and the server's 5-minute sampler
// (api/_airborne-samples.ts, written from the watch-alerts cron). Both run it over the SAME
// thing — every flight `parseFr24Feed()` returns for the free `airline=UAL` feed, unfiltered —
// so the 24-hour graph's latest point is the number the stat bar shows with no filter applied.
//
// "Airborne" is `!isOnGround(f)` from flight-phase.js: the feed's onGround flag OR the telemetry
// (under 100 ft and 50 kt). No data imports here, so api/ can import it without dragging a bare
// JSON import into a Vercel function (tests/api-esm-json-imports.test.js).

import { isOnGround } from './flight-phase.js';

/**
 * Callsign prefixes of the regional carriers that fly United Express. The feed's `airline` field
 * is 'UAL' for every row (the feed is filtered by it), so the operator is only visible in the
 * callsign: SkyWest, Republic, GoJet, CommutAir, Mesa, Air Wisconsin — plus the ExpressJet and
 * Trans States prefixes the AeroDataBox operator set still carries
 * (api/_schedule-aerodatabox.ts UNITED_OPERATOR_CALLSIGNS). A live read on Oct 4 2026: 599 UAL,
 * 115 SKW, 37 ASH, 36 RPA, 27 GJS, 26 UCA, 3 with no callsign, of 843.
 */
export const EXPRESS_CALLSIGN_PREFIXES = ['SKW', 'RPA', 'GJS', 'UCA', 'ASH', 'AWI', 'ASQ', 'LOF'];

/**
 * @param {string|null|undefined} callsign  e.g. 'SKW5432'.
 * @returns {boolean} true when the flight is operated under a United Express carrier's callsign.
 */
export function isExpressCallsign(callsign) {
  const prefix = String(callsign || '').trim().toUpperCase().slice(0, 3);
  return EXPRESS_CALLSIGN_PREFIXES.includes(prefix);
}

/**
 * Count a parsed feed.
 *
 * `mainline` is every airborne flight NOT under an Express callsign, so mainline + express is
 * always exactly `airborne`; the handful of rows with no callsign at all count as mainline.
 *
 * @param {Array<Object>} flights  `parseFr24Feed()` output (or the dashboard's `feed.flights`).
 * @returns {{airborne: number, ground: number, total: number, mainline: number, express: number}}
 */
export function countAirborne(flights) {
  let airborne = 0;
  let ground = 0;
  let express = 0;
  for (const f of flights || []) {
    if (isOnGround(f)) {
      ground++;
    } else {
      airborne++;
      if (isExpressCallsign(f && f.callsign)) express++;
    }
  }
  return { airborne, ground, total: airborne + ground, mainline: airborne - express, express };
}

/**
 * The stored timestamp for a sample read at `ms`: floored to the whole minute, as an ISO string.
 * The cron fires on the minute (every 5), so the 12:05:03 read is stored as 12:05:00 and a
 * duplicate run inside the same minute collides on the primary key instead of adding a row.
 *
 * @param {number} ms  epoch milliseconds.
 * @returns {string|null} null for a non-finite input.
 */
export function sampleMinuteIso(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n)) return null;
  return new Date(Math.floor(n / 60000) * 60000).toISOString();
}
