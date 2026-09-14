// ═══ STARLINK PREDICTION BADGE ═══
// The "⚡ Starlink likely ~68%" chip on a My Flights card whose tail is not yet known.
//
// Extracted from src/dashboard/main.js (:1434-1487 applyStarlinkPrediction). Two
// distinct signals share one badge and must NOT share one treatment:
//
//   • Tail already resolved  → /api/check-flight is a lookup of THIS airframe. A
//     verified 95% off one observation is a fact, and demoting it to "low data" would
//     contradict the confirmation shown next to it.
//   • No tail yet            → /api/predict-flight is a route base-rate. That is a
//     statistical estimate, and a high percentage off two flights must say so — in
//     WORDS and SHAPE, never colour alone (DESIGN.md).
//
// `confidence: 'predicted'` on a check-flight response means the endpoint had no tail
// either, so it takes the forecast treatment regardless of which caller asked.

/** Below this the base rate is noise, and the badge hides rather than saying "~2%". */
export const STARLINK_MIN_PERCENT = 5;

/** Fewer observations than this is not a sample. */
export const STARLINK_LOW_DATA_OBSERVATIONS = 3;

/**
 * @param {{probability?: number, n_observations?: number, confidence?: string}|null|undefined} data
 * @param {{forecast?: boolean}} [opts]
 * @returns {{hidden: boolean, text: string, tone: 'good'|'warn'|'muted', lowData: boolean, title: string, forecast: boolean}}
 */
export function starlinkPredictionBadge(data, opts = {}) {
  const hidden = {
    hidden: true,
    text: '',
    tone: 'muted',
    lowData: false,
    title: '',
    forecast: false,
  };
  if (!data || data.probability === undefined || data.probability === null) return hidden;

  const forecast = Boolean(opts.forecast) || data.confidence === 'predicted';
  const pct = Math.round((data.probability || 0) * 100);
  if (pct < STARLINK_MIN_PERCENT) return { ...hidden, forecast };

  const observations = data.n_observations || 0;
  const confidence = data.confidence || 'unknown';

  if (!forecast) {
    return {
      hidden: false,
      forecast: false,
      lowData: false,
      tone: pct >= 75 ? 'good' : pct >= 40 ? 'warn' : 'muted',
      text: `⚡ Starlink ~${pct}%`,
      title: `Confidence: ${confidence} (${observations} observations)`,
    };
  }

  const lowData = observations < STARLINK_LOW_DATA_OBSERVATIONS || confidence === 'low';
  return {
    hidden: false,
    forecast: true,
    lowData,
    tone: lowData ? 'muted' : pct >= 75 ? 'good' : pct >= 40 ? 'warn' : 'muted',
    text: `⚡ Starlink likely ~${pct}%${lowData ? ' · low data' : ''}`,
    title: `Statistical estimate from ${observations} past flights · ${confidence} confidence · not a guarantee for this date’s aircraft.`,
  };
}

/**
 * The operational date for a tail-known lookup.
 *
 * `en-CA` emits `YYYY-MM-DD` in the viewer's LOCAL zone, which is the date the flights
 * on screen are operating. `toISOString()` is UTC and would ask about tomorrow for
 * anyone west of UTC after local afternoon.
 *
 * @param {Date} [now]
 * @returns {string}
 */
export function starlinkPredictionDate(now = new Date()) {
  return now.toLocaleDateString('en-CA');
}
