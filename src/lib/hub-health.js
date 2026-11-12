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
 * @param {number} [dayOffset]  -1 when the reading is yesterday's board (hubReadingDayOffset).
 * @returns {string}
 */
export function hubOtpDescription(otp, dayOffset = 0) {
  if (otp === null || otp === undefined) return 'No on-time reading yet';
  const whose = dayOffset === -1 ? "yesterday's operated departures" : 'operated departures';
  return `${otp}% of ${whose} within ${ON_TIME_GRACE_MIN} min of schedule`;
}

/**
 * -1 when an /api/irops hub reading comes from yesterday's board (before 06:00 hub-local), else 0.
 * @param {{boardDayOffset?: number|null}|null|undefined} m  one hubMetrics entry
 * @returns {-1|0}
 */
export function hubReadingDayOffset(m) {
  return Number(m?.boardDayOffset) === -1 ? -1 : 0;
}

/** A hub reading built from a board older than this is stale (F91). */
export const HUB_READING_STALE_MS = 60 * 60 * 1000;

// ── Board coverage (Nov 11 2026) ──
// How much of a board's own day has happened since the board was built. For today's board that
// is its age. For YESTERDAY's board — what /api/irops and the dashboard read before 06:00 hub-local
// — only the part of yesterday after the build counts: a board built after local midnight saw the
// whole day, so it is final (gap 0) however old it gets, and one built at 21:00 is missing three
// hours. Age alone called every final yesterday board stale and dropped it from the brief.

/**
 * A hub board is current when no more than this much of its day has gone unseen. The brief's
 * 3-hour board rule (BRIEF_MAX_BOARD_AGE_MS); the warm ring rebuilds a today board about every 3 h.
 */
export const HUB_BOARD_CURRENT_MAX_SEC = 3 * 60 * 60;

/**
 * Seconds of the board's day that have passed since it was built: max(0, min(now, dayEnd) − built).
 * Without a day end it is the board's age. Null when the build time is unknown.
 * @param {{generatedAtSec: unknown, dayEndSec?: unknown, nowSec: number}} input
 * @returns {number|null}
 */
export function boardCoverageGapSec({ generatedAtSec, dayEndSec = null, nowSec }) {
  const builtMs = boardAsOfMs(generatedAtSec);
  if (builtMs === null) return null;
  const end = Number(dayEndSec);
  const until = dayEndSec !== null && dayEndSec !== undefined && Number.isFinite(end) && end > 0 ? Math.min(nowSec, end) : nowSec;
  return Math.max(0, Math.round(until - builtMs / 1000));
}

/**
 * Which hub boards behind an /api/irops payload are current. Recomputed at `nowSec` when the
 * payload carries the build time and day end (it can be ~35 min old by the time it is read);
 * otherwise the payload's own `coverageGapSec`, then `dataAgeSec` on payloads older than both.
 * A hub with no flights on its board is not current ("missing").
 * @param {Record<string, any>|null|undefined} hubMetrics  /api/irops `hubMetrics`.
 * @param {number} [nowSec]
 * @returns {{total: number, current: string[], notCurrent: Array<{hub: string, gapSec: number|null, ageSec: number|null, dayOffset: number, missing: boolean}>}}
 */
export function hubBoardCoverage(hubMetrics, nowSec) {
  const current = [];
  const notCurrent = [];
  const entries = Object.entries(hubMetrics || {});
  for (const [hub, m] of entries) {
    const missing = !m || !(Number(m.total) > 0);
    const builtMs = boardAsOfMs(m?.generatedAt);
    const live = nowSec !== undefined && builtMs !== null;
    const gapSec = live
      ? boardCoverageGapSec({ generatedAtSec: m.generatedAt, dayEndSec: m.boardDayEndSec ?? null, nowSec })
      : finiteOrNull(m?.coverageGapSec) ?? finiteOrNull(m?.dataAgeSec);
    const ageSec = live
      ? Math.max(0, Math.round(nowSec - builtMs / 1000))
      : finiteOrNull(m?.ageSec) ?? finiteOrNull(m?.dataAgeSec);
    const dayOffset = Number(m?.boardDayOffset) === -1 ? -1 : 0;
    if (!missing && gapSec !== null && gapSec <= HUB_BOARD_CURRENT_MAX_SEC) current.push(hub);
    else notCurrent.push({ hub, gapSec, ageSec, dayOffset, missing });
  }
  notCurrent.sort((a, b) => Number(b.missing) - Number(a.missing) || (b.gapSec ?? Infinity) - (a.gapSec ?? Infinity) || a.hub.localeCompare(b.hub));
  return { total: entries.length, current, notCurrent };
}

