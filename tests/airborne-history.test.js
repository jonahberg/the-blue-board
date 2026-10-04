import { describe, expect, it } from 'vitest';

import {
  GAP_MS,
  buildAirborneChart,
  buildSparkline,
  describeHistory,
  formatSampleTime,
  historyCoverage,
  nearestPointIndex,
  normalizeSamples,
  parseHistoryHours,
  splitAtGaps,
  timeTicks,
  zoneLabel,
} from '../src/lib/airborne-history.js';

const NOW = Date.parse('2026-10-04T20:00:00.000Z'); // 3:00 PM CDT
const MIN = 60_000;
const iso = (ms) => new Date(ms).toISOString();

/** A sample every 5 min from `fromMs` to `toMs`, skipping any time in `skip`. */
function series(fromMs, toMs, { value = (t) => 500, skip = () => false } = {}) {
  const out = [];
  for (let t = fromMs; t <= toMs; t += 5 * MIN) {
    if (!skip(t)) out.push({ t: iso(t), airborne: value(t), express: 100 });
  }
  return out;
}

describe('parseHistoryHours — the API ?hours= contract', () => {
  it('defaults when absent or blank', () => {
    expect(parseHistoryHours(undefined)).toEqual({ ok: true, hours: 24 });
    expect(parseHistoryHours('')).toEqual({ ok: true, hours: 24 });
    expect(parseHistoryHours('  ')).toEqual({ ok: true, hours: 24 });
  });

  it('accepts numbers, rounds, and clamps to 1–168', () => {
    expect(parseHistoryHours('24')).toEqual({ ok: true, hours: 24 });
    expect(parseHistoryHours('6.4')).toEqual({ ok: true, hours: 6 });
    expect(parseHistoryHours('0')).toEqual({ ok: true, hours: 1 });
    expect(parseHistoryHours('-5')).toEqual({ ok: true, hours: 1 });
    expect(parseHistoryHours('9999')).toEqual({ ok: true, hours: 168 });
    expect(parseHistoryHours(48)).toEqual({ ok: true, hours: 48 });
  });

  it('uses the first value of a repeated param', () => {
    expect(parseHistoryHours(['12', '48'])).toEqual({ ok: true, hours: 12 });
  });

  it('rejects garbage', () => {
    for (const bad of ['abc', '24h', '1e3', 'Infinity', 'NaN', '0x10', '12;drop', true, {}]) {
      expect(parseHistoryHours(bad)).toEqual({ ok: false });
    }
  });
});

describe('normalizeSamples', () => {
  it('parses, sorts, dedupes and drops malformed rows (never turns them into zeros)', () => {
    const out = normalizeSamples([
      { t: '2026-10-04T19:10:00Z', airborne: 610, express: 120 },
      { t: '2026-10-04T19:05:00Z', airborne: 600 },
      { t: 'not a time', airborne: 1 },
      { t: '2026-10-04T19:15:00Z', airborne: null },
      { t: '2026-10-04T19:20:00Z', airborne: -3 },
      { t: '2026-10-04T19:10:00Z', airborne: 611, express: 121 },
    ]);
    expect(out.map((p) => p.airborne)).toEqual([600, 611]);
    expect(out[0].express).toBeNull();
    expect(out[1].express).toBe(121);
  });

  it('is [] for a missing body', () => {
    expect(normalizeSamples(undefined)).toEqual([]);
  });
});

describe('splitAtGaps — a gap is a break, never a zero', () => {
  const pts = (mins) => mins.map((m) => ({ t: m * MIN }));

  it('keeps the 5-minute cadence (and its ±1 min jitter) in one run', () => {
    expect(splitAtGaps(pts([0, 5, 10, 16, 20, 24]))).toHaveLength(1);
  });

  it('bridges ONE missed read (10 min) but breaks at two or more (15 min)', () => {
    expect(splitAtGaps(pts([0, 5, 15, 20]))).toHaveLength(1);
    expect(splitAtGaps(pts([0, 5, 20, 25]))).toHaveLength(2);
    expect(GAP_MS).toBeGreaterThan(10 * MIN);
    expect(GAP_MS).toBeLessThan(15 * MIN);
  });

  it('handles empty input', () => {
    expect(splitAtGaps([])).toEqual([]);
  });
});

