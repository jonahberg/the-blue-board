import { describe, it, expect } from 'vitest';

import {
  AGE_BAR_COLOR,
  AGE_MAX_YEARS,
  DONUT,
  PHASE_COLORS,
  PHASE_ICONS,
  PHASE_LEGEND_ORDER,
  UTIL_BAR_COLOR,
  UTIL_TEXT_CLASS,
  ageBand,
  ageBarPct,
  donutSegments,
  matrixAlpha,
  routeBarPct,
  utilBand,
} from '../src/lib/stats-chart.js';

describe('utilBand — the >60 / >30 / >0 / 0 thresholds (main.js :4114)', () => {
  it('bands on strict greater-than, so 60 is mid and 30 is low', () => {
    expect(utilBand(100)).toBe('high');
    expect(utilBand(61)).toBe('high');
    expect(utilBand(60)).toBe('mid');
    expect(utilBand(31)).toBe('mid');
    expect(utilBand(30)).toBe('low');
    expect(utilBand(1)).toBe('low');
    expect(utilBand(0)).toBe('idle');
  });

  it('treats a missing or unparseable percentage as idle rather than throwing', () => {
    expect(utilBand(undefined)).toBe('idle');
    expect(utilBand(null)).toBe('idle');
    expect(utilBand(Number.NaN)).toBe('idle');
  });

  it('every band has a bar colour and a text class', () => {
    for (const band of ['high', 'mid', 'low', 'idle']) {
      expect(UTIL_BAR_COLOR[band]).toBeTruthy();
      expect(UTIL_TEXT_CLASS[band]).toBeTruthy();
    }
  });

  it('never puts the product blue on the small figure — it fails text contrast', () => {
    // main.js :4116 made exactly this swap. The bar may be blue; the number may not.
    expect(UTIL_BAR_COLOR.mid).toBe('var(--primary)');
    for (const cls of Object.values(UTIL_TEXT_CLASS)) {
      expect(cls).not.toMatch(/primary|blue/);
    }
  });
});

describe('ageBand / ageBarPct — the >20 / >15 / >8 thresholds (main.js :4262)', () => {
  it('bands on strict greater-than', () => {
    expect(ageBand(21)).toBe('oldest');
    expect(ageBand(20)).toBe('older');
    expect(ageBand(16)).toBe('older');
    expect(ageBand(15)).toBe('mid');
    expect(ageBand(9)).toBe('mid');
    expect(ageBand(8)).toBe('young');
    expect(ageBand(0)).toBe('young');
  });

  it('accepts the one-decimal STRING avgAgeByType() returns', () => {
    expect(ageBand('22.4')).toBe('oldest');
    expect(ageBand('3.1')).toBe('young');
  });

  it('scales the bar against a 30-year track and clamps past it', () => {
    expect(AGE_MAX_YEARS).toBe(30);
    expect(ageBarPct(15)).toBe(50);
    expect(ageBarPct('7.5')).toBe(25);
    expect(ageBarPct(0)).toBe(0);
    expect(ageBarPct(45)).toBe(100);
    expect(ageBarPct(-4)).toBe(0);
  });

  it('every band has a bar colour', () => {
    for (const band of ['oldest', 'older', 'mid', 'young']) {
      expect(AGE_BAR_COLOR[band]).toBeTruthy();
    }
  });
});

describe('donutSegments — arc geometry (main.js :4147-4152)', () => {
  it('keeps the shipped geometry: r 36, stroke 12, 226 circumference, 2.26 per point', () => {
    expect(DONUT).toMatchObject({ r: 36, strokeWidth: 12, circumference: 226, perPercent: 2.26 });
  });

  it('lays consecutive slices end to end with no gap and no overlap', () => {
    const counts = { Cruise: 50, Climb: 25, Descent: 25 };
    const segments = donutSegments(counts, ['Cruise', 'Climb', 'Descent'], 100);

    expect(segments.map((s) => s.pct)).toEqual([50, 25, 25]);
    expect(segments[0].dashOffset).toBe(-0);
    expect(segments[1].dashOffset).toBeCloseTo(-50 * 2.26, 6);
    expect(segments[2].dashOffset).toBeCloseTo(-75 * 2.26, 6);

    // dasharray = "<drawn> <gap>", and the pair always sums to the full circumference.
    for (const segment of segments) {
      const [drawn, gap] = segment.dashArray.split(' ').map(Number);
      expect(drawn + gap).toBeCloseTo(226, 6);
      expect(drawn).toBeCloseTo(segment.pct * 2.26, 6);
    }
  });

  it('gives every slice a colour and never divides by zero on an empty feed', () => {
    const segments = donutSegments({ Cruise: 0 }, ['Cruise'], 0);
    expect(segments[0].pct).toBe(0);
    expect(segments[0].color).toBeTruthy();
  });

  it('falls back to the neutral colour for an unknown phase name', () => {
    const segments = donutSegments({ Wormhole: 3 }, ['Wormhole'], 3);
    expect(segments[0].color).toBe(PHASE_COLORS.Ground);
  });
});

describe('the phase ramp carries identity beyond colour', () => {
  it('every legend phase has a colour and a glyph', () => {
    for (const phase of PHASE_LEGEND_ORDER) {
      expect(PHASE_COLORS[phase], `${phase} has no colour`).toBeTruthy();
      expect(PHASE_ICONS[phase], `${phase} has no glyph`).toBeTruthy();
    }
  });

  it('assigns seven distinct hues — the legacy ramp shipped three near-identical blues', () => {
    const hues = PHASE_LEGEND_ORDER.map((phase) => PHASE_COLORS[phase]);
    expect(new Set(hues).size).toBe(hues.length);
    // The exact regression: #005DAA / #3b82f6 / #6366f1 sat next to each other.
    expect(hues).not.toContain('#005DAA');
  });
});

describe('matrixAlpha — hub-matrix cell heat (main.js :4212)', () => {
  it('is 0 for an empty cell so the cell stays transparent', () => {
    expect(matrixAlpha(0, 40)).toBe(0);
    expect(matrixAlpha(undefined, 40)).toBe(0);
  });

  it('floors a non-empty cell at 0.15 so one flight is still visible', () => {
    expect(matrixAlpha(1, 400)).toBe(0.15);
    expect(matrixAlpha(1, 1)).toBe(1);
  });

  it('scales linearly between the floor and the busiest pair', () => {
    expect(matrixAlpha(20, 40)).toBeCloseTo(0.5, 6);
    expect(matrixAlpha(40, 40)).toBe(1);
  });

  it('survives a zero or missing max without producing Infinity', () => {
    expect(matrixAlpha(3, 0)).toBe(1);
    expect(matrixAlpha(3, undefined)).toBe(1);
  });
});

describe('routeBarPct — top-routes bar width (main.js :4237)', () => {
  it('scales against the busiest route', () => {
    expect(routeBarPct(10, 20)).toBe(50);
    expect(routeBarPct(20, 20)).toBe(100);
  });

  it('does not divide by zero on an empty board', () => {
    expect(routeBarPct(0, 0)).toBe(0);
  });
});
