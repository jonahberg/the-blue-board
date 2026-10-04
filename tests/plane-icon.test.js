import { describe, it, expect } from 'vitest';
import {
  PLANE_COLORS,
  PLANE_LEGEND,
  PLANE_PATH,
  PLANE_SIZES,
  planeIconSpec,
  visibleLegendRows,
} from '../src/lib/plane-icon.js';

describe('planeIconSpec — fill priority', () => {
  it('paints a watched flight green, beating every other treatment', () => {
    expect(planeIconSpec(90, { watched: true }).fill).toBe('#22c55e');
    expect(planeIconSpec(90, { watched: true, starlink: true, longhaul: true, phase: 'Ground' }).fill).toBe('#22c55e');
  });

  it('paints a Starlink aircraft violet, beating long-haul and phase', () => {
    expect(planeIconSpec(90, { starlink: true }).fill).toBe('#A78BFA');
    expect(planeIconSpec(90, { starlink: true, longhaul: true, phase: 'Ground' }).fill).toBe('#A78BFA');
  });

  it('paints a long-haul flight amber, beating phase', () => {
    expect(planeIconSpec(90, { longhaul: true }).fill).toBe('#fbbf24');
    expect(planeIconSpec(90, { longhaul: true, phase: 'Ground' }).fill).toBe('#fbbf24');
  });

  it('falls back to phase colour: slate on the ground, blue in the air', () => {
    expect(planeIconSpec(90, { phase: 'Ground' }).fill).toBe('#64748B');
    expect(planeIconSpec(90, { phase: 'Cruise' }).fill).toBe('#6BAAED');
    expect(planeIconSpec(90, { phase: 'Approach' }).fill).toBe('#6BAAED');
  });

  it('paints an airborne United Express flight foreground white, distinct from every other fill', () => {
    expect(planeIconSpec(90, { express: true, phase: 'Cruise' }).fill).toBe('#FAFAFA');
    expect(planeIconSpec(90, { express: true }).fill).toBe('#FAFAFA');
    const others = [PLANE_COLORS.watched, PLANE_COLORS.starlink, PLANE_COLORS.longhaul, PLANE_COLORS.ground, PLANE_COLORS.airborne];
    expect(others).not.toContain(PLANE_COLORS.express);
  });

  it('ranks Express below watched, Starlink and long-haul', () => {
    expect(planeIconSpec(90, { express: true, watched: true }).fill).toBe(PLANE_COLORS.watched);
    expect(planeIconSpec(90, { express: true, starlink: true }).fill).toBe(PLANE_COLORS.starlink);
    expect(planeIconSpec(90, { express: true, longhaul: true }).fill).toBe(PLANE_COLORS.longhaul);
  });

  it('draws an Express flight on the ground as ground, not as Express', () => {
    expect(planeIconSpec(90, { express: true, phase: 'Ground' }).fill).toBe('#64748B');
    expect(planeIconSpec(90, { express: true, phase: 'Ground' }).size).toBe(10);
  });

  it('treats an unknown or missing phase as airborne (edge case)', () => {
    expect(planeIconSpec(90, {}).fill).toBe('#6BAAED');
    expect(planeIconSpec(90, { phase: undefined }).fill).toBe('#6BAAED');
  });
});

describe('planeIconSpec — size', () => {
  it('is 16 px for watched, 14 px for long-haul, 10 px otherwise', () => {
    expect(planeIconSpec(0, { watched: true }).size).toBe(16);
    expect(planeIconSpec(0, { longhaul: true }).size).toBe(14);
    expect(planeIconSpec(0, {}).size).toBe(10);
  });

  it('lets watched win the size race over long-haul', () => {
    expect(planeIconSpec(0, { watched: true, longhaul: true }).size).toBe(16);
  });

  it('does NOT enlarge a Starlink aircraft (edge case — colour only)', () => {
    expect(planeIconSpec(0, { starlink: true }).size).toBe(10);
  });

  it('draws an airborne Express flight at 85% — regional jets are the small ones', () => {
    expect(planeIconSpec(0, { express: true }).size).toBe(8.5);
    expect(PLANE_SIZES.express / PLANE_SIZES.default).toBeCloseTo(0.85, 5);
  });

  it('keeps the watched and long-haul sizes when they beat Express', () => {
    expect(planeIconSpec(0, { express: true, watched: true }).size).toBe(16);
    expect(planeIconSpec(0, { express: true, longhaul: true }).size).toBe(14);
  });

  it('shrinks a Starlink Express jet too — violet fill, Express size (most Express jets are Starlink)', () => {
    const spec = planeIconSpec(0, { express: true, starlink: true, phase: 'Cruise' });
    expect(spec.fill).toBe(PLANE_COLORS.starlink);
    expect(spec.size).toBe(PLANE_SIZES.express);
    // …and stays apart from a mainline Starlink aircraft in the icon cache.
    expect(spec.key).not.toBe(planeIconSpec(0, { starlink: true, phase: 'Cruise' }).key);
  });

  it('keeps a Starlink Express jet on the ground full size, like any grounded aircraft', () => {
    expect(planeIconSpec(0, { express: true, starlink: true, phase: 'Ground' }).size).toBe(10);
  });
});

