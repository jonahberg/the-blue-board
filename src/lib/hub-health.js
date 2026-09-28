// ═══ HUB HEALTH: ON-TIME PERFORMANCE PER HUB ═══
// The header bar's per-hub on-time percentage. Two sources feed it — the server's
// /api/irops hubMetrics (authoritative) and a client-side aggregation over whatever
// schedule boards happen to be loaded — and this module holds the arbitration rules
// that keep them from fighting.
//
// Extracted verbatim from src/dashboard/main.js (:5739-5802 the client aggregation,
// :6077-6094 the server derivation, :5685-5734 the severity/label bands). The bar's
// markup, the FAA-program blend and the 🏠 marker stay in renderHubHealthBar().

import { networkStatus } from './ops-health.js';
import { isPlausibleDelta } from './schedule-plausibility.js';

/** Fixed left-to-right order of the hub-health bar. */
export const HUB_ORDER = ['ORD','DEN','IAH','EWR','SFO','IAD','LAX','NRT','GUM'];

/** A row counts as having operated only in these three classifier states. */
const OPERATED_KEYS = new Set(['departed', 'enroute', 'landed']);

/**
 * On-time window: a departure within 30 minutes of schedule still counts. The ONE constant
 * behind every on-time figure (this module, api/irops.ts) and the copy that explains it.
 * DOT's A14 convention is 15 minutes; moving to it is a product decision that must change
 * the server and client paths together.
 */
export const ON_TIME_GRACE_MIN = 30;
export const ON_TIME_GRACE_SECONDS = ON_TIME_GRACE_MIN * 60;

/** Provider (generic) status words that say the flight left the gate. */
const OPERATED_STATUS_TEXT = new Set(['departed', 'en-route', 'landed', 'diverted']);

/**
 * THE definition of an operated flight, for every on-time figure on the site (live audit
 * Sep 28 2026, D9: the ORD board header said "170 operated" while the hub strip and
 * /api/irops said 146 for the same board). Both now count with this.
 *
 * A board row is OPERATED when all of these hold:
 *  1. its status is departed / en-route / landed / diverted — the provider's generic status
 *     text, or the board classifier's key when the caller has one (`statusKey`);
 *  2. it has a REAL time in the board's direction — `real.departure` on a departures board,
 *     `real.arrival` on an arrivals board. An estimate is a forecast, not evidence;
 *  3. it has a scheduled time in that direction;
 *  4. it is not a synthetic row (`_source.liveFeedFallback`, or a schedule time derived
 *     from the actual — those always score on-time and inflate OTP when the feed degrades);
 *  5. the real-vs-scheduled delta is one a real flight could have (`isPlausibleDelta`: AeroDataBox
 *     can pair yesterday's schedule with today's actual).
 * It is ON TIME when real <= scheduled + ON_TIME_GRACE_MIN.
 *
 * @param {Object} fl  an /api/schedule board row.
 * @param {'departures'|'arrivals'} [dir]
 * @param {string} [statusKey]  a classifier key ('enroute' etc.) standing in for the status text.
 * @returns {'onTime'|'late'|null} null = not operated (by this definition).
 */
export function operatedOutcome(fl, dir = 'departures', statusKey) {
  const status = statusKey
    ? (statusKey === 'enroute' ? 'en-route' : String(statusKey).toLowerCase())
    : String(fl?.status?.generic?.status?.text || '').toLowerCase();
  if (!OPERATED_STATUS_TEXT.has(status)) return null;
  const isArr = dir === 'arrivals';
  const realT = isArr ? fl.time?.real?.arrival : fl.time?.real?.departure;
  const schedT = isArr ? fl.time?.scheduled?.arrival : fl.time?.scheduled?.departure;
  if (!realT || !schedT) return null;
  if (fl._source?.liveFeedFallback) return null;
  if (fl._source?.scheduleTimeDerivedFromActual?.departure || fl._source?.scheduleTimeDerivedFromActual?.arrival) return null;
  if (!isPlausibleDelta(realT, schedT)) return null;
  return realT <= schedT + ON_TIME_GRACE_SECONDS ? 'onTime' : 'late';
}

/**
 * The hub chip's tooltip line, with the on-time rule spelled out.
 * @param {number|null|undefined} otp
 * @returns {string}
 */
export function hubOtpDescription(otp) {
  if (otp === null || otp === undefined) return 'No on-time reading yet';
  return `${otp}% of operated departures within ${ON_TIME_GRACE_MIN} min of schedule`;
}

/** A hub reading built from a board older than this is stale (F91). */
export const HUB_READING_STALE_MS = 60 * 60 * 1000;

/**
 * A client board must be at least this much newer than the server's before it replaces the
 * server's reading — close in age, the server (full-day, authoritative) keeps winning, so
 * the chip cannot flap between two near-identical numbers.
 */
