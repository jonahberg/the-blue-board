import { describe, it, expect } from 'vitest';
import {
  buildDeparturesBoard,
  departureBucketLabel,
  DEPARTURE_BUCKETS,
} from '../src/lib/starlink-utils.js';

// Fixed "now" so the time-window math is deterministic.
const NOW = 1_700_000_000; // seconds
const H = 3600;

// Hubs used by the dashboard (EWR/IAH/.../NRT/GUM). NRT & GUM are the empty Pacific hubs.
const HUBS = ['EWR', 'IAH', 'ORD', 'DEN', 'SFO', 'LAX', 'IAD', 'NRT', 'GUM'];

// Minimal flight + aircraft factories matching the /api/starlink-data shape.
const flight = (origin, dest, offsetSec, flight_number = 'SKW1234') => ({
  flight_number,
  origin,
  destination: dest,
  departure_ts: NOW + offsetSec,
  departure_time: new Date((NOW + offsetSec) * 1000).toISOString(),
  arrival_time: '',
  airline: 'UA',
});

const aircraftByTail = {
  N100: { type: 'ERJ-175', fleet: 'Express', operator: 'SkyWest dba UAX' },
  N200: { type: '737 MAX 8', fleet: 'Mainline', operator: 'United Airlines' },
  N300: { type: 'CRJ-550', fleet: 'Express', operator: 'GoJet dba UAX' },
};

describe('departureBucketLabel', () => {
  it('maps deltas to the four time buckets, with the grace window in WITHIN 1 HOUR', () => {
    expect(departureBucketLabel(-1800)).toBe('WITHIN 1 HOUR'); // departed 30m ago (grace)
    expect(departureBucketLabel(0)).toBe('WITHIN 1 HOUR');
    expect(departureBucketLabel(59 * 60)).toBe('WITHIN 1 HOUR');
    expect(departureBucketLabel(2 * H)).toBe('1–3 HRS');
    expect(departureBucketLabel(6 * H)).toBe('3–12 HRS');
    expect(departureBucketLabel(24 * H)).toBe('12–48 HRS');
    expect(departureBucketLabel(100 * H)).toBe('12–48 HRS'); // clamps to last bucket
  });

  it('exposes the buckets in render order', () => {
    expect(DEPARTURE_BUCKETS.map((b) => b.label)).toEqual([
      'WITHIN 1 HOUR', '1–3 HRS', '3–12 HRS', '12–48 HRS',
    ]);
  });
});