describe('historyCoverage — the honest empty / partial / full states', () => {
  it('is empty with no samples in the window', () => {
    expect(historyCoverage([], NOW).state).toBe('empty');
    const old = normalizeSamples(series(NOW - 30 * 3600_000, NOW - 25 * 3600_000));
    expect(historyCoverage(old, NOW).state).toBe('empty');
  });

  it('is partial + young with 90 minutes of data, and reports when collection began', () => {
    const pts = normalizeSamples(series(NOW - 90 * MIN, NOW - 2 * MIN));
    const c = historyCoverage(pts, NOW);
    expect(c.state).toBe('partial');
    expect(c.young).toBe(true);
    expect(c.since).toBe(NOW - 90 * MIN);
    expect(c.stale).toBe(false);
  });

  it('is full when samples reach the window start', () => {
    const pts = normalizeSamples(series(NOW - 24 * 3600_000 + 5 * MIN, NOW - 3 * MIN));
    const c = historyCoverage(pts, NOW);
    expect(c.state).toBe('full');
    expect(c.young).toBe(false);
  });

  it('counts gaps and flags a sampler that has fallen behind', () => {
    const pts = normalizeSamples(series(NOW - 5 * 3600_000, NOW - 40 * MIN, {
      skip: (t) => t > NOW - 3 * 3600_000 && t < NOW - 2 * 3600_000,
    }));
    const c = historyCoverage(pts, NOW);
    expect(c.gaps).toBe(1);
    expect(c.stale).toBe(true);
  });

  it('judges staleness on the server clock (generatedAt), not on a CDN-aged body', () => {
    const generatedAt = NOW - 14 * MIN; // a cached body, 14 minutes old
    const pts = normalizeSamples(series(NOW - 5 * 3600_000, generatedAt - 3 * MIN));
    expect(historyCoverage(pts, NOW, 24, { asOfMs: generatedAt }).stale).toBe(false);
    expect(historyCoverage(pts, NOW, 24).stale).toBe(true);
  });
});

describe('timeTicks', () => {
  const opts = { timeZone: 'America/Chicago', locale: 'en-US' };

  it('puts ticks on whole local hours, a multiple of the step, midnight as the weekday', () => {
    const ticks = timeTicks(NOW - 24 * 3600_000, NOW, 900, opts);
    // 900 px fits a 1-hour step? 24 × 46 = 1104 > 900, so 2-hour ticks.
    expect(ticks.map((t) => t.label)).toContain('Sun');
    expect(ticks.find((t) => t.midnight).t).toBe(Date.parse('2026-10-04T05:00:00Z')); // 00:00 CDT
    for (const t of ticks) expect(new Date(t.t).getUTCMinutes()).toBe(0);
    expect(ticks.map((t) => t.label)).toContain('2 PM');
  });

  it('widens the step on a narrow plot so labels never collide', () => {
    const narrow = timeTicks(NOW - 24 * 3600_000, NOW, 300, opts);
    const gaps = narrow.slice(1).map((t, i) => t.t - narrow[i].t);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(6 * 3600_000);
    expect(narrow.length).toBeLessThanOrEqual(5);
  });

  it('finds local hours in a half-hour zone', () => {
    const ticks = timeTicks(NOW - 24 * 3600_000, NOW, 900, { timeZone: 'Asia/Kolkata', locale: 'en-US' });
    expect(ticks.length).toBeGreaterThan(0);
    for (const t of ticks) expect(new Date(t.t).getUTCMinutes()).toBe(30);
  });

  it('formats a sample time and the zone in the viewer zone given', () => {
    expect(formatSampleTime(Date.parse('2026-10-04T20:05:00Z'), opts)).toBe('Sun 3:05 PM');
    expect(zoneLabel(NOW, opts)).toBe('CDT');
  });
});

