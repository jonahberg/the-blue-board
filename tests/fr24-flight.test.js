import { describe, it, expect } from 'vitest';
import {
  normalizeFlightNumber,
  normalizeLiveResponse,
  normalizeSummaryResponse,
  getClientIp,
} from '../api/fr24-flight.js';

describe('normalizeFlightNumber (FR24)', () => {
  it('prepends UA to bare numbers', () => {
    expect(normalizeFlightNumber('838')).toBe('UA838');
  });

  it('converts UAL prefix to UA', () => {
    expect(normalizeFlightNumber('UAL838')).toBe('UA838');
  });

  it('leaves UA prefix as-is', () => {
    expect(normalizeFlightNumber('UA838')).toBe('UA838');
  });

  it('trims whitespace and uppercases', () => {
    expect(normalizeFlightNumber('  ua 838 ')).toBe('UA838');
  });

  it('handles empty/null input', () => {
    expect(normalizeFlightNumber('')).toBe('');
    expect(normalizeFlightNumber(null)).toBe('');
    expect(normalizeFlightNumber(undefined)).toBe('');
  });

  it('handles 4-digit flight numbers', () => {
    expect(normalizeFlightNumber('2221')).toBe('UA2221');
  });

  it('preserves non-UA airline codes', () => {
    expect(normalizeFlightNumber('DL100')).toBe('DL100');
  });
});

describe('normalizeLiveResponse', () => {
  it('maps FR24 live fields to standard schema', () => {
    const data = {
      data: [{
        flight_iata: 'UA838',
        callsign: 'UAL838',
        on_ground: false,
        orig_iata: 'SFO',
        dest_iata: 'EWR',
        aircraft_type: 'B789',
        registration: 'N29975',
        icao24: 'ABC123',
        scheduled_departure: '2024-01-01T10:00:00Z',
        actual_departure: '2024-01-01T10:05:00Z',
        scheduled_arrival: '2024-01-01T18:00:00Z',
        estimated_arrival: '2024-01-01T17:50:00Z',
        lat: 37.6213,
        lon: -122.379,
        alt: 35000,
        gspeed: 450,
        heading: 90,
        flight_id: 'abc123',
      }],
    };

    const result = normalizeLiveResponse(data, 'UA838');

    expect(result.flightNumber).toBe('UA838');
    expect(result.callsign).toBe('UAL838');
    expect(result.status).toBe('en-route');
    expect(result.origin.iata).toBe('SFO');
    expect(result.destination.iata).toBe('EWR');
    expect(result.aircraft.type).toBe('B789');
    expect(result.aircraft.reg).toBe('N29975');
    expect(result.aircraft.icao24).toBe('ABC123');
    expect(result.departure.scheduled).toBe('2024-01-01T10:00:00Z');
    expect(result.departure.actual).toBe('2024-01-01T10:05:00Z');
    expect(result.arrival.scheduled).toBe('2024-01-01T18:00:00Z');
    expect(result.arrival.estimated).toBe('2024-01-01T17:50:00Z');
    expect(result.position.lat).toBe(37.6213);
    expect(result.position.lon).toBe(-122.379);
    expect(result.position.alt).toBe(35000);
    expect(result.position.speed).toBe(450);
    expect(result.position.heading).toBe(90);
    expect(result.flightId).toBe('abc123');
  });

  it('returns "on-ground" status when on_ground is true', () => {
    const data = { data: [{ on_ground: true }] };
    const result = normalizeLiveResponse(data, 'UA100');
    expect(result.status).toBe('on-ground');
  });

  it('returns null for empty data', () => {
    expect(normalizeLiveResponse({ data: [] }, 'UA100')).toBeNull();
    expect(normalizeLiveResponse({}, 'UA100')).toBeNull();
    expect(normalizeLiveResponse(null, 'UA100')).toBeNull();
  });

  it('uses fallback fields when primary fields are missing', () => {
    const data = {
      data: [{
        flight_icao: 'UAL838',
        origin: { iata: 'SFO', icao: 'KSFO', name: 'San Francisco' },
        destination: { iata: 'EWR', icao: 'KEWR', name: 'Newark' },
        type: 'B789',
        reg: 'N29975',
        latitude: 37.62,
        longitude: -122.38,
        altitude: 35000,
        speed: 450,
        track: 90,
        fr24_id: 'xyz',
      }],
    };
    const result = normalizeLiveResponse(data, 'UA838');
    expect(result.flightNumber).toBe('UAL838');
    expect(result.origin.iata).toBe('SFO');
    expect(result.origin.name).toBe('San Francisco');
    expect(result.aircraft.type).toBe('B789');
    expect(result.aircraft.reg).toBe('N29975');
    expect(result.position.lat).toBe(37.62);
    expect(result.position.lon).toBe(-122.38);
    expect(result.flightId).toBe('xyz');
  });
});

