// ═══ AIRBORNE HISTORY — the Live tab's 24-hour "Airborne" graph ═══
// Everything between `/api/airborne-history`'s rows and the SVG: the `?hours=` contract the API
// enforces, how a series is split at gaps, what the empty/partial/stale states are, and the chart
// geometry (paths, ticks, the hover lookup). The TSX only maps these numbers onto elements.
//
// Two honesty rules are encoded here and must survive any redesign:
//  - A GAP IS A BREAK, NEVER A ZERO. The sampler writes nothing on a failed feed read, so the rows
//    simply stop; the line is split wherever two consecutive samples are more than GAP_MS apart
//    and is never drawn down to the axis. One missed 5-minute read (10 min between samples) is
//    bridged — the free feed's meta-only glitch would otherwise shred the line — two or more is
//    drawn as a break.
//  - THE WINDOW IS ALWAYS THE FULL WINDOW. With 90 minutes of data the 24-hour chart shows 90
//    minutes of line at its right edge and says "Collecting since …", rather than stretching
//    90 minutes across the width and letting it pass for a day.

import { niceStep } from './starlink-chart.js';

export const SAMPLE_INTERVAL_MS = 5 * 60_000;
/** More than this between two samples is drawn as a break (≥ 2 consecutive missed reads). */
export const GAP_MS = 12.5 * 60_000;
export const DEFAULT_HISTORY_HOURS = 24;
export const MIN_HISTORY_HOURS = 1;
export const MAX_HISTORY_HOURS = 168;
/** Under this much history the dialog leads with "the graph fills in as data arrives". */
export const PARTIAL_HISTORY_MS = 2 * 3600_000;
/** A latest sample older than this means the sampler is behind; the dialog says so. */
export const STALE_SAMPLE_MS = 15 * 60_000;

/**
 * `?hours=` for GET /api/airborne-history. Absent/blank → the default; a number (a repeated param
 * uses its first value) is rounded and clamped to [1, 168]; anything else is garbage → ok:false,
 * which the API answers with a 400.
 *
 * @param {unknown} raw  `req.query.hours`.
 * @returns {{ok: true, hours: number} | {ok: false}}
 */
export function parseHistoryHours(raw) {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (v === undefined || v === null) return { ok: true, hours: DEFAULT_HISTORY_HOURS };
  if (typeof v !== 'string' && typeof v !== 'number') return { ok: false };
  const s = String(v).trim();
  if (s === '') return { ok: true, hours: DEFAULT_HISTORY_HOURS };
  if (!/^-?\d+(\.\d+)?$/.test(s)) return { ok: false };
  const n = Number(s);
  if (!Number.isFinite(n)) return { ok: false };
  return { ok: true, hours: Math.min(MAX_HISTORY_HOURS, Math.max(MIN_HISTORY_HOURS, Math.round(n))) };
}

/**
 * API rows → points the chart can use: epoch-ms `t`, finite non-negative counts, ascending, one
 * per timestamp. Anything malformed is dropped rather than drawn as a zero.
 *
 * @param {Array<{t: string, airborne: number, express?: number|null}>} samples
 * @returns {Array<{t: number, airborne: number, express: number|null}>}
 */
export function normalizeSamples(samples) {
  const byT = new Map();
  for (const s of Array.isArray(samples) ? samples : []) {
    const t = Date.parse(s && s.t);
    // `Number(null)` is 0: a null count must be dropped, not drawn as an empty sky.
    const airborne = s && s.airborne != null && s.airborne !== '' ? Number(s.airborne) : NaN;
    if (!Number.isFinite(t) || !Number.isFinite(airborne) || airborne < 0) continue;
    const express = s.express == null ? null : Number(s.express);
    byT.set(t, { t, airborne, express: Number.isFinite(express) && express >= 0 ? express : null });
  }
  return [...byT.values()].sort((a, b) => a.t - b.t);
}

