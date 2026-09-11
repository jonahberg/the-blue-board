import { describe, it, expect } from 'vitest';
import {
  haversineNm,
  bearing,
  angleDiff,
  greatCirclePoints,
  normalizeLonContinuity,
  isLonghaul,
} from '../src/lib/geo.js';

// Coordinates copied verbatim from the AIRPORTS table so the fixtures below are
// the numbers the live dashboard actually computes.
const ORD = [41.9742, -87.9073];
const LHR = [51.47, -0.4543];
const DEN = [39.8561, -104.6737];
const SFO = [37.6213, -122.379];
const NRT = [35.772, 140.3929];
const EWR = [40.6925, -74.1687];

const COORDS = {
  ORD: { iata: 'ORD', lat: 41.9742, lon: -87.9073, hub: true },
  DEN: { iata: 'DEN', lat: 39.8561, lon: -104.6737, hub: true },
  EWR: { iata: 'EWR', lat: 40.6925, lon: -74.1687, hub: true },
  SFO: { iata: 'SFO', lat: 37.6213, lon: -122.379, hub: true },
  NRT: { iata: 'NRT', lat: 35.772, lon: 140.3929, hub: true },
  LHR: { iata: 'LHR', lat: 51.47, lon: -0.4543 },
};

describe('haversineNm', () => {
  it('measures short domestic legs in nautical miles', () => {
    expect(haversineNm(...EWR, ...ORD)).toBeCloseTo(623.4550968958374, 9);
    expect(haversineNm(...ORD, ...DEN)).toBeCloseTo(769.9789619239345, 9);
  });

  it('measures long-haul legs across the Atlantic and Pacific', () => {
    expect(haversineNm(...ORD, ...LHR)).toBeCloseTo(3425.8811921691727, 9);
    expect(haversineNm(...SFO, ...NRT)).toBeCloseTo(4441.758635830952, 9);
  });

  it('is symmetric', () => {
    expect(haversineNm(...ORD, ...LHR)).toBeCloseTo(haversineNm(...LHR, ...ORD), 9);
  });

  it('returns 0 for identical points (edge case — no NaN from acos drift)', () => {
    expect(haversineNm(41.9742, -87.9073, 41.9742, -87.9073)).toBe(0);
  });
});

describe('bearing', () => {
  it('returns compass degrees from the first point to the second', () => {
    expect(bearing(...ORD, ...LHR)).toBeCloseTo(47.860913440878846, 9);
    expect(bearing(...ORD, ...DEN)).toBeCloseTo(266.09040647057606, 9);
    expect(bearing(...ORD, ...EWR)).toBeCloseTo(92.49924578973446, 9);
  });

  it('returns cardinal bearings on the equator', () => {
    expect(bearing(0, 0, 10, 0)).toBe(0);
    expect(bearing(0, 0, -10, 0)).toBe(180);
    expect(bearing(0, 0, 0, 10)).toBe(90);
  });

  it('normalises into [0, 360) rather than emitting negatives (edge case)', () => {
    const west = bearing(0, 0, 0, -10);
    expect(west).toBeGreaterThanOrEqual(0);
    expect(west).toBeLessThan(360);
    expect(west).toBeCloseTo(270, 9);
  });
});

describe('angleDiff', () => {
  it('returns the absolute separation for nearby headings', () => {
    expect(angleDiff(10, 40)).toBe(30);
    expect(angleDiff(40, 10)).toBe(30);
  });

  it('takes the short way round the compass', () => {
    expect(angleDiff(350, 10)).toBe(20);
    expect(angleDiff(10, 350)).toBe(20);
  });

  it('never exceeds 180 (edge case — reciprocal headings)', () => {
    expect(angleDiff(0, 180)).toBe(180);
    expect(angleDiff(0, 181)).toBe(179);
    expect(angleDiff(0, 0)).toBe(0);
  });
});

