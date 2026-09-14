import { describe, it, expect } from 'vitest';

import {
  CHART_GEOMETRY,
  STARLINK_CHART_COLORS,
  buildVelocityChart,
  formatChartMonth,
  velocityCap,
  velocityFootnote,
} from '../src/lib/starlink-chart.js';
import { bucketInstallsByMonth } from '../src/lib/starlink-utils.js';

/** A month row in the shape `bucketInstallsByMonth()` emits. */
function month(ym, label, express, mainline, cumulative) {
  return { ym, label, express, mainline, total: express + mainline, cumulative };
}

describe('formatChartMonth', () => {
  it('expands a YYYY-MM key to MON YYYY', () => {
    expect(formatChartMonth('2025-12')).toBe('DEC 2025');
    expect(formatChartMonth('2026-01')).toBe('JAN 2026');
  });

  it('passes an unparseable key through rather than printing undefined', () => {
    expect(formatChartMonth('')).toBe('');
    expect(formatChartMonth('nonsense')).toBe('nonsense');
  });
});

describe('velocityCap', () => {
  it('rounds the tallest month up to the next multiple of 5 when there is no outlier', () => {
    const months = [month('2026-01', 'JAN 26', 5, 2, 7), month('2026-02', 'FEB', 6, 2, 15)];
    expect(velocityCap(months)).toBe(10);
  });

  it('never returns a ceiling below 5', () => {
    expect(velocityCap([month('2026-01', 'JAN 26', 1, 0, 1)])).toBe(5);
    expect(velocityCap([])).toBe(5);
  });

  it('caps at second-biggest × 1.2 when the biggest month more than doubles it', () => {
    const months = [
      month('2025-11', 'NOV', 8, 2, 10),
      month('2025-12', 'DEC', 100, 17, 127),
      month('2026-01', 'JAN 26', 6, 4, 137),
    ];
    // second biggest = 10 → 10 * 1.2 = 12 → rounded up to 15
    expect(velocityCap(months)).toBe(15);
  });

  it('does not apply the outlier rule to a two-month series', () => {
    const months = [month('2025-12', 'DEC 25', 100, 0, 100), month('2026-01', 'JAN 26', 1, 0, 101)];
    expect(velocityCap(months)).toBe(100);
  });
});

describe('velocityFootnote', () => {
  it('is empty when nothing was capped or undated', () => {
    expect(velocityFootnote([], 0)).toBe('');
  });

  it('names every capped month and its true total', () => {
    const note = velocityFootnote([{ ym: '2026-03', label: 'MAR', total: 44 }], 0);
    expect(note).toBe('* MAR: 44 (exceeds chart scale)');
  });

  it('carries the hardcoded Dec 2025 tracker catch-up context', () => {
    const note = velocityFootnote([{ ym: '2025-12', label: 'DEC', total: 127 }], 0);
    expect(note).toContain('117-aircraft tracker catch-up batch on Dec 3');
  });

  it('reports undated aircraft and joins notes with a middot', () => {
    const note = velocityFootnote([{ ym: '2025-12', label: 'DEC', total: 127 }], 6);
    expect(note).toContain(' · 6 aircraft have no recorded install date');
  });

  it('tolerates a null capped list', () => {
    expect(velocityFootnote(null, 3)).toBe('3 aircraft have no recorded install date');
  });
});

