import { describe, it, expect } from 'vitest';
import { typeUtilization, phaseBreakdown, hubMatrix, topRoutes, avgAgeByType } from '../src/lib/analytics.js';

const HUBS = ['ORD', 'DEN', 'IAH', 'EWR', 'SFO', 'IAD', 'LAX', 'NRT', 'GUM'];
const airborne = (over = {}) => ({ alt: 10000, vr: 0, spd: 240, onGround: false, ...over });

describe('typeUtilization', () => {
  const FLEET = [
    { r: 'N1', t: '737-800' }, { r: 'N2', t: '737-800' }, { r: 'N3', t: '737-800' },
    { r: 'N4', t: '777-300ER' },
    { r: 'N5', t: 'E175' }, // not in the 19-type order
  ];

  it('counts airborne aircraft against the fleet total for each type', () => {
    const flights = [airborne({ reg: 'N1' }), airborne({ reg: 'N2' }), airborne({ reg: 'N4' })];
    const match = (f) => FLEET.find((a) => a.r === f.reg) || null;
    const rows = typeUtilization(flights, FLEET, { matchAircraft: match });
    expect(rows.find((r) => r.type === '737-800')).toEqual({ type: '737-800', flying: 2, total: 3, pct: 67 });
    expect(rows.find((r) => r.type === '777-300ER')).toEqual({ type: '777-300ER', flying: 1, total: 1, pct: 100 });
  });

  it('returns all 19 mainline types in fixed order, even at zero', () => {
    const rows = typeUtilization([], FLEET, { matchAircraft: () => null });
    expect(rows).toHaveLength(19);
    expect(rows[0].type).toBe('A319');
    expect(rows[rows.length - 1].type).toBe('787-10');
    expect(rows.every((r) => r.flying === 0)).toBe(true);
  });

  it('reports 0% rather than dividing by zero for a type with no aircraft (edge case)', () => {
    const rows = typeUtilization([], [], { matchAircraft: () => null });
    expect(rows.every((r) => r.pct === 0 && r.total === 0)).toBe(true);
  });

  it('ignores aircraft types outside the 19-type order (edge case)', () => {
    const flights = [airborne({ reg: 'N5' })];
    const match = (f) => FLEET.find((a) => a.r === f.reg) || null;
    const rows = typeUtilization(flights, FLEET, { matchAircraft: match });
    expect(rows.some((r) => r.type === 'E175')).toBe(false);
    expect(rows.reduce((n, r) => n + r.flying, 0)).toBe(0);
  });
});

describe('phaseBreakdown', () => {
  it('counts every flight into its exact phase, ground included', () => {
    const out = phaseBreakdown([
      airborne({ alt: 10000, vr: 0 }),
      airborne({ alt: 10000, vr: 0 }),
      airborne({ alt: 3000, vr: 10 }),
      airborne({ alt: 1000, vr: 3 }),
      airborne({ alt: 3000, vr: -5 }),
      airborne({ alt: 300, vr: -5 }),
      airborne({ alt: 5000, vr: 0 }),
      airborne({ alt: 0, vr: 0, spd: 5 }),
    ]);
    expect(out.counts).toEqual({ Takeoff: 1, Climb: 1, Cruise: 2, 'En Route': 1, Descent: 1, Approach: 1, Ground: 1 });
    expect(out.total).toBe(8);
  });

  it('keeps Cruise and En Route as separate slices, unlike the sidebar', () => {
    const out = phaseBreakdown([airborne({ alt: 10000 }), airborne({ alt: 5000 })]);
    expect(out.counts.Cruise).toBe(1);
    expect(out.counts['En Route']).toBe(1);
  });

  it('renders the donut order with zero-count phases dropped', () => {
    const out = phaseBreakdown([airborne({ alt: 10000 }), airborne({ alt: 3000, vr: 10 })]);
    expect(out.order).toEqual(['Cruise', 'Climb']);
  });

  it('reports a total of 1 for an empty feed so the donut never divides by zero (edge case)', () => {
    const out = phaseBreakdown([]);
    expect(out.total).toBe(1);
    expect(out.order).toEqual([]);
    expect(out.counts.Cruise).toBe(0);
  });
});

