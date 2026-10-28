// ═══ AI DELAY EXPLANATION — REQUEST BODY ═══
// The exact body POST /api/delay-explain expects, built from whatever context the
// surface that opened the dialog had.
//
// Extracted from src/dashboard/main.js (:7210-7250 fetchDelayExplanation, :4846-4854
// iropsContextStr, :5810 the weather string, :7176-7180 the hub-local clock).
//
// Two callers hand over two different shapes. The shipped dashboard stored context in
// `data-*` attributes, so everything arrived as a STRING — factors pipe-joined, weather
// and IROPS pre-formatted. The rebuilt Schedule board passes live objects instead. Both
// are accepted here rather than forcing either caller to flatten first, because the
// server contract is a set of strings and this is the one place that knows it.

import { RISK_BANDS, liveConditionsApply } from './delay-risk.js';
import { HUB_TZ } from './hubTz.js';

/**
 * The colour for a risk LABEL, straight off the band table the score came from.
 * @param {string|null|undefined} label
 * @returns {string} hex.
 */
export function riskLabelColor(label) {
  const band = RISK_BANDS.find((entry) => entry.label === label);
  return band ? band.color : RISK_BANDS[RISK_BANDS.length - 1].color;
}

/**
 * "3% cancelled, 8% delayed 60min+" — a hub's IROPS reading as a sentence.
 *
 * Below the small-sample floor the rate is withheld and the raw count is reported with
 * the caveat attached, because "50% cancelled" off four flights is a lie.
 *
 * @param {{cancellationRate?: number|null, delayed60Rate?: number|null, cancellations?: number, total?: number}|null|undefined} irops
 * @returns {string} '' when there is nothing worth saying.
 */
export function iropsContextStr(irops) {
  if (!irops) return '';
  if (irops.cancellationRate !== null && irops.cancellationRate !== undefined) {
    return `${irops.cancellationRate}% cancelled, ${irops.delayed60Rate || 0}% delayed 60min+`;
  }
  const cancellations = irops.cancellations || 0;
  if (cancellations > 0) {
    return `${cancellations} of ${irops.total || '?'} cancelled (small sample — rate withheld)`;
  }
  return '';
}

/**
 * "MODERATE: gusts 31kt, ceiling 1200ft" — an ops-impact reading as a sentence.
 * @param {{level?: string, reasons?: string[]}|null|undefined} weather
 * @returns {string}
 */
export function weatherContextStr(weather) {
  if (!weather || !weather.level) return '';
  const reasons = Array.isArray(weather.reasons) ? weather.reasons : [];
  return weather.level + (reasons.length ? `: ${reasons.join(', ')}` : '');
}

/** A string passes through; an ops-impact object is formatted. */
function asWeather(value) {
  if (typeof value === 'string') return value;
  return weatherContextStr(value);
}

/** A string passes through; an IROPS rate object is formatted. */
function asIrops(value) {
  if (typeof value === 'string') return value;
  return iropsContextStr(value);
}

/**
 * On-time percentage as a STRING.
 *
 * `api/delay-explain.ts:89` returns '' for anything that is not a string, so a numeric
 * OTP is silently dropped from the prompt. The shipped dashboard never hit that because
 * its context came out of a `data-` attribute; the rebuilt board passes a real number.
 */
function asOtp(value) {
  if (value === null || value === undefined || value === '') return undefined;
  return typeof value === 'string' ? value : String(value);
}

/**
 * Contributing factors as a list, from either shape.
 * @param {string[]|string|null|undefined} value
 * @returns {string[]}
 */
export function asFactors(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === 'string' && value) return value.split('|').filter(Boolean);
  return [];
}

/**
 * The hub's wall clock at the moment the dialog opened — "04:35 PM local".
 *
 * Computed on OPEN rather than when the badge rendered: "is this a late-evening
 * departure at a hub that is already an hour behind?" is a question about now.
 *
 * @param {string|null|undefined} timeZone  an IANA zone, from `HUB_TZ`.
 * @param {Date} [now]
 * @returns {string} '' when the zone is unknown or the platform rejects it.
 */
export function hubLocalTime(timeZone, now = new Date()) {
  if (!timeZone) return '';
  try {
    return `${now.toLocaleTimeString('en-US', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    })} local`;
  } catch {
    return '';
  }
}

