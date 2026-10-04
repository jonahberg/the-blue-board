import { describe, expect, it } from 'vitest';

import {
  DEFAULT_REGION_ID,
  MAP_REGIONS,
  crossesAntimeridian,
  getRegion,
  regionBounds,
  resolveRegionId,
} from '../src/lib/map-regions.js';

const ids = MAP_REGIONS.map((region) => region.id);

/**
 * Airports United serves, by region (rounded coordinates). Written out here rather than read
 * from AIRPORTS: that table only carries the airports the dashboard needs for route maths, and
 * has no Caribbean or Micronesia rows at all.
 */
const SERVED = {
  us: { ORD: [41.98, -87.9], DEN: [39.86, -104.67], IAH: [29.98, -95.34], EWR: [40.69, -74.17], SFO: [37.62, -122.38], LAX: [33.94, -118.41], IAD: [38.95, -77.46], SEA: [47.45, -122.31], MIA: [25.79, -80.29], BOS: [42.36, -71.01] },
  'central-america': { MEX: [19.44, -99.07], GDL: [20.52, -103.31], SJD: [23.15, -109.72], PVR: [20.68, -105.25], CUN: [21.04, -86.87], MTY: [25.78, -100.11], GUA: [14.58, -90.53], SAL: [13.44, -89.06], RTB: [16.32, -86.52], LIR: [10.59, -85.54], SJO: [9.99, -84.21], PTY: [9.07, -79.38] },
  caribbean: { NAS: [25.04, -77.47], HAV: [22.99, -82.41], GCM: [19.29, -81.36], MBJ: [18.5, -77.91], PUJ: [18.57, -68.36], SJU: [18.44, -66.0], STT: [18.34, -64.97], SXM: [18.04, -63.11], AUA: [12.5, -70.01], CUR: [12.19, -68.96], BGI: [13.07, -59.49], POS: [10.6, -61.34] },
  'south-america': { BOG: [4.7, -74.15], CTG: [10.44, -75.51], UIO: [-0.13, -78.36], LIM: [-12.02, -77.11], SCL: [-33.39, -70.79], EZE: [-34.82, -58.54], GRU: [-23.43, -46.47], GIG: [-22.81, -43.25] },
  europe: { GOH: [64.19, -51.68], KEF: [63.98, -22.61], FNC: [32.7, -16.77], LIS: [38.77, -9.13], DUB: [53.42, -6.27], LHR: [51.47, -0.45], CDG: [49.01, 2.55], FRA: [50.03, 8.56], FCO: [41.8, 12.25], ATH: [37.94, 23.94], IST: [41.26, 28.74], OTP: [44.57, 26.09] },
  africa: { DSS: [14.67, -17.07], RAK: [31.61, -8.04], ACC: [5.6, -0.17], LOS: [6.58, 3.32], JNB: [-26.14, 28.24], CPT: [-33.97, 18.6] },
  'middle-east-india': { TLV: [32.01, 34.89], AMM: [31.72, 35.99], DXB: [25.25, 55.36], DEL: [28.56, 77.1], BOM: [19.09, 72.87], BLR: [13.2, 77.71] },
  'east-asia': { NRT: [35.77, 140.39], HND: [35.55, 139.78], KIX: [34.43, 135.24], FUK: [33.59, 130.45], ICN: [37.46, 126.44], PVG: [31.14, 121.81], PEK: [40.08, 116.58], TPE: [25.08, 121.23], HKG: [22.31, 113.91] },
  'southeast-asia': { MNL: [14.51, 121.02], CEB: [10.31, 123.98], SGN: [10.82, 106.65], BKK: [13.69, 100.75], SIN: [1.36, 103.99], DPS: [-8.75, 115.17] },
  oceania: { SYD: [-33.95, 151.18], MEL: [-37.67, 144.84], BNE: [-27.38, 153.12], ADL: [-34.95, 138.53], AKL: [-37.01, 174.79], CHC: [-43.49, 172.53], NAN: [-17.76, 177.44] },
  pacific: { GUM: [13.48, 144.8], SPN: [15.12, 145.73], ROR: [7.37, 134.54], MAJ: [7.06, 171.27], KWA: [8.72, 167.73], HNL: [21.32, -157.92], KOA: [19.74, -156.05], PPT: [-17.55, -149.61], NAN: [-17.76, 177.44], SFO: [37.62, -122.38] },
};

/** Is [lat, lon] inside the preset's (continuity-normalised) box? */
function contains(id, [lat, lon]) {
  const [[south, west], [north, east]] = regionBounds(id);
  const shifted = lon < west ? lon + 360 : lon;
  return lat >= south && lat <= north && shifted >= west && shifted <= east;
}