describe('buildVelocityChart', () => {
  const months = [
    month('2025-10', 'OCT 25', 4, 1, 5),
    month('2025-11', 'NOV', 6, 2, 13),
    month('2025-12', 'DEC', 100, 17, 130),
    month('2026-01', 'JAN 26', 7, 1, 138),
  ];

  it('returns null for an empty series so the card can hide entirely', () => {
    expect(buildVelocityChart([], 0)).toBeNull();
    expect(buildVelocityChart(null, 0)).toBeNull();
  });

  it('keeps the shipped viewBox geometry', () => {
    const chart = buildVelocityChart(months, 0);
    expect(chart.width).toBe(CHART_GEOMETRY.W);
    expect(chart.height).toBe(CHART_GEOMETRY.H);
    expect(chart.gridLeft).toBe(40);
    expect(chart.gridRight).toBe(940 - 46);
  });

  it('emits one bar per month, left to right inside the plot area', () => {
    const chart = buildVelocityChart(months, 0);
    expect(chart.bars).toHaveLength(4);
    const xs = chart.bars.map((b) => b.x);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    expect(chart.bars[0].x).toBeGreaterThanOrEqual(40);
    expect(chart.bars[3].x + chart.bars[3].width).toBeLessThanOrEqual(940 - 46);
  });

  it('marks the outlier month capped, with a zig-zag break and an N* label', () => {
    const chart = buildVelocityChart(months, 0);
    const dec = chart.bars.find((b) => b.ym === '2025-12');
    expect(dec.capped).toBe(true);
    expect(dec.zigzag).toMatch(/^M [\d.-]+ 26( l 4 -5 l 4 5)+$/);
    expect(dec.countLabel.text).toBe('117*');
    expect(chart.cappedMonths.map((m) => m.ym)).toEqual(['2025-12']);
  });

  it('never draws a capped bar taller than the axis ceiling', () => {
    const chart = buildVelocityChart(months, 0);
    const dec = chart.bars.find((b) => b.ym === '2025-12');
    const drawn = dec.expressRect.height + dec.mainlineRect.height;
    const plotHeight = CHART_GEOMETRY.H - CHART_GEOMETRY.padT - CHART_GEOMETRY.padB;
    expect(drawn).toBeCloseTo(plotHeight, 6);
    // and the split inside the cap stays proportional to the real one
    expect(dec.expressRect.height / drawn).toBeCloseTo(100 / 117, 6);
  });

  it('prints an uncapped month total above its bar', () => {
    const chart = buildVelocityChart(months, 0);
    const nov = chart.bars.find((b) => b.ym === '2025-11');
    expect(nov.capped).toBe(false);
    expect(nov.countLabel.text).toBe('8');
  });

  it('omits the count label for a zero month but keeps the slot', () => {
    const chart = buildVelocityChart([...months, month('2026-02', 'FEB', 0, 0, 138)], 0);
    const feb = chart.bars.find((b) => b.ym === '2026-02');
    expect(feb.countLabel).toBeNull();
    expect(feb.expressRect).toBeNull();
    expect(feb.mainlineRect).toBeNull();
  });

  it('labels every month while the series is 18 wide or narrower', () => {
    const chart = buildVelocityChart(months, 0);
    expect(chart.bars.every((b) => b.monthLabel !== null)).toBe(true);
  });

  it('thins month labels past 18 but always keeps the ones carrying a year', () => {
    const dense = [];
    for (let i = 0; i < 25; i++) {
      const ym = `2025-${String((i % 12) + 1).padStart(2, '0')}`;
      // Only index 5 carries a year, mimicking a January in the middle of the run.
      dense.push(month(ym, i === 5 ? 'JUN 25' : 'JUN', 1, 0, i + 1));
    }
    const chart = buildVelocityChart(dense, 0);
    expect(chart.bars.filter((b) => b.monthLabel).length).toBeLessThan(25);
    expect(chart.bars[5].monthLabel).not.toBeNull();
    expect(chart.bars[7].monthLabel).toBeNull();
  });

  it('scales the cumulative line on its own right axis, ending at the top', () => {
    const chart = buildVelocityChart(months, 0);
    expect(chart.maxCum).toBe(138);
    expect(chart.linePath.startsWith('M')).toBe(true);
    expect(chart.dots).toHaveLength(4);
    expect(chart.dots[3].cy).toBeCloseTo(CHART_GEOMETRY.padT, 6);
    expect(chart.endValue.text).toBe(138);
    expect(chart.rightTicks.map((t) => t.value)).toEqual([0, 35, 69, 104, 138]);
  });

  it('emits four left-axis ticks from zero to the cap', () => {
    const chart = buildVelocityChart(months, 0);
    expect(chart.leftTicks[0].value).toBe(0);
    expect(chart.leftTicks[3].value).toBe(chart.cap);
    expect(chart.leftTicks[0].y).toBeGreaterThan(chart.leftTicks[3].y);
  });

  it('states the covered range in the subtitle and forwards the footnote', () => {
    const chart = buildVelocityChart(months, 4);
    expect(chart.subtitle).toBe('Aircraft equipped per month · OCT 2025 – JAN 2026');
    expect(chart.footnote).toContain('117-aircraft tracker catch-up batch');
    expect(chart.footnote).toContain('4 aircraft have no recorded install date');
  });

  it('consumes bucketInstallsByMonth output end to end', () => {
    const aircraft = [
      { tail: 'N1', dateFound: '2026-01-04', fleet: 'Express' },
      { tail: 'N2', dateFound: '2026-01-19', fleet: 'Mainline' },
      { tail: 'N3', dateFound: '2026-02-02', fleet: 'Express' },
      { tail: 'N4', dateFound: '', fleet: 'Express' },
    ];
    const bucketed = bucketInstallsByMonth(aircraft, new Date('2026-02-15T00:00:00Z'));
    const chart = buildVelocityChart(bucketed.months, bucketed.undated);
    expect(chart.bars).toHaveLength(2);
    expect(chart.maxCum).toBe(3);
    expect(chart.footnote).toBe('1 aircraft have no recorded install date');
  });
});

describe('STARLINK_CHART_COLORS', () => {
  it('carries the three series colours as hex so no TSX has to', () => {
    expect(STARLINK_CHART_COLORS.express).toMatch(/^#[0-9A-F]{6}$/i);
    expect(STARLINK_CHART_COLORS.mainline).toMatch(/^#[0-9A-F]{6}$/i);
    expect(STARLINK_CHART_COLORS.cumulative).toMatch(/^#[0-9A-F]{6}$/i);
  });
});