/**
 * The POST body, field for field.
 *
 * F011: `riskScore` reached the shipped builder as a STRING off a `data-` attribute and
 * the server's `typeof === 'number'` check silently zeroed it — so the model was asked
 * to explain a score of 0 while the badge said 78. It is coerced here and OMITTED
 * (never sent as NaN or null) when it does not parse, so the server's own default
 * applies instead of a wrong number.
 *
 * @param {Record<string, unknown>} ctx
 * @returns {Record<string, unknown>}
 */
export function buildDelayExplainBody(ctx) {
  const context = ctx || {};
  const score = Number(context.riskScore);
  // The departure the badge scored (riskTimesForRow / liveConditionsApply): a later day's
  // flight is scored without today's conditions, so the model must not be handed them either —
  // the prompt rules forbid discussing a topic whose line is absent.
  // The same zone the risk model scored the row in (useBoardModel / board-risk.js).
  const timeZone = HUB_TZ[context.hub] || 'America/Chicago';
  const nowMs = Number.isFinite(context.nowMs) ? context.nowMs : Date.now();
  const live = liveConditionsApply(context.scheduledDep, nowMs, timeZone);
  const body = {
    flight: context.flight,
    route: context.route,
    status: context.status,
    riskLabel: context.riskLabel,
    factors: asFactors(context.factors ?? context.riskFactors),
    hub: context.hub,
    // A non-hub origin (an arrivals row from GIG) has no zone here: say UTC rather than print
    // Chicago time as "local".
    scheduled: HUB_TZ[context.hub]
      ? scheduledDepartureLocal(context.scheduledDep, timeZone, nowMs)
      : scheduledDepartureLocal(context.scheduledDep, 'UTC', nowMs, 'UTC'),
    otp: live ? asOtp(context.otp) : undefined,
    weather: live ? asWeather(context.weather) : undefined,
    destWeather: live ? asWeather(context.destWeather) : undefined,
    faaStatus: live ? context.faaStatus : undefined,
    inbound: live ? context.inbound : undefined,
    irops: live ? asIrops(context.irops) : undefined,
    hubTime: context.hubTime,
    connection: context.connection,
  };
  if (Number.isFinite(score)) body.riskScore = score;
  return body;
}

/**
 * "Thu Oct 29, 08:20 local (tomorrow)" — the flight's own scheduled departure in its hub's
 * zone, tagged against the hub's current day, so the model anchors time-of-day on the flight
 * and not on the clock the dialog was opened at.
 *
 * @param {number|string|null|undefined} scheduled  epoch seconds/ms or an ISO string.
 * @param {string} timeZone
 * @param {number} [nowMs]
 * @param {string} [label]  what the zone is called in the text: 'local', or 'UTC' when the
 *   caller had no zone for the airport.
 * @returns {string} '' when the time is unknown or the zone is rejected.
 */
export function scheduledDepartureLocal(scheduled, timeZone, nowMs = Date.now(), label = 'local') {
  const ms = typeof scheduled === 'number' ? (scheduled > 1e12 ? scheduled : scheduled * 1000) : Date.parse(scheduled || '');
  if (!Number.isFinite(ms) || ms <= 0) return '';
  try {
    // Assembled from parts: ICU versions disagree on the joiner ("Thu, Oct 8, 08:20" on Node 24,
    // "Thu, Oct 8 at 08:20" on newer ICU), and h23 avoids the "24:05" midnight quirk.
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-US', {
        timeZone,
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      })
        .formatToParts(new Date(ms))
        .map((part) => [part.type, part.value]),
    );
    const when = `${parts.weekday} ${parts.month} ${parts.day}, ${parts.hour}:${parts.minute}`;
    const dayKey = (t) => new Date(t).toLocaleDateString('en-CA', { timeZone });
    const days = Math.round((Date.parse(dayKey(ms)) - Date.parse(dayKey(nowMs))) / 86400e3);
    const rel = days === 0 ? 'today' : days === 1 ? 'tomorrow' : days === -1 ? 'yesterday' : '';
    return `${when} ${label}${rel ? ` (${rel})` : ''}`;
  } catch {
    return '';
  }
}
