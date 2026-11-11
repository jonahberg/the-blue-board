// ═══ FLIGHT PAGE — "THE READ" (THE AI EXPLANATION, ON REQUEST) ═══
// The flight page's AI card sends /api/delay-explain exactly what the Schedule board's explain
// dialog sends for the same row: the board's own delay-risk score (board-risk.js
// computeScheduleRowRisk, the function the board's model calls) built from the dashboard's own
// shared inputs, and the same request body (delay-explain-request.js buildDelayExplainBody).
//
// The inputs are the four endpoints the dashboard already polls and the warm cron's prediction
// logger reads (delay-prediction.js buildPredictionContext): /api/faa, /api/nas, /api/irops and
// /api/metar for the nine hub stations — public, CDN-cached, and fetched ONLY when the reader
// presses the button. Nothing here runs on page load.
//
// A flight that has already left gets no prediction on the board, and none here: the score is null
// and the card says so instead of asking the model to explain a number that does not exist.
//
// Pure (the page script does the fetching), so tests can feed it the endpoint bodies.

import { computeScheduleRowRisk } from './board-risk.js';
import { buildPredictionContext, hubMetarStations } from './delay-prediction.js';
import { getScheduleRiskContext } from './delay-explain-context.js';
import { buildDelayExplainBody, hubLocalTime } from './delay-explain-request.js';
import { HUB_TZ } from './hubTz.js';
import { delayExplainContext } from './schedule-row-model.js';
import { displayScheduleStatus } from './status-display.js';
import { classifySchedStatus } from './schedule-status.js';

/** The four input URLs, exactly as the dashboard / the warm cron ask for them (shared CDN objects). */
export function readInputUrls() {
  const { stations } = hubMetarStations();
  return {
    faa: '/api/faa',
    nas: '/api/nas',
    irops: '/api/irops',
    metar: `/api/metar?ids=${encodeURIComponent(stations.join(','))}`,
  };
}

/**
 * The board's risk for this leg and the explain request body, or `{risk: null}` when the board
 * would show no prediction for it.
 *
 * @param {any} row  the payload's leg row.
 * @param {{hub: string, dir: 'departures'|'arrivals', ident: string, nowMs: number,
 *   bodies: {faa?: any, nas?: any, irops?: any, metar?: any}}} ctx
 * @returns {{risk: any|null, body: Record<string, unknown>|null}}
 */
export function buildFlightRead(row, { hub, dir, ident, nowMs, bodies }) {
  if (!row || !hub) return { risk: null, body: null };
  const deps = buildPredictionContext(bodies || {});
  const nowSec = Math.floor(nowMs / 1000);
  const risk = computeScheduleRowRisk(row, hub, dir, nowSec, {
    faaIndex: deps.faaIndex,
    weatherOpsByHub: deps.weatherOpsByHub,
    hubOtp: deps.hubOtp,
    iropsHubRates: deps.iropsHubRates,
    nas: deps.plannedTmis ? { planned: deps.plannedTmis } : null,
  });
  if (!risk) return { risk: null, body: null };
  const riskContext = getScheduleRiskContext(row, hub, dir);
  const status = displayScheduleStatus(classifySchedStatus(row, dir, nowSec));
  const context = delayExplainContext({
    ident,
    riskContext,
    statusText: status.text,
    risk,
    hubOtp: deps.hubOtp,
    weatherOpsByHub: deps.weatherOpsByHub,
    iropsHubRates: deps.iropsHubRates,
    scheduledDep: row?.time?.scheduled?.departure,
  });
  const body = buildDelayExplainBody({
    ...context,
    nowMs,
    hubTime: hubLocalTime(HUB_TZ[context.hub] || ''),
  });
  return { risk, body };
}

/** "Board risk: MOD (42/100) · ORD weather, evening cascade" — the score the model is explaining. */
export function riskLine(risk) {
  if (!risk) return '';
  const factors = (risk.factors || []).slice(0, 3).map((f) => (typeof f === 'string' ? f : f?.label || '')).filter(Boolean);
  return `Board risk: ${risk.label} (${risk.score}/100)${factors.length ? ` · ${factors.join(', ')}` : ''}`;
}