describe('normalizeSummaryResponse', () => {
  it('maps FR24 summary fields to standard schema', () => {
    const data = {
      data: [{
        flight_iata: 'UA1234',
        callsign: 'UAL1234',
        status: 'scheduled',
        origin: { iata: 'ORD', icao: 'KORD', name: 'Chicago' },
        destination: { iata: 'LAX', icao: 'KLAX', name: 'Los Angeles' },
        aircraft: { type: 'B738', registration: 'N12345' },
        departure: { scheduled: '2024-01-01T08:00:00Z', actual: '' },
        arrival: { scheduled: '2024-01-01T10:30:00Z', estimated: '2024-01-01T10:25:00Z' },
        flight_id: 'sum123',
      }],
    };

    const result = normalizeSummaryResponse(data, 'UA1234');

    expect(result.flightNumber).toBe('UA1234');
    expect(result.callsign).toBe('UAL1234');
    expect(result.status).toBe('scheduled');
    expect(result.origin.iata).toBe('ORD');
    expect(result.destination.iata).toBe('LAX');
    expect(result.aircraft.type).toBe('B738');
    expect(result.aircraft.reg).toBe('N12345');
    expect(result.departure.scheduled).toBe('2024-01-01T08:00:00Z');
    expect(result.arrival.estimated).toBe('2024-01-01T10:25:00Z');
    expect(result.position).toBeNull(); // summary has no position data
    expect(result.flightId).toBe('sum123');
  });

  it('returns null for empty data', () => {
    expect(normalizeSummaryResponse({ data: [] }, 'UA100')).toBeNull();
    expect(normalizeSummaryResponse({}, 'UA100')).toBeNull();
    expect(normalizeSummaryResponse(null, 'UA100')).toBeNull();
  });

  it('uses fallback fields when primary fields are missing', () => {
    const data = {
      data: [{
        flight_number: { iata: 'UA999', icao: 'UAL999' },
        airport: {
          origin: { code: { iata: 'DEN' } },
          destination: { code: { iata: 'SFO' } },
        },
        aircraft_type: 'A320',
        registration: 'N54321',
        fr24_id: 'fallback1',
      }],
    };
    const result = normalizeSummaryResponse(data, 'UA999');
    expect(result.origin.iata).toBe('DEN');
    expect(result.destination.iata).toBe('SFO');
    expect(result.aircraft.type).toBe('A320');
    expect(result.aircraft.reg).toBe('N54321');
    expect(result.flightId).toBe('fallback1');
  });
});


describe('getClientIp (FR24)', () => {
  it('prefers x-real-ip over x-forwarded-for', () => {
    const req = {
      headers: {
        'x-real-ip': '100.0.0.1',
        'x-forwarded-for': '200.0.0.1, 201.0.0.1',
      },
    };
    expect(getClientIp(req)).toBe('100.0.0.1');
  });

  it('falls back to first x-forwarded-for value when x-real-ip is missing', () => {
    const req = { headers: { 'x-forwarded-for': '200.0.0.1, 201.0.0.1' } };
    expect(getClientIp(req)).toBe('200.0.0.1');
  });

  it('returns unknown when both headers are missing', () => {
    expect(getClientIp({ headers: {} })).toBe('unknown');
  });
});

// Jul 3 2026 audit: same kill-switch coverage as aircraft-history — this endpoint calls the
// paid FR24 Official API and must refuse cleanly when SCHEDULE_OFFICIAL_FALLBACK_ENABLED=false.
import { vi, beforeEach, afterEach } from 'vitest';
import handler from '../api/fr24-flight.js';

function createRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
    end() { return this; },
  };
}

describe('fr24-flight official-FR24 kill switch', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.FR24_API_TOKEN = 'test-token';
  });

  afterEach(() => {
    delete process.env.SCHEDULE_OFFICIAL_FALLBACK_ENABLED;
    delete process.env.FR24_API_TOKEN;
  });

  it('returns 503 without calling FR24 when the kill switch is off', async () => {
    process.env.SCHEDULE_OFFICIAL_FALLBACK_ENABLED = '0';
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const res = createRes();
    await handler({
      method: 'GET',
      headers: { origin: 'http://localhost:3000' },
      query: { flight: 'UA9981' }, // unique flight → cold module cache
    }, res);

    expect(res.statusCode).toBe(503);
    expect(res.body.error).toMatch(/temporarily unavailable/i);
    expect(res.headers['Cache-Control']).toBe('no-store');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
