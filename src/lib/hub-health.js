// ═══ HUB HEALTH: ON-TIME PERFORMANCE PER HUB ═══
// The header bar's per-hub on-time percentage. Two sources feed it — the server's
// /api/irops hubMetrics (authoritative) and a client-side aggregation over whatever
// schedule boards happen to be loaded — and this module holds the arbitration rules
// that keep them from fighting.
//
// Extracted verbatim from src/dashboard/main.js (:5739-5802 the client aggregation,
// :6077-6094 the server derivation, :5685-5734 the severity/label bands). The bar's
// markup, the FAA-program blend and the 🏠 marker stay in renderHubHealthBar().

/** Fixed left-to-right order of the hub-health bar. */
export const HUB_ORDER = ['ORD','DEN','IAH','EWR','SFO','IAD','LAX','NRT','GUM'];

/** A row counts as having operated only in these three classifier states. */
const OPERATED_KEYS = new Set(['departed', 'enroute', 'landed']);

/** On-time window: a departure within 30 minutes of schedule still counts. */
const ON_TIME_GRACE_SECONDS = 1800;

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
 * The trailing network-wide chip: average of the hubs that have a reading.
 * @param {number[]} pcts
 * @returns {{avg: number, label: string, color: string}|null} null when no hub has a reading.
 */
export function networkLabel(pcts) {
  if (!pcts || !pcts.length) return null;
  const avg = Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length);
  return {
    avg,
    label: avg > 70 ? 'Smooth Ops' : avg >= 50 ? 'Some Delays' : 'Rough Day',
    color: avg > 70 ? '#22c55e' : avg >= 50 ? '#f59e0b' : '#ef4444',
  };
}