export const HUB_READING_PREFER_MARGIN_MS = 30 * 60 * 1000;

/**
 * A board's `meta.generatedAt` as epoch ms. /api/schedule stamps Unix SECONDS; an ISO
 * string or epoch ms is accepted too.
 * @param {unknown} value
 * @returns {number|null}
 */
export function boardAsOfMs(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' || /^\d+(\.\d+)?$/.test(String(value))) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return null;
    return n < 1e12 ? n * 1000 : n;
  }
  const ms = Date.parse(String(value));
  return Number.isFinite(ms) ? ms : null;
}

/**
 * "as of 13:00Z" for a hub reading, and whether it is stale.
 * @param {unknown} asOf  anything boardAsOfMs() accepts.
 * @param {number} nowMs
 * @returns {{label: string, stale: boolean, ageMin: number}|null} null when the age is unknown.
 */
export function hubReadingAge(asOf, nowMs) {
  const ms = boardAsOfMs(asOf);
  if (ms === null) return null;
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  const ageMs = Math.max(0, nowMs - ms);
  return {
    label: `as of ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}Z`,
    stale: ageMs > HUB_READING_STALE_MS,
    ageMin: Math.round(ageMs / 60000),
  };
}

/**
 * Pick each hub's on-time reading: the server's /api/irops figure, unless the client has
 * a board for that hub built at least HUB_READING_PREFER_MARGIN_MS more recently (the
 * server's copy of a board can be hours old — F91). A hub only the client has keeps the
 * client reading, exactly as mergeHubHealth() always allowed.
 *
 * @param {Object} input
 * @param {Record<string, number>} input.serverOtp  serverOtpFromMetrics() per hub.
 * @param {Record<string, number>} input.clientOtp  computeBoardOtp() output.
 * @param {Record<string, unknown>} [input.serverAsOf]  hubMetrics[hub].generatedAt.
 * @param {Record<string, unknown>} [input.clientAsOf]  newest loaded board's meta.generatedAt per hub.
 * @returns {Record<string, {otp: number, source: 'server'|'client', asOfMs: number|null}>}
 */
export function arbitrateHubHealth({ serverOtp = {}, clientOtp = {}, serverAsOf = {}, clientAsOf = {} }) {
  /** @type {Record<string, {otp: number, source: 'server'|'client', asOfMs: number|null}>} */
  const out = {};
  for (const hub of new Set([...Object.keys(serverOtp || {}), ...Object.keys(clientOtp || {})])) {
    const hasServer = serverOtp && hub in serverOtp;
    const hasClient = clientOtp && hub in clientOtp;
    const sAt = boardAsOfMs(serverAsOf?.[hub]);
    const cAt = boardAsOfMs(clientAsOf?.[hub]);
    const clientFresher = hasClient && sAt !== null && cAt !== null && cAt - sAt >= HUB_READING_PREFER_MARGIN_MS;
    if (hasServer && !clientFresher) out[hub] = { otp: serverOtp[hub], source: 'server', asOfMs: sAt };
    else if (hasClient) out[hub] = { otp: clientOtp[hub], source: 'client', asOfMs: cAt };
  }
  return out;
}

/** Below this many operated flights the client sample is too thin to publish. */
const MIN_OPERATED = 25;

/**
 * Client-side on-time percentage per hub, aggregated across every loaded board.
 *
 * Multiple keys can exist per hub (arrivals/departures × day), so this aggregates
 * instead of letting whichever key is iterated last overwrite the hub value, and it
 * scores each board in its own direction: an arrivals board compares scheduled vs
 * real ARRIVAL, a departures board scheduled vs real DEPARTURE. Never fall back
 * across legs — a completed departures row that backfilled real.arrival but not
 * real.departure would otherwise score flight duration as delay (F021).
 *
 * Three classes of row are excluded, matching the per-board OTP card exactly:
 *  - `status.inferred` — a long-past "scheduled" the classifier reclassified, with no
 *    real out-time, so there is no trustworthy baseline.
 *  - `_source.liveFeedFallback` — live-feed rescue rows carry last-seen/ETA times.
 *  - `_source.scheduleTimeDerivedFromActual.*` — rows whose schedule time came FROM
 *    the actual time always score on-time, inflating OTP toward 100% precisely when
 *    the feed is degraded (audit P1: degraded-rows-inflate-hub-otp).
 *
 * @param {Record<string, Array<Object>>} schedRawByHub  keyed `<hub>-<dir>-<day>`.
 * @param {{classify: (fl: Object, boardDir: string, key: string) => {key: string, inferred?: boolean}}} deps
 * @returns {Record<string, number>} hub → on-time %, only for hubs at or above the
 *   25-flight floor. Hubs below it are absent, never zero.
 */
