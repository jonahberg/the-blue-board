import { describe, it, expect } from 'vitest';
import { planeIconSpec } from '../src/lib/plane-icon.js';

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
});

describe('planeIconSpec — heading rounding and cache key', () => {
  it('rounds the heading to the nearest 5° so the icon cache actually hits', () => {
    expect(planeIconSpec(87, {}).hdgRounded).toBe(85);
    expect(planeIconSpec(88, {}).hdgRounded).toBe(90);
    expect(planeIconSpec(92.4, {}).hdgRounded).toBe(90);
  });

  it('builds the cache key from rounded heading and the four flags', () => {
    expect(planeIconSpec(87, { longhaul: true, phase: 'Cruise', watched: false, starlink: true }).key)
      .toBe('85|1|Cruise|0|1');
    expect(planeIconSpec(0, { phase: 'Ground' }).key).toBe('0|0|Ground|0|0');
  });

  it('gives two flights with the same rounded heading and flags the same key', () => {
    const a = planeIconSpec(86, { phase: 'Cruise' });
    const b = planeIconSpec(87, { phase: 'Cruise' });
    expect(a.key).toBe('85|0|Cruise|0|0');
    expect(a.key).toBe(b.key);
    expect(a.svg).toBe(b.svg);
    // …and 89 rounds up to a different bucket.
    expect(planeIconSpec(89, { phase: 'Cruise' }).key).toBe('90|0|Cruise|0|0');
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
    // main.js wraps this in L.divIcon with transform:rotate(Ndeg); the SVG itself
    // always points north so the cache can be keyed independently of that wrapper.
    const spec = planeIconSpec(135, {});
    expect(spec.svg).not.toContain('rotate');
    expect(spec.svg).not.toContain('transform');
  });

  it('returns no Leaflet object — only plain data', () => {
    expect(Object.keys(planeIconSpec(0, {})).sort()).toEqual(['fill', 'hdgRounded', 'key', 'size', 'svg']);
  });
});
