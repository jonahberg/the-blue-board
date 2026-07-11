import { describe, it, expect } from 'vitest';
import {
  normalizeOperator,
  normalizeType,
  normalizeStarlinkPayload,
} from '../api/_starlink-normalize.js';

describe('normalizeOperator', () => {
  it('canonicalises SkyWest casing so the operator filter does not split', () => {
    expect(normalizeOperator('Skywest dba UAX')).toBe('SkyWest dba UAX');
    expect(normalizeOperator('SkyWest dba UAX')).toBe('SkyWest dba UAX');
    expect(normalizeOperator('SKYWEST dba UAX')).toBe('SkyWest dba UAX');
    expect(normalizeOperator('SkyWest floater')).toBe('SkyWest floater');
  });

  it('leaves other carriers intact and defaults empty to United Airlines', () => {
    expect(normalizeOperator('Republic dba UAX')).toBe('Republic dba UAX');
    expect(normalizeOperator('GoJet dba UAX')).toBe('GoJet dba UAX');
    expect(normalizeOperator('United Airlines')).toBe('United Airlines');
    expect(normalizeOperator('')).toBe('United Airlines');
    expect(normalizeOperator(null)).toBe('United Airlines');
  });
});

describe('normalizeType', () => {
  it('collapses manufacturer-prefixed and customer-code variants to one label', () => {
    expect(normalizeType('Bombardier CRJ-550')).toBe('CRJ-550');
    expect(normalizeType('CRJ-550')).toBe('CRJ-550');
    expect(normalizeType('Boeing 737-824')).toBe('737-800');
    expect(normalizeType('Boeing 737-800')).toBe('737-800');
    expect(normalizeType('Boeing 737-924(ER)')).toBe('737-900ER');
    expect(normalizeType('Boeing 737-932(ER)')).toBe('737-900ER');
    expect(normalizeType('Boeing 737-900ER')).toBe('737-900ER');
    expect(normalizeType('Airbus A321-271NX')).toBe('A321neo');
  });

  it('preserves distinct regional configs and unknown types gracefully', () => {
    expect(normalizeType('ERJ-175')).toBe('ERJ-175');
    expect(normalizeType('E175SC')).toBe('E175SC');
    expect(normalizeType('Boeing 787-9')).toBe('787-9'); // unmapped → prefix-stripped
    expect(normalizeType('')).toBe('Unknown');
  });
});