describe('planeIconSpec — heading rounding and cache key', () => {
  it('rounds the heading to the nearest 5° so the icon cache actually hits', () => {
    expect(planeIconSpec(87, {}).hdgRounded).toBe(85);
    expect(planeIconSpec(88, {}).hdgRounded).toBe(90);
    expect(planeIconSpec(92.4, {}).hdgRounded).toBe(90);
  });

  it('builds the cache key from rounded heading and the five flags', () => {
    expect(planeIconSpec(87, { longhaul: true, phase: 'Cruise', watched: false, starlink: true }).key)
      .toBe('85|1|Cruise|0|1|0');
    expect(planeIconSpec(0, { phase: 'Ground' }).key).toBe('0|0|Ground|0|0|0');
    expect(planeIconSpec(0, { phase: 'Cruise', express: true }).key).toBe('0|0|Cruise|0|0|1');
  });

  it('never lets an Express and a mainline flight share a cached icon', () => {
    const mainline = planeIconSpec(90, { phase: 'Cruise' });
    const express = planeIconSpec(90, { phase: 'Cruise', express: true });
    expect(express.key).not.toBe(mainline.key);
    expect(express.svg).not.toBe(mainline.svg);
  });

  it('gives two flights with the same rounded heading and flags the same key', () => {
    const a = planeIconSpec(86, { phase: 'Cruise' });
    const b = planeIconSpec(87, { phase: 'Cruise' });
    expect(a.key).toBe('85|0|Cruise|0|0|0');
    expect(a.key).toBe(b.key);
    expect(a.svg).toBe(b.svg);
    // …and 89 rounds up to a different bucket.
    expect(planeIconSpec(89, { phase: 'Cruise' }).key).toBe('90|0|Cruise|0|0|0');
  });

  it('treats a missing heading as 0 (edge case)', () => {
    expect(planeIconSpec(undefined, {}).hdgRounded).toBe(0);
    expect(planeIconSpec(null, {}).hdgRounded).toBe(0);
    expect(planeIconSpec(0, {}).hdgRounded).toBe(0);
  });
});

describe('planeIconSpec — SVG payload', () => {
  it('returns a standalone SVG string sized and filled to match the spec', () => {
    const spec = planeIconSpec(90, { watched: true });
    expect(spec.svg).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
    expect(spec.svg).toContain('width="16" height="16"');
    expect(spec.svg).toContain('fill="#22c55e"');
    expect(spec.svg).toContain('viewBox="0 0 256 256"');
  });

  it('carries the drop-shadow glow in the fill colour', () => {
    expect(planeIconSpec(0, { longhaul: true }).svg).toContain('style="filter:drop-shadow(0 0 2px #fbbf24)"');
  });

  it('contains no rotation — the caller applies the heading transform (edge case)', () => {
    // src/app/map/LiveMap.tsx wraps this in L.divIcon with transform:rotate(Ndeg); the SVG itself
    // always points north so the cache can be keyed independently of that wrapper.
    const spec = planeIconSpec(135, {});
    expect(spec.svg).not.toContain('rotate');
    expect(spec.svg).not.toContain('transform');
  });

  it('returns no Leaflet object — only plain data', () => {
    expect(Object.keys(planeIconSpec(0, {})).sort()).toEqual(['fill', 'hdgRounded', 'key', 'size', 'svg']);
  });
});

describe('PLANE_LEGEND — the map key cannot drift from the markers', () => {
  it('lists every marker state once, in precedence order', () => {
    expect(PLANE_LEGEND.map((row) => row.id)).toEqual([
      'watched',
      'starlink',
      'longhaul',
      'express',
      'airborne',
      'ground',
    ]);
  });

  it('gives each row exactly the fill and size planeIconSpec draws for its flags', () => {
    for (const row of PLANE_LEGEND) {
      const spec = planeIconSpec(0, row.flags);
      expect(row.fill, row.id).toBe(spec.fill);
      expect(row.size, row.id).toBe(spec.size);
    }
  });

  it('covers every exported marker colour, each with its own row', () => {
    const fills = PLANE_LEGEND.map((row) => row.fill);
    expect(new Set(fills).size).toBe(fills.length);
    expect([...fills].sort()).toEqual(Object.values(PLANE_COLORS).sort());
  });

  it('labels every row in words (colour is never the only signal)', () => {
    for (const row of PLANE_LEGEND) expect(row.label.trim().length).toBeGreaterThan(3);
    expect(PLANE_LEGEND.find((row) => row.id === 'longhaul').label).toMatch(/2,500 nm/);
  });

  it('shares the marker silhouette', () => {
    expect(planeIconSpec(0, {}).svg).toContain(`d="${PLANE_PATH}"`);
  });
});

describe('visibleLegendRows', () => {
  it('hides long-haul and Starlink while the map cannot draw them', () => {
    expect(visibleLegendRows().map((row) => row.id)).toEqual(['watched', 'express', 'airborne', 'ground']);
    expect(visibleLegendRows({}).map((row) => row.id)).toEqual(['watched', 'express', 'airborne', 'ground']);
  });

  it('adds long-haul and Starlink only while their highlights are on (v1.16.0: off by default)', () => {
    expect(visibleLegendRows({ longhaulLayer: true }).map((row) => row.id)).toContain('longhaul');
    expect(visibleLegendRows({ starlinkLayer: true }).map((row) => row.id)).toContain('starlink');
    expect(visibleLegendRows({ longhaulLayer: true, starlinkLayer: true })).toHaveLength(PLANE_LEGEND.length);
    // The old roster flag no longer turns violet on: a roster alone is not a highlight.
    expect(visibleLegendRows({ starlinkRoster: true }).map((row) => row.id)).not.toContain('starlink');
  });
});