/** A finite number, or null (null/undefined/'' are null, not 0). */
function finiteOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Whole hours: '3 h'. Only a board more than 3 h behind is ever named, so minutes never show. */
function spanText(sec) {
  return `${Math.max(1, Math.round(sec / 3600))} h`;
}

/** One not-current board in words. */
function notCurrentText({ hub, gapSec, dayOffset, missing }) {
  if (missing) return `${hub} board missing`;
  if (gapSec === null) return `${hub} board age unknown`;
  if (dayOffset === -1) return `${hub} board missing the last ${spanText(gapSec)} of yesterday`;
  return `${hub} board ${spanText(gapSec)} old`;
}

/**
 * The IROPS card's coverage line: "8 of 9 hub boards current · LAX board 3 h old", or null when
 * every board is current. Names the two worst boards, then "and N more".
 * @param {Record<string, any>|null|undefined} hubMetrics  /api/irops `hubMetrics`.
 * @param {number} [nowSec]  render time; omit to use the payload's own figures.
 * @returns {string|null}
 */
export function iropsCoverageNote(hubMetrics, nowSec) {
  const { total, current, notCurrent } = hubBoardCoverage(hubMetrics, nowSec);
  if (total === 0 || notCurrent.length === 0) return null;
  const named = notCurrent.slice(0, 2).map(notCurrentText).join(', ');
  const more = notCurrent.length > 2 ? ` and ${notCurrent.length - 2} more` : '';
  return `${current.length} of ${total} hub boards current · ${named}${more}`;
}

/**
 * Whether an /api/irops `hubMetrics` discloses board coverage: some entry carries `coverageGapSec`
 * (null counts — the field is there). Payloads from before Nov 2026 do not.
 * @param {Record<string, any>|null|undefined} hubMetrics
 */
export function hubMetricsDiscloseCoverage(hubMetrics) {
  return Object.values(hubMetrics || {}).some((m) => m && typeof m === 'object' && 'coverageGapSec' in m);
}

/**
 * The IROPS card's coverage line, only from a payload that discloses coverage; null otherwise.
 * `iropsCoverageNote` alone would fall back to `generatedAt` / `dataAgeSec` on an older payload and
 * call a final yesterday board "N h old" — the misreading the coverage fields exist to prevent.
 * @param {Record<string, any>|null|undefined} hubMetrics
 * @param {number} [nowSec]  when the payload was fetched; omit to use its own figures.
 * @returns {string|null}
 */
export function iropsCoverageLine(hubMetrics, nowSec) {
  return hubMetricsDiscloseCoverage(hubMetrics) ? iropsCoverageNote(hubMetrics, nowSec) : null;
}

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
 * Rows are counted with `operatedOutcome()` — the one definition the board header and
 * /api/irops share (D9) — after `status.inferred` rows are dropped. Among what it excludes,
 * matching the per-board OTP card exactly:
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
      if (status.inferred) return;
      // D9: the one operated definition (operatedOutcome), fed the classifier's key.
      const outcome = operatedOutcome(fl, boardDir, status.key);
      if (!outcome) return;
      totalsByHub[hub].operated++;
      if (outcome === 'onTime') totalsByHub[hub].onTime++;
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
  if (operated < HUB_OTP_MIN_OPERATED && cancelRate >= 0.5) return 0; // mostly cancelled — show as critical
  if (operated >= HUB_OTP_MIN_OPERATED) return Math.round((onTime / operated) * 100);
  return null; // operated < 5 and low cancel rate: no data yet
}

/** Operated departures a hub needs before the strip shows its on-time figure. */
export const HUB_OTP_MIN_OPERATED = 5;

/**
 * True when a hub board cannot tell a departed flight from a held one: not one row carries an
 * actual or estimated departure time, and at least 3 rows are either marked departed anyway or are
 * over 30 minutes past due. Guam's board is like this every day (Nov 8–10 2026: 0 of 30 departure
 * rows with an actual time; 18 never left "scheduled"); a normal hub has times on most rows, and a
 * ground stop's held flights carry estimates. Data-driven, so a hub that starts sending times
 * stops matching. False on payloads without the counts.
 * @param {{departureTimesSeen?: number, departedWithoutTime?: number, pastDueUntimed?: number}|null|undefined} m
 */
export function boardLacksActualTimes(m) {
  if (!m) return false;
  const seen = Number(m.departureTimesSeen);
  if (m.departureTimesSeen === undefined || m.departureTimesSeen === null || !Number.isFinite(seen) || seen > 0) return false;
  return (Number(m.departedWithoutTime) || 0) + (Number(m.pastDueUntimed) || 0) >= 3;
}