describe('normalizeStarlinkPayload', () => {
  // Mirrors the live upstream: totalCount is the WHOLE fleet, fleetStats has no `combined`,
  // departure_time is a UNIX-seconds integer, operator/type casing is inconsistent.
  const upstream = {
    totalCount: 1781,
    starlinkPlanes: [
      { TailNumber: 'N51', fleet: 'mainline', Aircraft: 'Boeing 737-924(ER)', OperatedBy: 'United Airlines', DateFound: '2024-01-01', WiFi: 'Starlink' },
      { TailNumber: 'N32', fleet: 'express', Aircraft: 'Bombardier CRJ-550', OperatedBy: 'Skywest dba UAX', DateFound: '2026-05-31', WiFi: 'StrLnk' },
    ],
    fleetStats: {
      mainline: { starlink: 51, total: 1122 },
      express: { starlink: 320, total: 659 },
    },
    flightsByTail: {
      N32: [
        { flight_number: 'SKW2', departure_airport: 'MKE', arrival_airport: 'IAH', departure_time: 1780318800, arrival_time: 1780329600, airline: 'UA' },
        { flight_number: 'SKW1', departure_airport: 'DEN', arrival_airport: 'MKE', departure_time: 1780270800, arrival_time: 1780280100, airline: 'UA' },
      ],
    },
    lastUpdated: '2026-05-31T23:02:04.479Z',
  };

  it('reports the real Starlink count, NOT upstream.totalCount (the whole fleet)', () => {
    const out = normalizeStarlinkPayload(upstream, '2026-05-31T23:40:00.000Z');
    expect(out.totalCount).toBe(2);
    expect(out.totalCount).not.toBe(1781);
  });

  it('normalises operator casing and airframe types', () => {
    const out = normalizeStarlinkPayload(upstream, '2026-05-31T23:40:00.000Z');
    expect(out.aircraft[0]).toMatchObject({ tail: 'N51', fleet: 'Mainline', type: '737-900ER', operator: 'United Airlines', wifi: 'Starlink' });
    expect(out.aircraft[1]).toMatchObject({ tail: 'N32', fleet: 'Express', type: 'CRJ-550', operator: 'SkyWest dba UAX', dateFound: '2026-05-31' });
  });

  it('derives fleetStats incl. rollout percentages when upstream omits `combined`', () => {
    const out = normalizeStarlinkPayload(upstream, '2026-05-31T23:40:00.000Z');
    expect(out.fleetStats).toMatchObject({
      mainline: 51, express: 320, total: 371,
      mainlineTotal: 1122, expressTotal: 659, fleetTotal: 1781,
      mainlinePct: 5, expressPct: 49,
    });
  });

  it('converts flight epochs to ISO + numeric ts and sorts chronologically', () => {
    const out = normalizeStarlinkPayload(upstream, '2026-05-31T23:40:00.000Z');
    const flights = out.flightsByTail.N32;
    // Input was out of order (SKW2 then SKW1); normaliser sorts ascending by departure.
    expect(flights.map(f => f.flight_number)).toEqual(['SKW1', 'SKW2']);
    expect(flights[0].departure_ts).toBe(1780270800);
    expect(flights[0].departure_time).toBe(new Date(1780270800 * 1000).toISOString());
    expect(flights[0].arrival_time).toBe(new Date(1780280100 * 1000).toISOString());
    expect(flights[0].origin).toBe('DEN');
    expect(flights[0].destination).toBe('MKE');
  });

  it('handles an empty / malformed payload without throwing', () => {
    expect(normalizeStarlinkPayload({}).totalCount).toBe(0);
    expect(normalizeStarlinkPayload(null).aircraft).toEqual([]);
    expect(normalizeStarlinkPayload({ starlinkPlanes: [] }).fleetStats).toBeNull();
  });

  // Upstream occasionally ships departure_time as millisecond epochs or ISO strings instead of
  // UNIX seconds; toTime() guards the ms case with a >1e12 divide-by-1000 (a 1000x-error guard).
  it('normalises a millisecond-epoch flight time down to seconds', () => {
    const msUpstream = {
      starlinkPlanes: [{ TailNumber: 'N32', fleet: 'express', Aircraft: 'CRJ-550', OperatedBy: 'SkyWest dba UAX' }],
      flightsByTail: {
        N32: [
          { flight_number: 'SKW1', departure_airport: 'DEN', arrival_airport: 'MKE', departure_time: 1780270800000, arrival_time: 1780280100000, airline: 'UA' },
        ],
      },
    };
    const out = normalizeStarlinkPayload(msUpstream, '2026-05-31T23:40:00.000Z');
    const flight = out.flightsByTail.N32[0];
    expect(flight.departure_ts).toBe(1780270800);
    expect(flight.departure_time).toBe(new Date(1780270800 * 1000).toISOString());
    expect(flight.arrival_time).toBe(new Date(1780280100 * 1000).toISOString());
  });

  it('parses an ISO-string flight time into the same numeric ts', () => {
    const iso = new Date(1780270800 * 1000).toISOString();
    const isoUpstream = {
      starlinkPlanes: [{ TailNumber: 'N32', fleet: 'express', Aircraft: 'CRJ-550', OperatedBy: 'SkyWest dba UAX' }],
      flightsByTail: {
        N32: [
          { flight_number: 'SKW1', departure_airport: 'DEN', arrival_airport: 'MKE', departure_time: iso, arrival_time: '', airline: 'UA' },
        ],
      },
    };
    const out = normalizeStarlinkPayload(isoUpstream, '2026-05-31T23:40:00.000Z');
    const flight = out.flightsByTail.N32[0];
    expect(flight.departure_ts).toBe(1780270800);
    expect(flight.departure_time).toBe(iso);
  });
});