describe('MAP_REGIONS', () => {
  it('covers every region the Reddit commenter asked for, plus home and the old Pacific preset', () => {
    expect(ids).toEqual([
      'us',
      'central-america',
      'caribbean',
      'south-america',
      'europe',
      'africa',
      'middle-east-india',
      'east-asia',
      'southeast-asia',
      'oceania',
      'pacific',
    ]);
    expect(DEFAULT_REGION_ID).toBe('us');
    expect(ids[0]).toBe(DEFAULT_REGION_ID);
  });

  it('gives every preset a label, a short trigger label and a sane box', () => {
    for (const region of MAP_REGIONS) {
      expect(region.label.length, region.id).toBeGreaterThan(1);
      expect(region.short.length, region.id).toBeGreaterThan(1);
      const { south, north, west, east } = region.box;
      expect(south, region.id).toBeLessThan(north);
      expect(south).toBeGreaterThanOrEqual(-85);
      expect(north).toBeLessThanOrEqual(85);
      for (const lon of [west, east]) {
        expect(lon).toBeGreaterThanOrEqual(-180);
        expect(lon).toBeLessThanOrEqual(180);
      }
    }
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps every box under 180° wide, or the continuity rule would flip it', () => {
    for (const region of MAP_REGIONS) {
      const [[, west], [, east]] = regionBounds(region.id);
      expect(east - west, region.id).toBeGreaterThan(0);
      expect(east - west, region.id).toBeLessThan(180);
    }
  });

  it('frames the airports United serves in each region', () => {
    expect(Object.keys(SERVED).sort()).toEqual([...ids].sort());
    for (const [id, airports] of Object.entries(SERVED)) {
      for (const [code, point] of Object.entries(airports)) {
        expect(contains(id, point), `${id} should frame ${code}`).toBe(true);
      }
    }
  });

  it('keeps the hubs out of the overseas presets they do not belong to', () => {
    expect(contains('east-asia', SERVED.us.ORD)).toBe(false);
    expect(contains('europe', SERVED.us.DEN)).toBe(false);
    expect(contains('us', SERVED['east-asia'].NRT)).toBe(false);
    expect(contains('oceania', SERVED.us.SFO)).toBe(false);
  });
});

describe('regionBounds — antimeridian', () => {
  it('runs Oceania and Pacific across 180° with a continuous east edge', () => {
    expect(crossesAntimeridian('oceania')).toBe(true);
    expect(crossesAntimeridian('pacific')).toBe(true);
    expect(regionBounds('oceania')).toEqual([
      [-48, 110],
      [-5, 190],
    ]);
    expect(regionBounds('pacific')).toEqual([
      [-20, 125],
      [55, 245],
    ]);
  });

  it('returns a non-crossing box unchanged', () => {
    for (const region of MAP_REGIONS) {
      if (crossesAntimeridian(region.id)) continue;
      const { south, west, north, east } = region.box;
      expect(regionBounds(region.id)).toEqual([
        [south, west],
        [north, east],
      ]);
    }
  });

  it('has exactly the two ocean presets crossing the date line', () => {
    expect(ids.filter((id) => crossesAntimeridian(id))).toEqual(['oceania', 'pacific']);
  });
});

describe('resolveRegionId — legacy and garbage values never throw', () => {
  it('maps the old Pacific map-layer key to the Pacific preset', () => {
    expect(resolveRegionId('pacific')).toBe('pacific');
    expect(resolveRegionId('Pacific')).toBe('pacific');
    expect(resolveRegionId(' PACIFIC ')).toBe('pacific');
    expect(getRegion('pacific').label).toBe('Pacific');
  });

  it('accepts every current id and its label', () => {
    for (const region of MAP_REGIONS) {
      expect(resolveRegionId(region.id)).toBe(region.id);
      expect(resolveRegionId(region.label), region.label).toBe(region.id);
    }
  });

  it('accepts loose names', () => {
    expect(resolveRegionId('USA')).toBe('us');
    expect(resolveRegionId('europe')).toBe('europe');
    expect(resolveRegionId('India')).toBe('middle-east-india');
    expect(resolveRegionId('australia')).toBe('oceania');
    expect(resolveRegionId('mexico')).toBe('central-america');
  });

  it('falls back to the default for anything else (edge case)', () => {
    for (const bad of ['', 'mars', 'hubs', 'longhaul', '__proto__', 'constructor', 'toString', null, undefined, 42, {}, [], ['pacific']]) {
      expect(() => resolveRegionId(bad)).not.toThrow();
      expect(resolveRegionId(bad)).toBe(DEFAULT_REGION_ID);
    }
    expect(getRegion('mars').id).toBe('us');
    expect(() => regionBounds(undefined)).not.toThrow();
  });
});