/**
 * Split an ascending series wherever consecutive points are more than `gapMs` apart.
 * @template {{t: number}} P
 * @param {P[]} points
 * @param {number} [gapMs]
 * @returns {P[][]}
 */
export function splitAtGaps(points, gapMs = GAP_MS) {
  const runs = [];
  let run = [];
  for (const p of points || []) {
    if (run.length && p.t - run[run.length - 1].t > gapMs) {
      runs.push(run);
      run = [];
    }
    run.push(p);
  }
  if (run.length) runs.push(run);
  return runs;
}

/**
 * What the dialog has to say about the data it is showing.
 *
 * - `empty`: no samples in the window (launch day, or the history read failed).
 * - `partial`: the first sample is well inside the window — the table is younger than it.
 *   `young` marks the first ~2 hours, when the line is only a stub at the right edge.
 * - `full`: samples reach back to the window's start.
 * `stale` (any state but empty): the newest sample is more than STALE_SAMPLE_MS older than
 * `asOfMs` — the response's `generatedAt`, i.e. the SERVER's clock at read time. Measured against the
 * viewer's clock instead, an ordinary CDN-cached body (up to 15 min old with s-maxage + SWR) would
 * read as a sampler outage.
 *
 * @param {Array<{t: number}>} points  normalized, ascending.
 * @param {number} nowMs  the window's right edge (the viewer's clock).
 * @param {number} [hours]
 * @param {{asOfMs?: number}} [opts]
 */
export function historyCoverage(points, nowMs, hours = DEFAULT_HISTORY_HOURS, { asOfMs } = {}) {
  const windowStart = nowMs - hours * 3600_000;
  const inWindow = (points || []).filter((p) => p.t >= windowStart && p.t <= nowMs + 60_000);
  if (inWindow.length === 0) {
    return { state: 'empty', since: null, latest: null, young: false, stale: false, gaps: 0 };
  }
  const first = inWindow[0];
  const latest = inWindow[inWindow.length - 1];
  // Within ~3 sample intervals of the window start counts as reaching it.
  const partial = first.t - windowStart > 3 * SAMPLE_INTERVAL_MS;
  return {
    state: partial ? 'partial' : 'full',
    since: first.t,
    latest,
    young: latest.t - first.t < PARTIAL_HISTORY_MS,
    stale: (Number.isFinite(asOfMs) ? asOfMs : nowMs) - latest.t > STALE_SAMPLE_MS,
    gaps: splitAtGaps(inWindow).length - 1,
  };
}

// ── Time labels ──────────────────────────────────────────────────────────────────────────────

const fmtCache = new Map();
function formatter(locale, options) {
  const key = JSON.stringify([locale ?? null, options]);
  let f = fmtCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, options);
    fmtCache.set(key, f);
  }
  return f;
}