describe('hubMatrix', () => {
  it('counts hub-to-hub flows directionally', () => {
    const { matrix } = hubMatrix([
      airborne({ origin: 'ORD', dest: 'DEN' }),
      airborne({ origin: 'ORD', dest: 'DEN' }),
      airborne({ origin: 'DEN', dest: 'ORD' }),
    ], HUBS);
    expect(matrix.ORD.DEN).toBe(2);
    expect(matrix.DEN.ORD).toBe(1);
  });

  it('ignores non-hub endpoints and same-hub rows', () => {
    const { matrix, max } = hubMatrix([
      airborne({ origin: 'ORD', dest: 'ATL' }),
      airborne({ origin: 'ATL', dest: 'ORD' }),
      airborne({ origin: 'ORD', dest: 'ORD' }),
      airborne({ origin: 'ORD', dest: 'SFO' }),
    ], HUBS);
    expect(matrix.ORD.ORD).toBe(0);
    expect(matrix.ORD.SFO).toBe(1);
    expect(max).toBe(1);
  });

  it('reports row totals per origin hub', () => {
    const { rowTotals } = hubMatrix([
      airborne({ origin: 'ORD', dest: 'DEN' }),
      airborne({ origin: 'ORD', dest: 'SFO' }),
      airborne({ origin: 'DEN', dest: 'ORD' }),
    ], HUBS);
    expect(rowTotals.ORD).toBe(2);
    expect(rowTotals.DEN).toBe(1);
    expect(rowTotals.GUM).toBe(0);
  });

  it('floors the colour-scaling max at 1 so an empty matrix is safe (edge case)', () => {
    const { max, matrix } = hubMatrix([], HUBS);
    expect(max).toBe(1);
    expect(matrix.ORD.DEN).toBe(0);
    expect(Object.keys(matrix)).toEqual(HUBS);
  });

  it('skips flights missing either endpoint (edge case)', () => {
    const { rowTotals } = hubMatrix([
      airborne({ origin: 'ORD' }),
      airborne({ dest: 'DEN' }),
      airborne({}),
    ], HUBS);
    expect(rowTotals.ORD).toBe(0);
  });
});

describe('topRoutes', () => {
  it('ranks city pairs by frequency, busiest first', () => {
    const rows = topRoutes([
      airborne({ origin: 'ORD', dest: 'DEN' }),
      airborne({ origin: 'ORD', dest: 'DEN' }),
      airborne({ origin: 'ORD', dest: 'DEN' }),
      airborne({ origin: 'SFO', dest: 'LAX' }),
      airborne({ origin: 'SFO', dest: 'LAX' }),
      airborne({ origin: 'EWR', dest: 'LHR' }),
    ], 15);
    expect(rows).toEqual([
      { route: 'ORD→DEN', count: 3 },
      { route: 'SFO→LAX', count: 2 },
      { route: 'EWR→LHR', count: 1 },
    ]);
  });

  it('treats the two directions of a city pair as different routes', () => {
    const rows = topRoutes([
      airborne({ origin: 'ORD', dest: 'DEN' }),
      airborne({ origin: 'DEN', dest: 'ORD' }),
    ], 15);
    expect(rows.map((r) => r.route).sort()).toEqual(['DEN→ORD', 'ORD→DEN']);
  });

  it('caps the list at the requested limit', () => {
    const flights = Array.from({ length: 20 }, (_, i) => airborne({ origin: 'ORD', dest: 'D' + i }));
    expect(topRoutes(flights, 15)).toHaveLength(15);
  });

  it('returns an empty list when no flight has a full route (edge case)', () => {
    expect(topRoutes([airborne({ origin: 'ORD' }), airborne({})], 15)).toEqual([]);
    expect(topRoutes([], 15)).toEqual([]);
  });
});

describe('avgAgeByType', () => {
  it('averages delivery-year ages per type to one decimal', () => {
    const { rows } = avgAgeByType([
      { t: '737-800', d: '2010' },
      { t: '737-800', d: '2014' },
      { t: '777-300ER', d: '2016' },
    ], 2026);
    expect(rows.find((r) => r.type === '737-800').avg).toBe('14.0');
    expect(rows.find((r) => r.type === '777-300ER').avg).toBe('10.0');
  });

  it('reports the fleet-wide average alongside the per-type rows', () => {
    expect(avgAgeByType([
      { t: '737-800', d: '2010' },
      { t: '777-300ER', d: '2020' },
    ], 2026).fleetAvg).toBe('11.0');
  });

  it('returns all 19 types in fixed order, zero for types with no aircraft', () => {
    const { rows } = avgAgeByType([], 2026);
    expect(rows).toHaveLength(19);
    expect(rows[0].type).toBe('A319');
    expect(rows.every((r) => r.avg === 0)).toBe(true);
  });

  it('reports -- as the fleet average when no aircraft has a delivery year (edge case)', () => {
    expect(avgAgeByType([{ t: '737-800' }, { t: '737-800', d: 'n/a' }], 2026).fleetAvg).toBe('--');
  });

  it('skips aircraft with an unparseable delivery year (edge case)', () => {
    const { rows } = avgAgeByType([
      { t: '737-800', d: '2010' },
      { t: '737-800', d: '' },
      { t: '737-800', d: 'unknown' },
    ], 2026);
    expect(rows.find((r) => r.type === '737-800').avg).toBe('16.0');
  });
});
