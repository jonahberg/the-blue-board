import { describe, expect, it } from 'vitest';

import { HUB_PROXIMITY_NM, filterLiveFlights, hubTraffic } from '../src/lib/live-filters.js';

const HUBS = [
  { iata: 'ORD', lat: 41.9742, lon: -87.9073 },
  { iata: 'DEN', lat: 39.8561, lon: -104.6737 },
];

/** Cruise altitude/vertical rate in the SI units the feed reports. */
function cruising(extra = {}) {
  return { alt: 10000, vr: 0, spd: 230, onGround: false, ...extra };
}

describe('filterLiveFlights', () => {
  const flights = [
    cruising({ fr24id: '1', origin: 'ORD', dest: 'SFO', lat: 40, lon: -90, reg: 'N1' }),
    cruising({ fr24id: '2', origin: 'EWR', dest: 'ORD', lat: 41, lon: -85, reg: 'N2' }),
    cruising({ fr24id: '3', origin: 'LAX', dest: 'JFK', lat: 38, lon: -100, reg: 'N3' }),
  ];

  it('returns everything when no filter is active', () => {
    expect(filterLiveFlights(flights, {}, { hubs: HUBS })).toHaveLength(3);
  });

  it('keeps flights departing OR arriving at the filtered hub', () => {
    const kept = filterLiveFlights(flights, { hub: 'ORD' }, { hubs: HUBS }).map((f) => f.fr24id);
    expect(kept).toEqual(['1', '2']);
  });

  it('adds aircraft on the ground within ~50 nm of the hub, which often report no route', () => {
    const parked = { ...cruising({ fr24id: '4', origin: '', dest: '' }), onGround: true, alt: 0, spd: 0, lat: 41.98, lon: -87.9 };
    const kept = filterLiveFlights([...flights, parked], { hub: 'ORD' }, { hubs: HUBS });
    expect(kept.map((f) => f.fr24id)).toContain('4');
  });

  it('does NOT add an AIRBORNE aircraft merely passing over the hub', () => {
    const overflight = cruising({ fr24id: '5', origin: 'ATL', dest: 'SEA', lat: 41.98, lon: -87.9 });
    const kept = filterLiveFlights([...flights, overflight], { hub: 'ORD' }, { hubs: HUBS });
    expect(kept.map((f) => f.fr24id)).not.toContain('5');
  });

  it('does not add a grounded aircraft beyond the proximity radius', () => {
    // ~5 degrees of longitude at this latitude is far past 93 nm.
    const elsewhere = { ...cruising({ fr24id: '6' }), onGround: true, alt: 0, spd: 0, lat: 41.97, lon: -95 };
    const kept = filterLiveFlights([elsewhere], { hub: 'ORD' }, { hubs: HUBS });
    expect(kept).toEqual([]);
  });

  it('filters by phase group, collapsing Takeoff into Climb', () => {
    const climbing = { fr24id: '7', alt: 1000, vr: 5, spd: 100, onGround: false }; // <5000 ft, >500 fpm
    const kept = filterLiveFlights([...flights, climbing], { phaseGroup: 'Climb' }, { hubs: HUBS });
    expect(kept.map((f) => f.fr24id)).toEqual(['7']);
  });

  it('filters to Starlink aircraft through the injected predicate', () => {
    const kept = filterLiveFlights(
      flights,
      { starlinkOnly: true },
      { hubs: HUBS, isStarlink: (f) => f.reg === 'N2' },
    );
    expect(kept.map((f) => f.fr24id)).toEqual(['2']);
  });

  it('keeps nothing when starlinkOnly is set with no predicate — never everything', () => {
    expect(filterLiveFlights(flights, { starlinkOnly: true }, { hubs: HUBS })).toEqual([]);
  });

  it('combines filters', () => {
    const kept = filterLiveFlights(
      flights,
      { hub: 'ORD', phaseGroup: 'Cruise' },
      { hubs: HUBS },
    );
    expect(kept.map((f) => f.fr24id)).toEqual(['1', '2']);
  });

  it('survives a missing or malformed feed', () => {
    expect(filterLiveFlights(null, { hub: 'ORD' }, { hubs: HUBS })).toEqual([]);
    expect(filterLiveFlights([], {}, {})).toEqual([]);
  });

  it('documents the proximity radius in nautical miles', () => {
    expect(HUB_PROXIMITY_NM).toBe(93);
  });
});

describe('hubTraffic', () => {
  const codes = ['ORD', 'DEN', 'IAH'];
  const flights = [
    cruising({ origin: 'ORD', dest: 'DEN' }),
    cruising({ origin: 'ORD', dest: 'SFO' }),
    cruising({ origin: 'EWR', dest: 'DEN' }),
  ];

  it('counts departures and arrivals per hub', () => {
    const { rows } = hubTraffic(flights, codes);
    expect(rows.find((r) => r.hub === 'ORD')).toMatchObject({ outbound: 2, inbound: 0, total: 2 });
    expect(rows.find((r) => r.hub === 'DEN')).toMatchObject({ outbound: 0, inbound: 2, total: 2 });
    expect(rows.find((r) => r.hub === 'IAH')).toMatchObject({ outbound: 0, inbound: 0, total: 0 });
  });

  it('excludes aircraft on the ground so parked metal never swamps a bar', () => {
    const withParked = [...flights, { ...cruising({ origin: 'IAH', dest: 'ORD' }), onGround: true }];
    const { rows } = hubTraffic(withParked, codes);
    expect(rows.find((r) => r.hub === 'IAH').total).toBe(0);
  });

  it('scales each bar against the busiest hub', () => {
    const { rows, maxTotal, busiest } = hubTraffic(flights, codes);
    expect(maxTotal).toBe(2);
    expect(['ORD', 'DEN']).toContain(busiest);
    expect(rows.find((r) => r.hub === 'ORD').pct).toBe(100);
    expect(rows.find((r) => r.hub === 'IAH').pct).toBe(0);
  });

  it('reports every requested hub in order, even with an empty feed', () => {
    const { rows, maxTotal, busiest } = hubTraffic([], codes);
    expect(rows.map((r) => r.hub)).toEqual(codes);
    expect(rows.every((r) => r.pct === 0)).toBe(true);
    expect(maxTotal).toBe(0);
    expect(busiest).toBe('');
  });

  it('marks exactly one hub busiest when there is traffic', () => {
    const { rows } = hubTraffic(flights, codes);
    expect(rows.filter((r) => r.busiest)).toHaveLength(1);
  });
});
