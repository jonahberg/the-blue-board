// ═══ STARLINK INSTALLATION VELOCITY CHART ═══
// Pure geometry + label maths for the Starlink tab's monthly install chart, extracted from
// src/dashboard/main.js renderSlChart() so the picture is testable and the TSX carries no
// arithmetic. The renderer only maps these numbers onto <rect>/<path>/<text>.
//
// The one judgement call encoded here is the OUTLIER CAP. Upstream's `dateFound` is a
// DETECTION date, and one tracker catch-up batch (117 aircraft on 2025-12-03) dwarfs every
// real month. Plotting it honestly flattens the rest of the series into noise, so when the
// biggest month is more than double the second biggest the bar axis is capped just above the
// second biggest, the offending bar gets a zig-zag break plus an `N*` label, and the footnote
// says what was cut. The cumulative line is never capped — it has its own right axis.

/**
 * Series colours. Hex lives here rather than in the TSX for the same reason
 * FLEET_FAMILY_COLORS does: a chart's encoding is data, and the view layer may not carry raw
 * colour. These are the shipped dashboard's --ua-green / --ua-accent / --ua-amber.
 */
export const STARLINK_CHART_COLORS = {
  express: '#22C55E',
  mainline: '#6BAAED',
  cumulative: '#C4A35A',
  /** United's own row in the industry strip; competitors render muted. */
  ua: '#C4A35A',
};

const MONTH_LABELS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** viewBox geometry — fixed, so the SVG scales as one unit at every viewport width. */
export const CHART_GEOMETRY = { W: 940, H: 280, padL: 40, padR: 46, padT: 18, padB: 34 };

/** 'YYYY-MM' → 'MAR 2025'. */
export function formatChartMonth(ym) {
  const [y, mo] = String(ym || '').split('-');
  const label = MONTH_LABELS[Number(mo) - 1];
  return label ? `${label} ${y}` : String(ym || '');
}

/**
 * Bar-axis ceiling for a month series.
 *
 * @param {Array<{total: number}>} months
 * @returns {number} always a multiple of 5, never below 5.
 */
export function velocityCap(months) {
  const sorted = months.map((m) => m.total).sort((a, b) => b - a);
  const maxT = sorted[0] || 0;
  const secondT = sorted[1] || 0;
  const hasOutlier = months.length > 2 && maxT > 2 * secondT;
  return Math.max(5, Math.ceil((hasOutlier ? secondT * 1.2 : maxT) / 5) * 5);
}

/** The jagged "axis break" drawn across a capped bar's top. */
function zigzagPath(x, bw, padT) {
  let d = `M ${x - 2} ${padT + 8}`;
  for (let z = 0; z < Math.ceil((bw + 4) / 8); z++) d += ' l 4 -5 l 4 5';
  return d;
}

/**
 * Footnote line for a capped and/or undated chart. Empty string when there is nothing to say.
 *
 * @param {Array<{ym: string, label: string, total: number}>} cappedMonths
 * @param {number} undated aircraft with no parseable install date
 */
export function velocityFootnote(cappedMonths, undated) {
  const notes = [];
  for (const d of cappedMonths || []) {
    let note = `* ${d.label}: ${d.total} (exceeds chart scale)`;
    // The one hardcoded fact on this chart: Dec 2025 is a tracker backfill, not a build rate.
    if (d.ym === '2025-12') note += ' — includes a 117-aircraft tracker catch-up batch on Dec 3';
    notes.push(note);
  }
  if (undated > 0) notes.push(`${undated} aircraft have no recorded install date`);
  return notes.join(' · ');
}

/**
 * Everything the velocity chart renderer needs, as plain numbers.
 *
 * @param {Array<{ym:string,label:string,express:number,mainline:number,total:number,cumulative:number}>} months
 *        from `bucketInstallsByMonth()` in starlink-utils.js
 * @param {number} [undated]
 * @returns {null|Object} null when there is no series to draw (degraded tier) — the card hides.
 */
export function buildVelocityChart(months, undated = 0) {
  if (!Array.isArray(months) || months.length === 0) return null;

  const { W, H, padL, padR, padT, padB } = CHART_GEOMETRY;
  const cw = W - padL - padR;
  const ch = H - padT - padB;
  const n = months.length;
  const step = cw / n;
  const bw = Math.max(8, Math.floor(step * 0.56));

  const cap = velocityCap(months);
  const maxCum = months[n - 1].cumulative || 1;

  const leftTicks = [0, Math.round(cap / 3), Math.round((cap * 2) / 3), cap].map((value) => ({
    value,
    y: padT + ch - (value / cap) * ch,
  }));

  const cappedMonths = [];
  const bars = months.map((d, i) => {
    const x = padL + i * step + (step - bw) / 2;
    const isCapped = d.total > cap;
    const visTotal = Math.min(d.total, cap);
    // Inside a capped bar the split stays proportional, so the stack still reads Express-heavy.
    const eVis = isCapped && d.total ? visTotal * (d.express / d.total) : d.express;
    const mVis = visTotal - eVis;
    const eh = (eVis / cap) * ch;
    const mh = (mVis / cap) * ch;
    const yE = padT + ch - eh;
    const yM = yE - mh;
    if (isCapped) cappedMonths.push(d);

    // Dense charts drop every other month label, but a label carrying a year ('JAN 26') is an
    // anchor and always survives — otherwise the axis can lose its year boundaries entirely.
    const showLabel = n <= 18 || d.label.indexOf(' ') !== -1 || i % 2 === 0;

    return {
      ym: d.ym,
      label: d.label,
      total: d.total,
      express: d.express,
      mainline: d.mainline,
      cumulative: d.cumulative,
      x,
      width: bw,
      expressRect: eVis > 0 ? { y: yE, height: eh } : null,
      mainlineRect: mVis > 0 ? { y: yM, height: mh } : null,
      capped: isCapped,
      zigzag: isCapped ? zigzagPath(x, bw, padT) : null,
      countLabel: isCapped
        ? { x: x + bw / 2, y: padT - 6, text: `${d.total}*` }
        : d.total > 0
          ? { x: x + bw / 2, y: padT + ch - (visTotal / cap) * ch - 5, text: String(d.total) }
          : null,
      monthLabel: showLabel ? { x: x + bw / 2, y: H - padB + 16, text: d.label } : null,
    };
  });

  let linePath = '';
  const dots = months.map((d, i) => {
    const cx = padL + i * step + step / 2;
    const cy = padT + ch - (d.cumulative / maxCum) * ch;
    linePath += `${i === 0 ? 'M' : 'L'}${cx} ${cy} `;
    return { cx, cy };
  });

  const rightTicks = [
    0,
    Math.round(maxCum / 4),
    Math.round(maxCum / 2),
    Math.round((maxCum * 3) / 4),
    maxCum,
  ].map((value) => ({ value, y: padT + ch - (value / maxCum) * ch }));

  return {
    width: W,
    height: H,
    gridLeft: padL,
    gridRight: W - padR,
    cap,
    maxCum,
    bars,
    leftTicks,
    rightTicks,
    linePath,
    dots,
    endValue: { x: W - padR - 4, y: padT - 4, text: maxCum },
    subtitle: `Aircraft equipped per month · ${formatChartMonth(months[0].ym)} – ${formatChartMonth(months[n - 1].ym)}`,
    footnote: velocityFootnote(cappedMonths, undated),
    cappedMonths,
  };
}