/**
 * Why a hub has no on-time figure, in the visitor's words, or null when it has one.
 *  - 'no-board'    no departures board (empty or missing)
 *  - 'no-actuals'  the feed sends no departure times for the hub (boardLacksActualTimes) — Guam
 *  - 'too-few'     fewer than HUB_OTP_MIN_OPERATED departures have left so far (NRT's day starts
 *                  with one flight and its bank leaves at 16:55–18:00 JST)
 * `label` is what the chip shows instead of a percentage.
 * @param {any} m  one /api/irops hubMetrics entry
 * @param {string} hub
 * @returns {{reason: 'no-board'|'no-actuals'|'too-few', label: string, text: string}|null}
 */
export function hubOtpUnavailableReason(m, hub) {
  const total = Number(m?.total) || 0;
  if (!m || total <= 0) {
    return { reason: 'no-board', label: '—', text: `No ${hub} departures board right now.` };
  }
  if (serverOtpFromMetrics(m) !== null) return null;
  if (boardLacksActualTimes(m)) {
    return {
      reason: 'no-actuals',
      label: 'n/a',
      text: `The schedule feed sends no actual departure times for ${hub}, so there is no on-time figure.`,
    };
  }
  const operated = Number(m.operated) || 0;
  // The day only when the payload says which: a board of unknown day claims neither.
  const day = m.boardDayOffset === null || m.boardDayOffset === undefined ? null : Number(m.boardDayOffset);
  const when = day === -1 ? 'left yesterday' : day === 0 ? 'have left so far today' : 'have left';
  return {
    reason: 'too-few',
    label: '—',
    text: `${operated} of ${total} ${hub} departures ${when}; an on-time figure needs ${HUB_OTP_MIN_OPERATED}.`,
  };
}

/**
 * Whether an /api/irops `hubMetrics` carries the departure-time counts behind
 * `hubOtpUnavailableReason` (Nov 2026). Without them Guam reads "0 of 9 departures have left so far
 * today", which its feed cannot know.
 * @param {Record<string, any>|null|undefined} hubMetrics
 */
export function hubMetricsExplainGaps(hubMetrics) {
  return Object.values(hubMetrics || {}).some((m) => Number.isFinite(Number(m?.departureTimesSeen)) && m?.departureTimesSeen !== null);
}

/**
 * The hub chip's sr-only words for each reason: short and fixed, so the strip (a polite live
 * region) announces a change of reason and never a count ticking up on a poll. The counted
 * sentence (`text`) lives in the tooltip.
 */
const NO_FIGURE_SR = {
  'no-board': 'no departures board',
  'no-actuals': 'no on-time figure: the feed sends no departure times',
};

/**
 * Where a hub chip goes, in the words its tooltip and its link name use. The chip opens that
 * hub's Schedule board in place (`hubLink(hub, 'dashboard')`, owner decision Nov 12 2026), where
 * the dashboard lists the flights behind the figure; the hub guide is one link further, in the
 * board's header. `sr` is the same for every hub and every poll, so the strip (a polite live
 * region) never announces it as a change.
 * @param {string} hub
 * @returns {{tooltip: string, sr: string}}
 */
export function hubChipDestination(hub) {
  return { tooltip: `United at ${hub} · today's board`, sr: "today's board" };
}

/**
 * What the hub strip says for a hub with NO on-time reading: `hubOtpUnavailableReason` plus its
 * sr-only words, or null to keep the bare dash — before the server has answered, and on a payload
 * from before the counts existed. Call it only for a chip without a reading.
 * @param {Record<string, any>|null|undefined} hubMetrics  /api/irops `hubMetrics`
 * @param {string} hub
 * @returns {{reason: 'no-board'|'no-actuals'|'too-few', label: string, text: string, sr: string}|null}
 */
export function hubChipNoFigure(hubMetrics, hub) {
  if (!hubMetrics || !hubMetricsExplainGaps(hubMetrics)) return null;
  const m = hubMetrics[hub];
  const why = hubOtpUnavailableReason(m, hub);
  if (!why) return null;
  let sr = NO_FIGURE_SR[why.reason];
  if (why.reason === 'too-few') {
    const day = m?.boardDayOffset === null || m?.boardDayOffset === undefined ? null : Number(m.boardDayOffset);
    sr = `too few departures${day === -1 ? ' yesterday' : day === 0 ? ' yet' : ''} for an on-time figure`;
  }
  return { ...why, sr };
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
