// ═══ BOARD RISK REUSE ═══
// Scoring ONE schedule row the way the Schedule board scores it, so a My Flights card
// that lacks its own inputs can show the board's answer instead of inventing one.
//
// Extracted from src/dashboard/main.js (:5932-5983 computeDelayRiskForScheduleFlight +
// findBoardRiskForFlight). The inputs mirror `useBoardModel.ts` exactly: the whole point
// is that the same flight cannot read V.HIGH on the board and LOW on the card.
//
// Audit Jul 3 2026: the card used to fall back to a DEFAULT LOW whenever the
// flight-times feed was dark — a confident green badge derived from no data at all,
// beside a board that said the opposite. A card with no inputs must reuse the board's
// score or say "RISK N/A"; it may never guess.

import { getScheduleRiskContext } from './delay-explain-context.js';
import { HUB_COORDINATES, HUB_RISK_PROFILES, computeDelayRiskModel } from './delay-risk.js';
import { HUB_TZ } from './hubTz.js';
import { classifySchedStatus } from './schedule-status.js';

/**
 * @param {Object} row  a provider schedule row.
 * @param {string} hub  the board's hub.
 * @param {'departures'|'arrivals'} dir
 * @param {number} nowSec  board-anchored "now".
 * @param {Object} deps  faaIndex, weatherOpsByHub, hubOtp, iropsHubRates, nas, classifyOpts.
 * @returns {Object|null} the risk model, or null when the row has already operated or
 *   scored zero (the model's "nothing to say" answer).
 */
export function computeScheduleRowRisk(row, hub, dir, nowSec, deps) {
  const {
    faaIndex = {},
    weatherOpsByHub = {},
    hubOtp = {},
    iropsHubRates = {},
    nas = null,
    classifyOpts = { hubDisruptionMinutes: 0 },
  } = deps || {};

  const status = classifySchedStatus(row, dir, nowSec, classifyOpts);
  // Only a flight that has not gone yet gets a PREDICTION; one that has operated has facts.
  if (status.key !== 'scheduled' && status.key !== 'estimated' && status.key !== 'delayed') {
    return null;
  }

  const { depHub, arrHub } = getScheduleRiskContext(row, hub, dir);
  const schedTime = row.time?.scheduled?.departure || row.time?.scheduled?.arrival;
  const estTime = row.time?.estimated?.departure || row.time?.estimated?.arrival;
  const actTime = row.time?.real?.departure || row.time?.real?.arrival;

  const result = computeDelayRiskModel({
    currentFlightNumber: row.identification?.number?.default || '',
    nowMs: Date.now(),
    scheduledTime: schedTime || '',
    comparisonTime: actTime || estTime || '',
    originHub: depHub,
    destinationHub: arrHub,
    originFaa: faaIndex[depHub],
    destinationFaa: faaIndex[arrHub],
    originWeather: weatherOpsByHub[depHub],
    destinationWeather: weatherOpsByHub[arrHub],
    originOtp: hubOtp[depHub],
    timeZone: HUB_TZ[depHub] || 'America/Chicago',
    originCoordinates: HUB_COORDINATES[depHub],
    hubProfile: HUB_RISK_PROFILES[depHub],
    originIrops: iropsHubRates[depHub],
    destinationIrops: iropsHubRates[arrHub],
    plannedTmis: nas?.planned || null,
  });

  return result.score === 0 ? null : result;
}

/**
 * Find a flight number on any loaded board and return that board's risk for it.
 *
 * @param {string} flightNum
 * @param {Record<string, {rows?: Object[], hub?: string, dir?: string, meta?: Object}>} boards
 *   keyed `<hub>-<dir>-<day>`, as the schedule store holds them.
 * @param {number} nowSec
 * @param {Object} deps  as `computeScheduleRowRisk`.
 * @returns {Object|null} null when the flight is on no loaded board.
 */
export function findBoardRiskForFlight(flightNum, boards, nowSec, deps) {
  if (!flightNum) return null;
  for (const [key, board] of Object.entries(boards || {})) {
    const rows = Array.isArray(board?.rows) ? board.rows : [];
    if (!rows.length) continue;
    const parts = key.split('-');
    const boardHub = board?.hub || parts[0];
    const boardDir = (board?.dir || parts[1]) === 'arrivals' ? 'arrivals' : 'departures';
    const row = rows.find((f) => f.identification?.number?.default === flightNum);
    if (!row) continue;
    const classifyOpts = {
      hubDisruptionMinutes:
        Number.isFinite(Number(board?.meta?.hubDisruptionMinutes)) &&
        Number(board?.meta?.hubDisruptionMinutes) > 0
          ? Number(board.meta.hubDisruptionMinutes)
          : 0,
    };
    const risk = computeScheduleRowRisk(row, boardHub, boardDir, nowSec, {
      ...deps,
      classifyOpts,
    });
    if (risk) return risk;
  }
  return null;
}
