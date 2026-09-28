/**
 * normalizeSegments on the shape the live FR24 /api/flight-summary/light endpoint returns:
 * FLAT (orig_icao / dest_icao / datetime_scheduled_departure / datetime_takeoff), not the
 * legacy nested {origin:{iata}, departure:{scheduled}} fallback. Moved out of
 * tests/irops.test.js, where these sat under IROPS and used only the nested shape.
 */

import { describe, expect, it } from 'vitest';

import { normalizeSegments } from '../api/aircraft-history.js';

function flat(over = {}) {
  return {
    flight: 'UA302',
    callsign: 'UAL302',
    orig_icao: 'KSFO',
    dest_icao: 'KORD',
    datetime_scheduled_departure: '2026-03-10T10:00:00Z',
    datetime_takeoff: '2026-03-10T10:42:00Z',
    datetime_landed: '2026-03-10T14:38:00Z',
    ...over,
  };
}

describe('normalizeSegments (live flat FR24 shape)', () => {
  it('computes the departure delay from the scheduled departure and take-off time', () => {
    const [seg] = normalizeSegments({ data: [flat()] });
    expect(seg).toMatchObject({ flightNumber: 'UA302', origin: 'SFO', destination: 'ORD', delayMin: 42 });
    expect(seg.arrival.actual).toBe('2026-03-10T14:38:00Z');
  });

  it('computes a negative delay for an early take-off', () => {
    const [seg] = normalizeSegments({ data: [flat({ datetime_takeoff: '2026-03-10T09:55:00Z' })] });
    expect(seg.delayMin).toBe(-5);
  });

  it('leaves the delay null for a flight that has not taken off', () => {
    const [seg] = normalizeSegments({ data: [flat({ datetime_takeoff: null, datetime_landed: null })] });
    expect(seg.delayMin).toBeNull();
  });

  it('sorts most recent first (take-off, else schedule) and keeps five', () => {
    const data = Array.from({ length: 8 }, (_, i) =>
      flat({
        flight: `UA${100 + i}`,
        datetime_scheduled_departure: `2026-03-1${i}T10:00:00Z`,
        datetime_takeoff: i === 7 ? null : `2026-03-1${i}T10:05:00Z`,
      }),
    );
    const segs = normalizeSegments({ data });
    expect(segs).toHaveLength(5);
    expect(segs.map((s) => s.flightNumber)).toEqual(['UA107', 'UA106', 'UA105', 'UA104', 'UA103']);
  });

  it('drops a segment whose airport is missing', () => {
    const segs = normalizeSegments({ data: [flat(), flat({ flight: 'UA9', orig_icao: '' })] });
    expect(segs.map((s) => s.flightNumber)).toEqual(['UA302']);
  });
});

// D8 (live audit Sep 28 2026): My Flights' Aircraft Journey showed earlier legs as "unknown".
// FR24's flight-summary/light body carries NO status field (tests/fixtures/fr24-summary-light.json),
// so every segment fell through to 'unknown'. Derive it from the fields the body does carry.
describe('normalizeSegments status (D8)', () => {
  it('a leg with datetime_landed or flight_ended is landed', () => {
    expect(normalizeSegments({ data: [flat()] })[0].status).toBe('landed');
    expect(normalizeSegments({ data: [flat({ datetime_landed: null, flight_ended: true })] })[0].status).toBe('landed');
  });

  it('a leg that took off and has not ended is en-route', () => {
    const [seg] = normalizeSegments({ data: [flat({ datetime_landed: null, flight_ended: false })] });
    expect(seg.status).toBe('en-route');
  });

  it('a provider status word still wins', () => {
    expect(normalizeSegments({ data: [flat({ status: 'Diverted' })] })[0].status).toBe('diverted');
  });
});
