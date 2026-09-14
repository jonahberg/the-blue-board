// ═══ STATS TAB — CHART GEOMETRY AND COLOUR BANDS ═══
// The Stats tab's five panels are drawn from `analytics.js`; everything about HOW they
// are drawn — which colour band a value falls in, how wide a bar is, where a donut slice
// starts — lives here so it is testable without a DOM and so no `#rrggbb` has to be typed
// into a TSX file.
//
// Thresholds are ported verbatim from src/dashboard/main.js (:4112-4266). The colour
// VALUES are not: the legacy sheet's `--ua-*` custom properties do not exist on the
// Tailwind v4 palette, and the phase ramp was re-stepped (see PHASE_COLORS).

/** The bar chart's colour band for a utilisation percentage — main.js :4114. */
export function utilBand(pct) {
  const n = Number(pct) || 0;
  if (n > 60) return 'high';
  if (n > 30) return 'mid';
  if (n > 0) return 'low';
  return 'idle';
}

/**
 * Band → bar fill. `mid` is the product blue, which is decorative here: the bar is
 * always read together with the "N/M  P%" figure beside it.
 */
export const UTIL_BAR_COLOR = {
  high: '#12a06d',
  mid: 'var(--primary)',
  low: '#c2710c',
  idle: 'var(--border)',
};

/**
 * Band → the class on the small figure next to the bar.
 *
 * `mid` deliberately does NOT use the blue. United blue on a panel background measures
 * 2.61:1, which fails text contrast — main.js already made this swap in a comment at
 * :4116 and the same rule applies to the rebuilt palette.
 */
export const UTIL_TEXT_CLASS = {
  high: 'text-emerald-400',
  mid: 'text-amber-400',
  low: 'text-amber-400',
  idle: 'text-muted-foreground',
};

/** Longest bar on the age chart — main.js :4257 `const maxAge = 30`. */
export const AGE_MAX_YEARS = 30;

/** Average-age colour band — main.js :4262. */
export function ageBand(avg) {
  const n = Number(avg) || 0;
  if (n > 20) return 'oldest';
  if (n > 15) return 'older';
  if (n > 8) return 'mid';
  return 'young';
}

export const AGE_BAR_COLOR = {
  oldest: '#dc2f4a',
  older: '#c2710c',
  mid: 'var(--primary)',
  young: '#12a06d',
};

/** Bar width for one average age, clamped to the track — main.js :4265 `avg / maxAge * 100`. */
export function ageBarPct(avg) {
  const n = Number(avg) || 0;
  return Math.max(0, Math.min(100, (n / AGE_MAX_YEARS) * 100));
}

/**
 * Flight-phase ramp, keyed by the phase names `phaseBreakdown()` returns.
 *
 * Re-stepped from the legacy ramp, which shipped THREE blues (`#005DAA` Cruise,
 * `#3b82f6` Climb, `#6366f1` En Route) — adjacent slices a full-colour reader cannot
 * separate, before colour-vision deficiency is considered. These seven pass the
 * categorical checks (lightness band, CVD separation ≥ 8 ΔE, normal-vision floor,
 * 3:1 against the surface) with one deliberate exception: `Ground` is the neutral
 * "not airborne" residual and stays gray by design, the way an "Other" slice does.
 *
 * Identity is never carried by colour alone — every slice has a legend row with a
 * glyph, the phase name, its count and its share, plus the sr-only table below it.
 */
export const PHASE_COLORS = {
  Cruise: '#4f8ef7',
  Climb: '#12a06d',
  Descent: '#c2710c',
  'En Route': '#9061f9',
  Takeoff: '#0e9ba8',
  Approach: '#dc2f4a',
  Ground: '#7a8699',
};

/** Decorative glyph per phase — main.js :4153. Always paired with the phase name. */
export const PHASE_ICONS = {
  Takeoff: '🛫',
  Climb: '↗️',
  Cruise: '✈️',
  'En Route': '✈️',
  Descent: '↘️',
  Approach: '🛬',
  Ground: '🅿️',
};

/** The legend's row order — main.js :4156, independent of the donut's slice order. */
export const PHASE_LEGEND_ORDER = [
  'Cruise',
  'Climb',
  'Descent',
  'En Route',
  'Takeoff',
  'Approach',
  'Ground',
];

/**
 * Donut geometry. r 36 / stroke 12 in a 100×100 viewBox, so the drawn circumference is
 * 2πr ≈ 226.19 — main.js rounds it to 226 and scales one percentage point to 2.26 user
 * units. Both numbers are kept exactly as shipped so the arc lengths are unchanged.
 */
export const DONUT = { cx: 50, cy: 50, r: 36, strokeWidth: 12, circumference: 226, perPercent: 2.26 };

/**
 * Turn a phase histogram into ready-to-render `<circle>` props.
 *
 * @param {Record<string, number>} counts  phase → count.
 * @param {string[]} order  the phases to draw, in slice order (zero-count ones dropped).
 * @param {number} total  the denominator `phaseBreakdown()` already floored at 1.
 * @returns {Array<{phase: string, count: number, pct: number, color: string,
 *   dashArray: string, dashOffset: number}>}
 */
export function donutSegments(counts, order, total) {
  const denominator = total > 0 ? total : 1;
  let offset = 0;
  return order.map((phase) => {
    const count = counts[phase] || 0;
    const pct = (count / denominator) * 100;
    const length = pct * DONUT.perPercent;
    const segment = {
      phase,
      count,
      pct,
      color: PHASE_COLORS[phase] || PHASE_COLORS.Ground,
      dashArray: `${length} ${DONUT.circumference - length}`,
      dashOffset: -offset * DONUT.perPercent,
    };
    offset += pct;
    return segment;
  });
}

/**
 * Heat for one hub-matrix cell — main.js :4212 `Math.max(0.15, v / max)`.
 *
 * The 0.15 floor is what keeps a single flight visible: without it a lone ORD→GUM on a
 * board whose busiest pair carries forty reads as an empty cell.
 *
 * @returns {number} 0 for an empty cell, else an alpha in [0.15, 1].
 */
export function matrixAlpha(value, max) {
  const v = Number(value) || 0;
  if (v <= 0) return 0;
  const ceiling = Number(max) > 0 ? Number(max) : 1;
  return Math.min(1, Math.max(0.15, v / ceiling));
}

/** Bar width for one route row, relative to the busiest — main.js :4237. */
export function routeBarPct(count, maxCount) {
  const top = Number(maxCount) > 0 ? Number(maxCount) : 1;
  return Math.max(0, Math.min(100, (Number(count) || 0) / top * 100));
}
