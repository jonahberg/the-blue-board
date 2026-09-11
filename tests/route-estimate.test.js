import { describe, it, expect } from 'vitest';
import { UA_ROUTES, estimateRoute } from '../src/lib/route-estimate.js';

/** Collapse the returned airport objects to codes so fixtures stay readable. */
const codes = (r) => [r.origin && r.origin.iata, r.dest && r.dest.iata];

describe('UA_ROUTES', () => {
  it('maps flight numbers to city pairs', () => {
    expect(UA_ROUTES[1]).toEqual({ from: 'SFO', to: 'SIN' });
    expect(UA_ROUTES[17]).toEqual({ from: 'EWR', to: 'LHR' });
    expect(UA_ROUTES[2000]).toEqual({ from: 'IAD', to: 'SFO' });
  });

  it('carries the full static table', () => {
    expect(Object.keys(UA_ROUTES)).toHaveLength(228);
  });

  it('has no entry for unknown numbers (edge case)', () => {
    expect(UA_ROUTES[9999]).toBeUndefined();
    expect(UA_ROUTES[0]).toBeUndefined();
  });
});

describe('estimateRoute — static table lookup', () => {
  it('resolves a known UA flight number to airport objects without any position', () => {
    expect(codes(estimateRoute(null, null, null, null, null, 'UA1'))).toEqual(['SFO', 'SIN']);
    const r = estimateRoute(null, null, null, null, null, 'UA1');
    expect(r.origin).toMatchObject({ iata: 'SFO', lat: 37.6213, lon: -122.379 });
  });

  it('accepts a bare number and a lowercase prefix', () => {
    expect(codes(estimateRoute(null, null, null, null, null, 1200))).toEqual(['SFO', 'ORD']);
    expect(codes(estimateRoute(null, null, null, null, null, 'ua17'))).toEqual(['EWR', 'LHR']);
  });

  it('does NOT match a UAL-prefixed callsign — the table lookup only strips "UA" (edge case)', () => {
    // `'UAL1'.replace(/^UA/i,'')` leaves "L1", which parseInt rejects, so a UAL
    // callsign always falls through to bearing matching. Preserved from main.js.
    expect(codes(estimateRoute(41, -95, 90, 35000, 0, 'UAL1'))).toEqual(['OMA', 'DSM']);
  });
});

describe('estimateRoute — bearing matching', () => {
  it('picks an airport behind the aircraft as origin and ahead as destination', () => {
    expect(codes(estimateRoute(41.3, -96, 90, 35000, 0, 'UA9999'))).toEqual(['DEN', 'OMA']);
  });

  it('swaps origin and destination when the aircraft reverses course', () => {
    expect(codes(estimateRoute(41.3, -96, 270, 35000, 0, 'UA9999'))).toEqual(['OMA', 'DEN']);
  });

  it('works over open ocean within the 2000 nm cap', () => {
    expect(codes(estimateRoute(50, -30, 70, 35000, 0, 'UA9999'))).toEqual(['BOS', 'DUB']);
  });

  it('treats a heading of 0 as a real heading, not a missing one (edge case)', () => {
    expect(codes(estimateRoute(41.3, -96, 0, 35000, 0, 'UA9999'))).toEqual(['MCI', 'MSP']);
  });
});

describe('estimateRoute — low-altitude nearest-airport rule', () => {
  it('assigns the nearest airport as origin when climbing below 5000 ft', () => {
    // Just off ORD, climbing: ORD becomes the origin, and the dedup rule then
    // clears the (farther) bearing-matched origin rather than the destination.
    expect(codes(estimateRoute(41.99, -87.92, 90, 2000, 5, 'UA9999'))).toEqual([null, 'ORD']);
  });

  it('assigns the nearest airport as destination when descending below 5000 ft', () => {
    expect(codes(estimateRoute(41.99, -87.92, 90, 2000, -5, 'UA9999'))).toEqual(['MSN', 'ORD']);
  });

  it('never returns the same airport as both origin and destination', () => {
    for (const vr of [5, -5, 0]) {
      const r = estimateRoute(41.99, -87.92, 90, 2000, vr, 'UA9999');
      if (r.origin && r.dest) expect(r.origin.iata).not.toBe(r.dest.iata);
    }
  });
});

describe('estimateRoute — missing input guards', () => {
  it('returns a null pair when there is no position and no table hit', () => {
    expect(estimateRoute(null, null, null, null, null, 'UA9999')).toEqual({ origin: null, dest: null });
  });

  it('returns a null pair when the heading is missing', () => {
    expect(estimateRoute(41.3, -96, undefined, 35000, 0, 'UA9999')).toEqual({ origin: null, dest: null });
    expect(estimateRoute(41.3, -96, null, 35000, 0, 'UA9999')).toEqual({ origin: null, dest: null });
  });

  it('treats a zero latitude as missing (edge case — falsy guard preserved from main.js)', () => {
    expect(estimateRoute(0, -96, 90, 35000, 0, 'UA9999')).toEqual({ origin: null, dest: null });
    expect(estimateRoute(41.3, 0, 90, 35000, 0, 'UA9999')).toEqual({ origin: null, dest: null });
  });
});
