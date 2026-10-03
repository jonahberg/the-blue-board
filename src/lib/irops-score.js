// Client-fallback IROPS severity engine: the F017 weighted score, the
// score→label/class thresholds, and the small-sample rate floor. Both updateIrops
// (client fallback) and renderIropsFromAPI (server path) import these so the
// <20/<40 thresholds live in exactly one place and cannot silently drift apart.

// F007/F015: a cancellation RATE from a tiny sample is a lie — one cancelled GUM
// flight on a 4-flight board is not a "25% cancellation rate". Only publish a rate
// when total >= 10 OR cancellations >= 3; below the floor, expose raw counts only.
export function iropsRateFloor(total, cancellations) {
  return total >= 10 || cancellations >= 3;
}

// F017: weight each flight once — 60m+ delays are ×2, the exclusive 30–60m bucket is
// ×1 (a 61-min delay must not score 1+2=3, i.e. as much as a cancellation). delayed30
// stays cumulative so the caller's ">30m" card remains truthful.
export function iropsScore({ cancellations = 0, delayed60 = 0, delayed30 = 0, diversions = 0, total = 0 } = {}) {
  if (!(total > 0)) return 0;
  const delayed30to60 = Math.max(0, delayed30 - delayed60);
  return ((cancellations * 3 + delayed60 * 2 + delayed30to60 + diversions * 2) / total * 100).toFixed(1);
}

// F007/F015 applied: turn /api/irops `hubMetrics` into the per-hub descriptor the
// delay-risk engine reads (`originIrops`/`destinationIrops`). Extracted verbatim from
// src/dashboard/main.js renderIropsFromAPI's hubMetrics loop.
//
// Counts are ALWAYS published (a consumer can still say "1 of 4 cancelled"); the two
// RATES are null below the floor, so every rate threshold downstream degrades to
// "signal omitted" rather than to a zero or a small-sample spike.
//
// @param {Record<string, {total?: number, cancellations?: number, delayed60?: number}>} hubMetrics
// @returns {Record<string, {cancellations: number, total: number, cancellationRate: number|null, delayed60Rate: number|null}>}
export function iropsHubRates(hubMetrics) {
  const byHub = {};
  for (const [hub, m] of Object.entries(hubMetrics || {})) {
    if (!m || !(m.total > 0)) continue;
    const cancellations = m.cancellations || 0;
    const hasRateFloor = iropsRateFloor(m.total, cancellations);
    byHub[hub] = {
      cancellations,
      total: m.total,
      cancellationRate: hasRateFloor ? Math.round((cancellations / m.total) * 100) : null,
      delayed60Rate: hasRateFloor ? Math.round(((m.delayed60 || 0) / m.total) * 100) : null,
    };
  }
  return byHub;
}

// ── The bands (v1.12.0, Oct 3 2026; were <5 / <15 since Jul 2026) ──
// The old cutoffs were picked before the index measured delay at the gate and before "Likely
// Canceled" flights the live feed saw fly were dropped from it; on the corrected index every
// recent day still read SIGNIFICANT. Full-day departure scores, uncertain-but-seen-flying removed:
//
//   day            D15 on-time   score    old band       new band
//   Sat Oct 3      calm          ≈ 18     SIGNIFICANT    NORMAL
//   Wed Sep 30     66%           ≈ 23–27  SIGNIFICANT    MINOR
//   Fri Oct 2      57%           ≈ 32–35  SIGNIFICANT    MINOR
//   Thu Oct 1      46%           ≈ 34–38  SIGNIFICANT    MINOR
//   Fri Jul 3      meltdown      56.7     SIGNIFICANT    SIGNIFICANT   (151 cancels, 17 ground stops)
//
// Owner-approved. Four ordinary days and one meltdown is a thin base: recheck against the first
// real weather day (docs/specs/irops-delay-measurement.md). The index is one input to the network
// status — a ground stop, a closure or a hub under 50% on-time still reads "Disrupted" whatever it
// says (src/lib/ops-health.js networkStatus).
export const IROPS_MINOR_AT = 20;
export const IROPS_SIGNIFICANT_AT = 40;

/** The bands in words, for the explainer tooltips — built from the constants so copy cannot drift. */
export const IROPS_BANDS_TEXT =
  `Normal under ${IROPS_MINOR_AT} · Minor ${IROPS_MINOR_AT}–${IROPS_SIGNIFICANT_AT} · Significant ${IROPS_SIGNIFICANT_AT}+`;

export function iropsScoreCls(score) {
  return score < IROPS_MINOR_AT ? 'low' : score < IROPS_SIGNIFICANT_AT ? 'med' : 'high';
}

export function iropsScoreLabel(score) {
  return score < IROPS_MINOR_AT
    ? 'NORMAL OPERATIONS'
    : score < IROPS_SIGNIFICANT_AT ? 'MINOR DISRUPTION' : 'SIGNIFICANT DISRUPTION';
}