describe('buildDeparturesBoard', () => {
  it('flattens, keeps only hub departures inside the window, and sorts ascending', () => {
    const flightsByTail = {
      N100: [
        flight('EWR', 'ORD', 2 * H),       // kept
        flight('EWR', 'DEN', -10 * H),     // dropped: before the grace window
      ],
      N200: [
        flight('SFO', 'NRT', 5 * H),       // kept
        flight('SFO', 'LHR', 30 * H),      // dropped: outside the 12h window
      ],
      N300: [
        flight('XNA', 'ORD', 1 * H),       // dropped: origin XNA is not a hub
      ],
    };
    const out = buildDeparturesBoard(flightsByTail, aircraftByTail, {}, HUBS, {
      now: NOW, windowSec: 12 * H,
    });

    const all = out.buckets.flatMap((b) => b.rows);
    expect(all.map((r) => `${r.origin}->${r.destination}`)).toEqual(['EWR->ORD', 'SFO->NRT']);
    // sorted ascending by departure_ts
    expect(all[0].departure_ts).toBeLessThan(all[1].departure_ts);
    expect(out.shownCount).toBe(2);
  });

  it('includes the now-1800 grace departure and routes it to WITHIN 1 HOUR', () => {
    const flightsByTail = { N100: [flight('EWR', 'ORD', -1500)] }; // left 25m ago
    const out = buildDeparturesBoard(flightsByTail, aircraftByTail, {}, HUBS, { now: NOW });
    expect(out.shownCount).toBe(1);
    expect(out.buckets[0].label).toBe('WITHIN 1 HOUR');
    expect(out.buckets[0].rows[0].origin).toBe('EWR');
  });

  it('joins fleet data and live-airborne status (icao24) by tail', () => {
    const flightsByTail = { N100: [flight('EWR', 'ORD', 1 * H)] };
    const airborneByTail = { N100: { icao24: 'a1b2c3' } };
    const out = buildDeparturesBoard(flightsByTail, aircraftByTail, airborneByTail, HUBS, { now: NOW });
    const row = out.buckets[0].rows[0];
    expect(row).toMatchObject({
      tail: 'N100',
      type: 'ERJ-175',
      fleet: 'Express',
      operator: 'SkyWest dba UAX',
      airborne: true,
      icao24: 'a1b2c3',
    });
  });

  it('accepts a Map for the airborne lookup (as getStarlinkAirborneMap-like callers may pass)', () => {
    const flightsByTail = { N100: [flight('EWR', 'ORD', 1 * H)] };
    const airborneMap = new Map([['N100', { icao24: 'deadbe' }]]);
    const out = buildDeparturesBoard(flightsByTail, aircraftByTail, airborneMap, HUBS, { now: NOW });
    expect(out.buckets[0].rows[0]).toMatchObject({ airborne: true, icao24: 'deadbe' });
  });

  it('groups departures under the correct time-bucket section labels', () => {
    const flightsByTail = {
      N100: [flight('EWR', 'ORD', 30 * 60)],   // WITHIN 1 HOUR
      N200: [flight('IAH', 'DEN', 2 * H)],      // 1–3 HRS
      N300: [flight('ORD', 'LAX', 6 * H)],      // 3–12 HRS
    };
    const out = buildDeparturesBoard(flightsByTail, aircraftByTail, {}, HUBS, {
      now: NOW, windowSec: 12 * H,
    });
    expect(out.buckets.map((b) => b.label)).toEqual(['WITHIN 1 HOUR', '1–3 HRS', '3–12 HRS']);
    expect(out.buckets.map((b) => b.rows.length)).toEqual([1, 1, 1]);
  });

  it('computes per-hub counts over the window (pre-filter), with empty Pacific hubs at 0', () => {
    const flightsByTail = {
      N100: [flight('EWR', 'ORD', 1 * H), flight('EWR', 'DEN', 2 * H)],
      N200: [flight('SFO', 'LAX', 3 * H)],
    };
    const out = buildDeparturesBoard(flightsByTail, aircraftByTail, {}, HUBS, {
      now: NOW, windowSec: 12 * H,
    });
    expect(out.hubCounts.EWR).toBe(2);
    expect(out.hubCounts.SFO).toBe(1);
    expect(out.hubCounts.NRT).toBe(0); // empty Pacific hub renders gracefully
    expect(out.hubCounts.GUM).toBe(0);
    expect(out.allCount).toBe(3);
  });

  it('applies the hub filter without changing the pre-filter hub counts', () => {
    const flightsByTail = {
      N100: [flight('EWR', 'ORD', 1 * H)],
      N200: [flight('SFO', 'LAX', 2 * H)],
    };
    const out = buildDeparturesBoard(flightsByTail, aircraftByTail, {}, HUBS, {
      now: NOW, windowSec: 12 * H, hub: 'EWR',
    });
    const all = out.buckets.flatMap((b) => b.rows);
    expect(all).toHaveLength(1);
    expect(all[0].origin).toBe('EWR');
    // pills still show every hub's count regardless of the active selection
    expect(out.hubCounts.SFO).toBe(1);
    expect(out.allCount).toBe(2);
    expect(out.totalInWindow).toBe(1); // filtered total
  });

  it('caps rows per hub and reports the hidden count; show-all (Infinity) reveals them', () => {
    const flightsByTail = {
      N100: Array.from({ length: 50 }, (_, i) => flight('EWR', 'ORD', (i + 1) * 60)),
    };
    const capped = buildDeparturesBoard(flightsByTail, aircraftByTail, {}, HUBS, {
      now: NOW, windowSec: 48 * H, capPerHub: 40,
    });
    expect(capped.shownCount).toBe(40);
    expect(capped.hiddenCount).toBe(10);
    // cap keeps the EARLIEST departures
    const shown = capped.buckets.flatMap((b) => b.rows);
    expect(shown[0].departure_ts).toBe(NOW + 60);

    const uncapped = buildDeparturesBoard(flightsByTail, aircraftByTail, {}, HUBS, {
      now: NOW, windowSec: 48 * H, capPerHub: Infinity,
    });
    expect(uncapped.shownCount).toBe(50);
    expect(uncapped.hiddenCount).toBe(0);
  });

  it('returns an empty (but well-formed) board for empty / missing input', () => {
    const out = buildDeparturesBoard({}, {}, {}, HUBS, { now: NOW });
    expect(out.buckets).toEqual([]);
    expect(out.shownCount).toBe(0);
    expect(out.allCount).toBe(0);
    expect(out.hubCounts.GUM).toBe(0);

    const nullish = buildDeparturesBoard(null, null, null, HUBS, { now: NOW });
    expect(nullish.buckets).toEqual([]);
    expect(nullish.shownCount).toBe(0);
  });

  it('ignores flights with no usable departure_ts', () => {
    const flightsByTail = {
      N100: [
        { flight_number: 'SKW1', origin: 'EWR', destination: 'ORD', departure_ts: 0 },
        flight('EWR', 'DEN', 1 * H),
      ],
    };
    const out = buildDeparturesBoard(flightsByTail, aircraftByTail, {}, HUBS, { now: NOW });
    expect(out.shownCount).toBe(1);
    expect(out.buckets[0].rows[0].destination).toBe('DEN');
  });
});