function localHourMinute(ms, timeZone) {
  const parts = formatter('en-US', { timeZone, hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(ms);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value) % 24;
  const minute = Number(parts.find((p) => p.type === 'minute')?.value);
  return { hour, minute };
}

/**
 * A sample's time for the readout: "Sun 3:05 PM" in the viewer's zone (or `timeZone`).
 * @param {number} ms
 * @param {{timeZone?: string, locale?: string}} [opts]
 */
export function formatSampleTime(ms, { timeZone, locale } = {}) {
  return formatter(locale, { timeZone, weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(ms);
}

/**
 * The zone the axis is drawn in, for the caption: "CDT", or the GMT offset where the runtime has
 * no abbreviation.
 * @param {number} ms
 * @param {{timeZone?: string, locale?: string}} [opts]
 */
export function zoneLabel(ms, { timeZone, locale } = {}) {
  const part = formatter(locale, { timeZone, timeZoneName: 'short' })
    .formatToParts(ms)
    .find((p) => p.type === 'timeZoneName');
  return part ? part.value : '';
}

const TICK_STEPS_H = [1, 2, 3, 6, 12, 24];
const MIN_TICK_SPACING_PX = 46;

/**
 * Hour ticks in the viewer's zone between `startMs` and `endMs`: on whole local hours that are a
 * multiple of the step (local midnight labelled with the weekday). The step is the smallest that
 * keeps labels MIN_TICK_SPACING_PX apart at `plotWidth`. Quarter-hour scanning finds local hour
 * boundaries in half- and quarter-hour zones too.
 */
export function timeTicks(startMs, endMs, plotWidth, { timeZone, locale } = {}) {
  const spanH = (endMs - startMs) / 3600_000;
  if (!(spanH > 0)) return [];
  const stepH =
    TICK_STEPS_H.find((s) => (spanH / s) * MIN_TICK_SPACING_PX <= plotWidth) ?? TICK_STEPS_H[TICK_STEPS_H.length - 1];
  const q = 15 * 60_000;
  const ticks = [];
  for (let t = Math.ceil(startMs / q) * q; t <= endMs; t += q) {
    const { hour, minute } = localHourMinute(t, timeZone);
    if (minute !== 0 || hour % stepH !== 0) continue;
    const midnight = hour === 0;
    ticks.push({
      t,
      midnight,
      label: midnight
        ? formatter(locale, { timeZone, weekday: 'short' }).format(t)
        : formatter(locale, { timeZone, hour: 'numeric' }).format(t),
    });
  }
  return ticks;
}

// ── Geometry ─────────────────────────────────────────────────────────────────────────────────

export const CHART_PADDING = { left: 40, right: 14, top: 10, bottom: 22 };

function niceTop(max, count) {
  const step = niceStep(max, count);
  return { step, top: Math.max(step, Math.ceil(max / step - 1e-9) * step) };
}

function pathOf(points) {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
}

/**
 * Everything the big chart draws, in pixel units of a `width` × `height` SVG (the component
 * measures its container, so labels stay real-size on a phone).
 *
 * The y axis starts at 0: the overnight trough is a real fraction of the midday peak, and a
 * cropped axis would turn ordinary 5-minute noise into cliffs.
 *
 * @param {Array<{t: string, airborne: number, express?: number|null}>} samples  API rows.
 * @param {{nowMs: number, hours?: number, width: number, height: number, timeZone?: string, locale?: string}} opts
 */
export function buildAirborneChart(samples, { nowMs, hours = DEFAULT_HISTORY_HOURS, width, height, timeZone, locale }) {
  const pad = CHART_PADDING;
  const left = pad.left;
  const right = Math.max(left + 10, width - pad.right);
  const top = pad.top;
  const bottom = Math.max(top + 10, height - pad.bottom);
  const windowStart = nowMs - hours * 3600_000;
  const windowEnd = nowMs;

  const all = normalizeSamples(samples).filter((p) => p.t >= windowStart && p.t <= windowEnd + 60_000);
  const max = all.reduce((m, p) => Math.max(m, p.airborne), 0);
  const { step, top: yTop } = niceTop(max > 0 ? max : 800, 4);

  const xOf = (t) => left + ((Math.min(t, windowEnd) - windowStart) / (windowEnd - windowStart)) * (right - left);
  const yOf = (v) => bottom - (v / yTop) * (bottom - top);

  const points = all.map((p) => ({ ...p, x: xOf(p.t), y: yOf(p.airborne) }));
  const runs = splitAtGaps(points);
  const segments = runs.filter((r) => r.length > 1).map((r) => ({ path: pathOf(r), from: r[0].t, to: r[r.length - 1].t }));
  // A lone reading between two gaps has no neighbour to draw a line to; it is still data.
  const dots = runs.filter((r) => r.length === 1).map((r) => ({ cx: r[0].x, cy: r[0].y, t: r[0].t }));
  const gaps = [];
  for (let i = 1; i < runs.length; i++) {
    const a = runs[i - 1][runs[i - 1].length - 1];
    const b = runs[i][0];
    gaps.push({ x0: a.x, x1: b.x, from: a.t, to: b.t });
  }

  const yTicks = [];
  for (let v = 0; v <= yTop + 1e-9; v += step) {
    yTicks.push({ value: v, y: yOf(v), label: Math.round(v).toLocaleString('en-US') });
  }
  const xTicks = timeTicks(windowStart, windowEnd, right - left, { timeZone, locale }).map((tick) => ({
    ...tick,
    x: xOf(tick.t),
  }));

  return {
    width,
    height,
    plot: { left, right, top, bottom },
    windowStart,
    windowEnd,
    yTop,
    yTicks,
    xTicks,
    points,
    segments,
    dots,
    gaps,
    // The not-yet-collected stretch at the left of a young table, labelled rather than blank.
    uncollected: points.length && points[0].t - windowStart > 3 * SAMPLE_INTERVAL_MS
      ? { x0: left, x1: points[0].x }
      : null,
  };
}

/**
 * Index of the point nearest to `x` (binary search over the ascending x's); -1 when empty.
 * @param {Array<{x: number}>} points
 * @param {number} x
 */
export function nearestPointIndex(points, x) {
  if (!points || points.length === 0 || !Number.isFinite(x)) return -1;
  let lo = 0;
  let hi = points.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid].x < x) lo = mid;
    else hi = mid;
  }
  return Math.abs(points[lo].x - x) <= Math.abs(points[hi].x - x) ? lo : hi;
}