export function computeBoardOtp(schedRawByHub, { classify }) {
  const totalsByHub = {};
  HUB_ORDER.forEach(hub => { totalsByHub[hub] = { onTime: 0, operated: 0 }; });

  for (const key of Object.keys(schedRawByHub || {})) {
    const flights = schedRawByHub[key];
    if (!flights || !flights.length) continue;
    const keyParts = key.split('-');
    const hub = keyParts[0];
    const boardDir = keyParts[1] === 'arrivals' ? 'arrivals' : 'departures';
    if (!totalsByHub[hub]) continue;
    flights.forEach(fl => {
      const status = classify(fl, boardDir, key);
      if (!OPERATED_KEYS.has(status.key)) return;
      if (status.inferred) return;
      if (fl._source?.liveFeedFallback) return;
      if (fl._source?.scheduleTimeDerivedFromActual?.departure || fl._source?.scheduleTimeDerivedFromActual?.arrival) return;
      const isArr = boardDir === 'arrivals';
      const schedT = isArr ? fl.time?.scheduled?.arrival : fl.time?.scheduled?.departure;
      const realT = isArr ? fl.time?.real?.arrival : fl.time?.real?.departure;
      if (!realT || !schedT) return; // skip flights without the direction-appropriate real timestamp
      totalsByHub[hub].operated++;
      if (realT <= schedT + ON_TIME_GRACE_SECONDS) totalsByHub[hub].onTime++;
    });
  }

  const out = {};
  for (const hub of HUB_ORDER) {
    const { onTime, operated } = totalsByHub[hub];
    if (operated >= MIN_OPERATED) out[hub] = Math.round((onTime / operated) * 100);
  }
  return out;
}

/**
 * Client readings the server has NOT already spoken for.
 *
 * The server's /api/irops OTP is authoritative once it lands: a 5-flight client
 * sample overwriting it made DEN flap 68→100 (audit Jul 3 2026).
 *
 * @param {Record<string, number>} clientOtp  from computeBoardOtp().
 * @param {Set<string>|undefined} serverHubs  hubs the server has reported.
 * @returns {Record<string, number>} safe to Object.assign over the live hub data.
 */
export function mergeHubHealth(clientOtp, serverHubs) {
  const out = {};
  for (const [hub, pct] of Object.entries(clientOtp || {})) {
    if (serverHubs && serverHubs.has(hub)) continue;
    out[hub] = pct;
  }
  return out;
}

/**
 * On-time percentage from one hub's /api/irops metrics.
 *
 * A hub with almost nothing operated and most of its flights cancelled reads 0
 * (critical) rather than "no data"; a hub with too few operated flights and a low
 * cancellation rate is left alone entirely.
 *
 * @param {{total?: number, operated?: number, onTime?: number, cancellations?: number}|null} m
 * @returns {number|null} percentage, or null to leave the hub untouched.
 */
export function serverOtpFromMetrics(m) {
  if (!m || !m.total) return null;
  const operated = Number(m.operated || 0);
  const onTime = Number(m.onTime || 0);
  const cancelRate = m.total > 10 ? Number(m.cancellations || 0) / m.total : 0;
  if (operated < 5 && cancelRate >= 0.5) return 0; // mostly cancelled — show as critical
  if (operated >= 5) return Math.round((onTime / operated) * 100);
  return null; // operated < 5 and low cancel rate: no data yet
}

/**
 * Severity band for one hub's on-time percentage.
 * @param {number|undefined} pct
 * @returns {'green'|'amber'|'red'|null} null when there is no reading yet.
 */
export function hubHealthSeverity(pct) {
  if (pct === undefined) return null;
  return pct > 70 ? 'green' : pct >= 50 ? 'amber' : 'red';
}

/**
 * The trailing network-wide chip. Its level comes from `networkStatus()` (ops-health.js),
 * the one definition the ticker and the IROPS badge also follow — pass the IROPS score and
 * the FAA index so the chip can never read "Smooth Ops" beside a disruption. Without them
 * it bands the on-time readings alone.
 *
 * @param {number[]} pcts  per-hub on-time readings.
 * @param {{iropsScore?: number|string|null, faaIndex?: object, hubCodes?: string[]}} [signals]
 * @returns {{avg: number, label: string, color: string, severity: 'green'|'amber'|'red',
 *   level: 'normal'|'minor'|'significant'}|null} null when no hub has a reading.
 */
export function networkLabel(pcts, { iropsScore = null, faaIndex = {}, hubCodes = HUB_ORDER } = {}) {
  if (!pcts || !pcts.length) return null;
  const hubOtps = Object.fromEntries(pcts.map((pct, i) => [String(i), pct]));
  const status = networkStatus({ hubOtps, faaIndex, hubCodes, iropsScore });
  return {
    avg: /** @type {number} */ (status.avg),
    label: status.label,
    color: status.color,
    severity: status.severity,
    level: status.level,
  };
}