describe('greatCirclePoints', () => {
  it('returns n + 1 points that start at the origin and end at the destination', () => {
    const pts = greatCirclePoints(...SFO, ...NRT, 60);
    expect(pts).toHaveLength(61);
    expect(pts[0][0]).toBeCloseTo(SFO[0], 9);
    expect(pts[0][1]).toBeCloseTo(SFO[1], 9);
    expect(pts[60][0]).toBeCloseTo(NRT[0], 9);
    expect(pts[60][1]).toBeCloseTo(NRT[1], 9);
  });

  it('arcs poleward on a transpacific route rather than following the rhumb line', () => {
    const pts = greatCirclePoints(...SFO, ...NRT, 60);
    expect(pts[30][0]).toBeCloseTo(48.42177955593595, 9);
    expect(pts[30][1]).toBeCloseTo(-171.77511899552584, 9);
  });

  it('short-circuits to a two-point segment when the endpoints coincide (edge case)', () => {
    expect(greatCirclePoints(41.9742, -87.9073, 41.9742, -87.9073, 60)).toEqual([
      [41.9742, -87.9073],
      [41.9742, -87.9073],
    ]);
  });
});

describe('normalizeLonContinuity', () => {
  it('leaves a route that never crosses the antimeridian untouched', () => {
    const pts = [
      [41.9742, -87.9073],
      [39.8561, -104.6737],
      [37.6213, -122.379],
    ];
    expect(normalizeLonContinuity(pts)).toEqual(pts);
  });

  it('unwraps eastbound longitudes past +180 so the polyline stays continuous', () => {
    // SFO → NRT: the raw arc jumps -175 → +175, a 350° step Leaflet would draw
    // as a line all the way back across the map.
    const out = normalizeLonContinuity([
      [45, -170],
      [48, -178],
      [47, 175],
      [40, 150],
    ]);
    expect(out).toEqual([
      [45, -170],
      [48, -178],
      [47, -185],
      [40, -210],
    ]);
  });

  it('unwraps westbound longitudes the other way', () => {
    expect(normalizeLonContinuity([
      [35, 170],
      [40, -175],
    ])).toEqual([
      [35, 170],
      [40, 185],
    ]);
  });

  it('is defensive about empty and single-point input (edge case)', () => {
    expect(normalizeLonContinuity([])).toEqual([]);
    expect(normalizeLonContinuity(null)).toEqual([]);
    expect(normalizeLonContinuity(undefined)).toEqual([]);
    expect(normalizeLonContinuity([[10, 20]])).toEqual([[10, 20]]);
  });
});

describe('isLonghaul', () => {
  it('is true when the great-circle distance exceeds 2500 nm', () => {
    expect(isLonghaul('SFO', 'NRT', 'UAL837', COORDS)).toBe(true);
    expect(isLonghaul('ORD', 'LHR', 'UAL978', COORDS)).toBe(true);
  });

  it('is false for domestic legs under 2500 nm even with a low flight number', () => {
    expect(isLonghaul('ORD', 'DEN', 'UAL12', COORDS)).toBe(false);
    expect(isLonghaul('EWR', 'ORD', 'UAL7', COORDS)).toBe(false);
  });

  it('falls back to the sub-100 flight-number heuristic when coords are unknown', () => {
    expect(isLonghaul('XXX', 'YYY', 'UAL7', COORDS)).toBe(true);
    expect(isLonghaul('XXX', 'YYY', 'UAL99', COORDS)).toBe(true);
    expect(isLonghaul('XXX', 'YYY', 'UAL100', COORDS)).toBe(false);
    expect(isLonghaul('XXX', 'YYY', 'UAL1234', COORDS)).toBe(false);
  });

  it('needs BOTH endpoints before it trusts the distance (edge case)', () => {
    // Only one side is known → the number heuristic decides.
    expect(isLonghaul('SFO', 'ZZZ', 'UAL5', COORDS)).toBe(true);
    expect(isLonghaul('SFO', 'ZZZ', 'UAL5000', COORDS)).toBe(false);
  });

  it('is false when there is no callsign to fall back on (edge case)', () => {
    expect(isLonghaul(undefined, undefined, '', COORDS)).toBe(false);
    expect(isLonghaul(undefined, undefined, undefined, COORDS)).toBe(false);
    expect(isLonghaul('ORD', 'DEN', undefined, COORDS)).toBe(false);
  });
});
