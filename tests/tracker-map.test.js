import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { VIEW, projectPoint, outlinePaths, regionFor } from '../src/lib/tracker-map.js';
import { atcAirports } from '../src/data/trackers/atc.js';
import { unitedHubs } from '../src/data/trackers/united-hubs.js';

const outline = JSON.parse(
  readFileSync(new URL('../src/data/trackers/us-outline.json', import.meta.url), 'utf8')
);

const inView = (x, y) => x >= 0 && x <= VIEW.w && y >= 0 && y <= VIEW.h;

describe('projectPoint', () => {
  it('projects known cities with correct relative geography', () => {
    const sea = projectPoint(-122.31, 47.45);
    const mia = projectPoint(-80.29, 25.79);
    const bos = projectPoint(-71.01, 42.36);
    const lax = projectPoint(-118.41, 33.94);
    // west of / east of
    expect(sea.x).toBeLessThan(mia.x);
    expect(lax.x).toBeLessThan(mia.x);
    expect(mia.x).toBeLessThan(bos.x + 200); // MIA well east, BOS far east
    // north of / south of
    expect(sea.y).toBeLessThan(lax.y);
    expect(bos.y).toBeLessThan(mia.y);
  });

  it('puts Alaska and Hawaii in their bottom-left insets', () => {
    const anc = projectPoint(-149.99, 61.17);
    const hnl = projectPoint(-157.92, 21.32);
    expect(anc.region).toBe('alaska');
    expect(hnl.region).toBe('hawaii');
    expect(anc.x).toBeLessThan(VIEW.w * 0.35);
    expect(anc.y).toBeGreaterThan(VIEW.h * 0.55);
    expect(hnl.x).toBeLessThan(VIEW.w * 0.45);
    expect(hnl.y).toBeGreaterThan(VIEW.h * 0.6);
  });

  it('returns null for off-map territories (San Juan, Guam)', () => {
    expect(projectPoint(-66.0, 18.44)).toBeNull(); // SJU
    expect(projectPoint(144.8, 13.48)).toBeNull(); // GUM
    expect(regionFor(144.8, 13.48)).toBeNull();
  });

  it('projects every ATC airport except SJU inside the viewBox', () => {
    for (const a of atcAirports) {
      const p = projectPoint(a.lng, a.lat);
      if (a.code === 'SJU') {
        expect(p, a.code).toBeNull();
        continue;
      }
      expect(p, a.code).not.toBeNull();
      expect(inView(p.x, p.y), `${a.code} at ${p.x},${p.y}`).toBe(true);
    }
  });

  it('projects every United hub except GUM inside the viewBox', () => {
    for (const [iata, h] of Object.entries(unitedHubs)) {
      const p = projectPoint(h.lng, h.lat);
      if (iata === 'GUM') {
        expect(p, iata).toBeNull();
        continue;
      }
      expect(p, iata).not.toBeNull();
      expect(inView(p.x, p.y), iata).toBe(true);
    }
  });
});

describe('outlinePaths', () => {
  it('produces closed paths whose every vertex is inside the viewBox', () => {
    const paths = outlinePaths(outline);
    for (const [name, d] of Object.entries(paths)) {
      expect(d, name).toMatch(/^M/);
      expect(d, name).toMatch(/Z$/);
      const coords = [...d.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)];
      expect(coords.length, name).toBeGreaterThan(10);
      for (const [, x, y] of coords) {
        expect(inView(parseFloat(x), parseFloat(y)), `${name} vertex ${x},${y}`).toBe(true);
      }
    }
  });

  it('keeps dots on land: a sample of live airports falls within their outline bounding box', () => {
    const paths = outlinePaths(outline);
    const conusCoords = [...paths.conus.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map(([, x, y]) => [
      parseFloat(x),
      parseFloat(y),
    ]);
    const xs = conusCoords.map((c) => c[0]);
    const ys = conusCoords.map((c) => c[1]);
    const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    for (const code of ['SEA', 'LAX', 'MIA', 'CLE', 'DFW', 'DEN']) {
      const a = atcAirports.find((e) => e.code === code);
      const p = projectPoint(a.lng, a.lat);
      expect(p.x, code).toBeGreaterThan(minX);
      expect(p.x, code).toBeLessThan(maxX);
      expect(p.y, code).toBeGreaterThan(minY);
      expect(p.y, code).toBeLessThan(maxY);
    }
  });
});
