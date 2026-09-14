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

import { RISK_BANDS } from './delay-risk.js';

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
  const body = {
    flight: context.flight,
    route: context.route,
    status: context.status,
    riskLabel: context.riskLabel,
    factors: asFactors(context.factors ?? context.riskFactors),
    hub: context.hub,
    otp: asOtp(context.otp),
    weather: asWeather(context.weather),
    destWeather: asWeather(context.destWeather),
    faaStatus: context.faaStatus,
    inbound: context.inbound,
    irops: asIrops(context.irops),
    hubTime: context.hubTime,
    connection: context.connection,
  };
  if (Number.isFinite(score)) body.riskScore = score;
  return body;
}