/**
 * The inline sparkline beside the stat: the last `hours` of data drawn over its OWN extent
 * (min..max on both axes) so its shape reads at 64 × 18 px. Gaps break it the same way.
 * Null until there are at least two samples 30 minutes apart — before that there is no shape
 * to show, and the control shows its icon instead.
 *
 * @param {Array<{t: string, airborne: number}>} samples
 * @param {{nowMs: number, hours?: number, width: number, height: number}} opts
 * @returns {{segments: string[], dots: Array<{cx: number, cy: number}>, last: {cx: number, cy: number}}|null}
 */
export function buildSparkline(samples, { nowMs, hours = DEFAULT_HISTORY_HOURS, width, height }) {
  const windowStart = nowMs - hours * 3600_000;
  const pts = normalizeSamples(samples).filter((p) => p.t >= windowStart && p.t <= nowMs + 60_000);
  if (pts.length < 2 || pts[pts.length - 1].t - pts[0].t < 30 * 60_000) return null;
  const t0 = pts[0].t;
  const t1 = pts[pts.length - 1].t;
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of pts) {
    lo = Math.min(lo, p.airborne);
    hi = Math.max(hi, p.airborne);
  }
  const inset = 1.5; // keeps a 1.5 px stroke inside the box at the extremes
  const span = hi - lo || 1;
  const placed = pts.map((p) => ({
    ...p,
    x: inset + ((p.t - t0) / (t1 - t0)) * (width - 2 * inset),
    y: hi === lo ? height / 2 : inset + (1 - (p.airborne - lo) / span) * (height - 2 * inset),
  }));
  const runs = splitAtGaps(placed);
  const last = placed[placed.length - 1];
  return {
    segments: runs.filter((r) => r.length > 1).map(pathOf),
    dots: runs.filter((r) => r.length === 1).map((r) => ({ cx: r[0].x, cy: r[0].y })),
    last: { cx: last.x, cy: last.y },
  };
}

/**
 * One sentence for the chart's accessible name: the low, the high and the latest reading.
 * @param {Array<{t: number, airborne: number}>} points  normalized.
 * @param {{timeZone?: string, locale?: string}} [opts]
 */
export function describeHistory(points, opts = {}) {
  if (!points || points.length === 0) return 'No samples yet.';
  let low = points[0];
  let high = points[0];
  for (const p of points) {
    if (p.airborne < low.airborne) low = p;
    if (p.airborne > high.airborne) high = p;
  }
  const latest = points[points.length - 1];
  const at = (p) => `${p.airborne.toLocaleString('en-US')} at ${formatSampleTime(p.t, opts)}`;
  return `Low ${at(low)}, high ${at(high)}, latest ${at(latest)}.`;
}