describe('buildAirborneChart', () => {
  const base = { nowMs: NOW, width: 600, height: 200, timeZone: 'America/Chicago', locale: 'en-US' };

  it('draws a gap as two segments, never as a point on the axis', () => {
    const samples = series(NOW - 6 * 3600_000, NOW - 2 * MIN, {
      value: () => 640,
      skip: (t) => t > NOW - 4 * 3600_000 && t < NOW - 3 * 3600_000,
    });
    const chart = buildAirborneChart(samples, base);
    expect(chart.segments).toHaveLength(2);
    expect(chart.gaps).toHaveLength(1);
    // No vertex anywhere near the zero line.
    const zeroY = chart.plot.bottom;
    for (const p of chart.points) expect(p.y).toBeLessThan(zeroY - 10);
    for (const seg of chart.segments) expect(seg.path).not.toContain(` ${zeroY.toFixed(1)}`);
  });

  it('keeps the full 24-hour window with 90 minutes of data and marks the uncollected stretch', () => {
    const chart = buildAirborneChart(series(NOW - 90 * MIN, NOW - 2 * MIN), base);
    expect(chart.windowEnd - chart.windowStart).toBe(24 * 3600_000);
    // The line lives in the right ~6% of the plot.
    const width = chart.plot.right - chart.plot.left;
    expect(chart.points[0].x).toBeGreaterThan(chart.plot.left + width * 0.9);
    expect(chart.uncollected).toEqual({ x0: chart.plot.left, x1: chart.points[0].x });
  });

  it('has no uncollected stretch once samples reach the window start', () => {
    const chart = buildAirborneChart(series(NOW - 24 * 3600_000, NOW - 2 * MIN), base);
    expect(chart.uncollected).toBeNull();
    expect(chart.segments).toHaveLength(1);
  });

  it('starts the y axis at 0 with round ticks above the peak', () => {
    const chart = buildAirborneChart(series(NOW - 3 * 3600_000, NOW, { value: (t) => (t % (10 * MIN) ? 731 : 702) }), base);
    expect(chart.yTicks[0].value).toBe(0);
    expect(chart.yTop).toBeGreaterThanOrEqual(731);
    expect(chart.yTicks.map((t) => t.value)).toEqual([0, 200, 400, 600, 800]);
  });

  it('draws a lone reading between gaps as a dot', () => {
    const samples = [
      ...series(NOW - 3 * 3600_000, NOW - 2 * 3600_000),
      { t: iso(NOW - 90 * MIN), airborne: 520 },
      ...series(NOW - 60 * MIN, NOW - 5 * MIN),
    ];
    const chart = buildAirborneChart(samples, base);
    expect(chart.dots).toHaveLength(1);
    expect(chart.segments).toHaveLength(2);
  });

  it('renders an empty frame for no data (ticks, no line)', () => {
    const chart = buildAirborneChart([], base);
    expect(chart.points).toEqual([]);
    expect(chart.segments).toEqual([]);
    expect(chart.yTicks.length).toBeGreaterThan(1);
    expect(chart.xTicks.length).toBeGreaterThan(1);
    expect(chart.uncollected).toBeNull();
  });

  it('drops samples outside the window', () => {
    const chart = buildAirborneChart(series(NOW - 30 * 3600_000, NOW), base);
    expect(chart.points[0].t).toBeGreaterThanOrEqual(NOW - 24 * 3600_000);
  });
});

describe('nearestPointIndex', () => {
  const pts = [{ x: 10 }, { x: 20 }, { x: 30 }, { x: 40 }];
  it('finds the nearest by x, clamped to the ends', () => {
    expect(nearestPointIndex(pts, 24)).toBe(1);
    expect(nearestPointIndex(pts, 26)).toBe(2);
    expect(nearestPointIndex(pts, -100)).toBe(0);
    expect(nearestPointIndex(pts, 999)).toBe(3);
  });
  it('is -1 for nothing to find', () => {
    expect(nearestPointIndex([], 5)).toBe(-1);
    expect(nearestPointIndex(pts, NaN)).toBe(-1);
  });
});

describe('buildSparkline', () => {
  const box = { nowMs: NOW, width: 64, height: 18 };

  it('is null until there is a shape to draw', () => {
    expect(buildSparkline([], box)).toBeNull();
    expect(buildSparkline(series(NOW - 10 * MIN, NOW), box)).toBeNull();
  });

  it('fills its own box and breaks at gaps', () => {
    const spark = buildSparkline(series(NOW - 6 * 3600_000, NOW, {
      value: (t) => 300 + ((t / MIN) % 60),
      skip: (t) => t > NOW - 4 * 3600_000 && t < NOW - 3 * 3600_000,
    }), box);
    expect(spark.segments).toHaveLength(2);
    expect(spark.last.cx).toBeCloseTo(64 - 1.5, 5);
    for (const d of spark.segments.join(' ').match(/-?\d+(\.\d+)?/g).map(Number)) {
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThanOrEqual(64);
    }
  });
});

describe('describeHistory', () => {
  it('names the low, the high and the latest', () => {
    const pts = normalizeSamples([
      { t: '2026-10-04T09:05:00Z', airborne: 152 },
      { t: '2026-10-04T18:10:00Z', airborne: 731 },
      { t: '2026-10-04T20:05:00Z', airborne: 702 },
    ]);
    expect(describeHistory(pts, { timeZone: 'America/Chicago', locale: 'en-US' })).toBe(
      'Low 152 at Sun 4:05 AM, high 731 at Sun 1:10 PM, latest 702 at Sun 3:05 PM.',
    );
    expect(describeHistory([])).toBe('No samples yet.');
  });
});
