import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  normalizeFlightNumber,
  normalizeLiveResponse,
  normalizeSummaryResponse,
  getClientIp,
} from '../api/fr24-flight.js';

// Real-shape fixtures (F110): fr24-summary-light.json is UA2278's prod answer (yesterday's
// completed leg); fr24-live-full.json follows FR24's documented live-full schema.
const LIVE_FULL = JSON.parse(readFileSync(new URL('./fixtures/fr24-live-full.json', import.meta.url), 'utf8'));
const SUMMARY_LIGHT = JSON.parse(readFileSync(new URL('./fixtures/fr24-summary-light.json', import.meta.url), 'utf8'));

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
  it('maps the documented live-full row (flight / reg / type / hex / gspeed / track / eta) — F110', () => {
    const result = normalizeLiveResponse(LIVE_FULL, 'UA2106');

    expect(result.flightNumber).toBe('UA2106');
    expect(result.callsign).toBe('UAL2106');
    expect(result.status).toBe('en-route');
    expect(result.origin).toEqual({ iata: 'ORD', icao: 'KORD', name: '' });
    expect(result.destination).toEqual({ iata: 'SFO', icao: 'KSFO', name: '' });
    expect(result.aircraft).toEqual({ type: 'A21N', reg: 'N14512', icao24: 'A0B7C4' });
    // live-full has no departure times at all; its one time is the ETA.
    expect(result.departure).toEqual({ scheduled: '', actual: '' });
    expect(result.arrival.estimated).toBe('2026-09-27T07:22:00Z');
    expect(result.position).toEqual({ lat: 40.91, lon: -104.62, alt: 37000, speed: 468, heading: 262 });
    expect(result.flightId).toBe('3c9a77d0');
  });

  it('reads on-ground from altitude/speed — the real payload has no on_ground flag', () => {
    const row = LIVE_FULL.data[0];
    expect(normalizeLiveResponse({ data: [{ ...row, alt: 0, gspeed: 0 }] }, 'UA2106').status).toBe('on-ground');
    expect(normalizeLiveResponse({ data: [{ ...row, alt: 0, gspeed: 18 }] }, 'UA2106').status).toBe('on-ground');
    expect(normalizeLiveResponse({ data: [{ ...row, alt: 2500, gspeed: 160 }] }, 'UA2106').status).toBe('en-route');
  });

  it('legacy fallback names (assumed, never observed) still map', () => {
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
    expect(result.status).toBe('en-route');
    expect(result.aircraft).toEqual({ type: 'B789', reg: 'N29975', icao24: 'ABC123' });
    expect(result.departure.scheduled).toBe('2024-01-01T10:00:00Z');
    expect(result.arrival.estimated).toBe('2024-01-01T17:50:00Z');
    expect(result.position.heading).toBe(90);
    expect(result.flightId).toBe('abc123');
  });

  it('honours an explicit on_ground flag (legacy fallback)', () => {
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

  it('parses the real FLAT /flight-summary/light shape (orig_icao / datetime_takeoff / reg / type)', () => {
    const result = normalizeSummaryResponse({
      data: [{
        fr24_id: '41993080',
        flight: 'UA803',
        callsign: 'UAL803',
        operating_as: 'UAL',
        painted_as: 'UAL',
        type: 'B78X',
        reg: 'N12010',
        orig_icao: 'KSFO',
        orig_iata: 'SFO',
        datetime_scheduled_departure: '2026-09-11T00:20:00Z',
        datetime_takeoff: '2026-09-11T00:41:00Z',
        dest_icao: 'RJTT',
        dest_iata: 'HND',
        datetime_landed: null,
        flight_ended: false,
      }],
    }, 'UA803', Date.parse('2026-09-11T02:00:00Z'));

    expect(result.flightNumber).toBe('UA803');
    expect(result.callsign).toBe('UAL803');
    expect(result.status).toBe('en-route');
    expect(result.origin).toEqual({ iata: 'SFO', icao: 'KSFO', name: '' });
    expect(result.destination).toEqual({ iata: 'HND', icao: 'RJTT', name: '' });
    expect(result.aircraft).toEqual({ type: 'B78X', reg: 'N12010' });
    expect(result.departure).toEqual({ scheduled: '2026-09-11T00:20:00Z', actual: '2026-09-11T00:41:00Z' });
    expect(result.flightId).toBe('41993080');
    expect(result.previousLeg).toBe(false);
  });

  it('derives landed status from datetime_landed / flight_ended and maps ICAO-only airports', () => {
    const result = normalizeSummaryResponse({
      data: [{ flight: 'UA1', callsign: 'UAL1', orig_icao: 'KSFO', dest_icao: 'VHHH', dest_icao_actual: 'RJTT', datetime_takeoff: '2026-09-10T20:00:00Z', datetime_landed: '2026-09-11T06:00:00Z', flight_ended: true }],
    }, 'UA1');
    expect(result.status).toBe('landed');
    expect(result.origin.iata).toBe('SFO');
    expect(result.destination.icao).toBe('RJTT'); // actual destination wins over filed
    // A landing is an ACTUAL, not an estimate (F110).
    expect(result.arrival.actual).toBe('2026-09-11T06:00:00Z');
    expect(result.arrival.estimated).toBe('');
  });

  it('never presents yesterday\'s completed leg as the flight — it comes back flagged previousLeg (F0)', () => {
    // UA2278, 2026-09-27 04:33Z: tonight's leg has not departed, FR24 lists only yesterday's.
    const result = normalizeSummaryResponse(SUMMARY_LIGHT, 'UA2278', Date.parse('2026-09-27T04:33:39Z'));
    expect(result.previousLeg).toBe(true);
    expect(result.status).toBe('landed');
    expect(result.departure.actual).toBe('2026-09-26T06:02:02Z');
  });

  it('picks the live leg over an older one regardless of array order', () => {
    const tonight = { ...SUMMARY_LIGHT.data[0], reg: 'N76265', datetime_takeoff: '2026-09-27T05:52:40Z', datetime_landed: null, flight_ended: false, last_seen: '2026-09-27T06:29:58Z' };
    const result = normalizeSummaryResponse({ data: [SUMMARY_LIGHT.data[0], tonight] }, 'UA2278', Date.parse('2026-09-27T06:30:00Z'));
    expect(result.previousLeg).toBe(false);
    expect(result.aircraft.reg).toBe('N76265');
    expect(result.status).toBe('en-route');
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
import handler, { __resetFr24FlightForTests } from '../api/fr24-flight.js';
import { resetMirroredQuotaBlock } from '../api/_cost-state.js';

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
    // F038: keeps a 402 recorded by one test from blocking the shared quota check in the next.
    resetMirroredQuotaBlock();
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

// F048: the success path merges the live position with summary times, 404s when neither
// tier has data, and labels the leg (liveLeg/legDate) so the modal isn't silently
// authoritative. None of that was covered — only the kill-switch 503 above.
function fr24Resp(body, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

describe('fr24-flight handler success orchestration (F048)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    __resetFr24FlightForTests();
    process.env.FR24_API_TOKEN = 'test-token';
    delete process.env.SCHEDULE_OFFICIAL_FALLBACK_ENABLED; // kill switch defaults ON
    resetMirroredQuotaBlock();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.FR24_API_TOKEN;
  });

  it('merges the live position with the current summary leg\'s takeoff and labels the leg', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: Date.parse('2026-09-27T04:33:39Z') });
    // UA2106 in the air: summary lists yesterday's leg AND tonight's airborne one.
    const summary = { data: [
      { ...SUMMARY_LIGHT.data[0], flight: 'UA2106', callsign: 'UAL2106', reg: 'N14512', orig_icao: 'KORD', dest_icao: 'KSFO', dest_icao_actual: 'KSFO', datetime_takeoff: '2026-09-26T03:20:11Z', datetime_landed: '2026-09-26T07:31:40Z' },
      { ...SUMMARY_LIGHT.data[0], flight: 'UA2106', callsign: 'UAL2106', reg: 'N14512', orig_icao: 'KORD', dest_icao: 'KSFO', dest_icao_actual: 'KSFO', datetime_takeoff: '2026-09-27T03:17:53Z', datetime_landed: null, flight_ended: false, last_seen: '2026-09-27T04:33:30Z' },
    ] };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) =>
      fr24Resp(String(url).includes('/api/live/flight-positions/full') ? LIVE_FULL : summary));

    const res = createRes();
    await handler({ method: 'GET', headers: { origin: 'http://localhost:3000' }, query: { flight: 'UA2106' } }, res);
    vi.useRealTimers();

    expect(res.statusCode).toBe(200);
    expect(res.body.source).toBe('fr24-official-live+summary');
    expect(res.body.liveLeg).toBe(true);
    expect(res.body.previousLeg).toBe(false);
    expect(res.body.flight.departure.actual).toBe('2026-09-27T03:17:53Z'); // tonight's, not yesterday's
    expect(res.body.legDate).toBe('2026-09-27T03:17:53Z');
    expect(res.body.flight.arrival.estimated).toBe('2026-09-27T07:22:00Z'); // the live ETA survives
    expect(res.body.flight.position.lat).toBe(40.91); // live position preserved
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('a flight that has not departed today answers with its last leg, flagged previousLeg (F0)', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: Date.parse('2026-09-27T04:33:39Z') });
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) =>
      fr24Resp(String(url).includes('/api/live/flight-positions/full') ? { data: [] } : SUMMARY_LIGHT));
    const res = createRes();
    await handler({ method: 'GET', headers: { origin: 'http://localhost:3000' }, query: { flight: 'UA2278' } }, res);
    vi.useRealTimers();

    expect(res.statusCode).toBe(200);
    expect(res.body.source).toBe('fr24-official-summary');
    expect(res.body.previousLeg).toBe(true);
    expect(res.body.legDate).toBe('2026-09-26T06:02:02Z');
    expect(res.body.flight.previousLeg).toBeUndefined();
  });

  it('404s when neither the live nor the summary tier has data', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => fr24Resp({ data: [] }));

    const res = createRes();
    await handler({ method: 'GET', headers: { origin: 'http://localhost:3000' }, query: { flight: 'UA404' } }, res);

    expect(res.statusCode).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/No data found/);
    expect(fetchSpy).toHaveBeenCalledTimes(2); // live empty → summary top-up attempted
  });

  it('a real live-full row (ETA only, no departure time) still asks the summary for the departure', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) =>
      fr24Resp(String(url).includes('/api/live/flight-positions/full') ? LIVE_FULL : { data: [] }));

    const res = createRes();
    await handler({ method: 'GET', headers: { origin: 'http://localhost:3000' }, query: { flight: 'UA2106' } }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.source).toBe('fr24-official-live');
    expect(res.body.liveLeg).toBe(true);
    expect(res.body.flight.arrival.estimated).toBe('2026-09-27T07:22:00Z');
    expect(fetchSpy).toHaveBeenCalledTimes(2); // live-full never carries a departure time
  });
});
