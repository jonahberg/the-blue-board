import { describe, it, expect } from 'vitest';
import {
  LIVE_RECENT_MS, extractSightings, sightingMatchesFlight, applySightingsToBoard,
} from '../src/lib/reg-overlay.js';

const H = 3600e3;
const NOW = 1_750_000_000_000;
const depSec = Math.floor(NOW / 1000) - 1800; // scheduled 30 min ago
const arrSec = depSec + 4 * 3600;

const boardFlight = (over = {}) => ({
  identification: { number: { default: 'UA123' } },
  time: { scheduled: { departure: depSec, arrival: arrSec } },
  airport: { origin: { code: { iata: 'ORD' } }, destination: { code: { iata: 'SFO' } } },
  aircraft: { model: { code: '739' }, registration: '' },
  ...over,
});
const sighting = (over = {}) => ({ reg: 'N12345', origin: 'ORD', dest: 'SFO', seenAtMs: NOW - 5 * 60e3, ...over });

describe('extractSightings', () => {
  it('builds upsert rows from parsed feed flights, deduped by key, reg required', () => {
    const rows = extractSightings([
      { flightIATA: 'UA123', callsign: 'UAL123', reg: 'N12345', origin: 'ORD', dest: 'SFO' },
      { flightIATA: 'UA123', callsign: 'UAL123', reg: 'N99999', origin: 'ORD', dest: 'SFO' }, // dup key: first wins
      { flightIATA: '', callsign: 'UAL456', reg: 'N45678', origin: 'ewr', dest: 'lax' },
      { flightIATA: 'UA789', callsign: 'UAL789', reg: '' },          // no reg
      { flightIATA: 'G7929', callsign: 'GJS929', reg: 'N11111' },    // not mainline
    ], NOW);
    expect(rows).toEqual([
      { flight_key: 'UA123', reg: 'N12345', origin: 'ORD', dest: 'SFO', seen_at: new Date(NOW).toISOString() },
      { flight_key: 'UA456', reg: 'N45678', origin: 'EWR', dest: 'LAX', seen_at: new Date(NOW).toISOString() },
    ]);
  });
  it('handles garbage input', () => {
    expect(extractSightings(null, NOW)).toEqual([]);
    expect(extractSightings([null, {}], NOW)).toEqual([]);
  });
});

describe('sightingMatchesFlight', () => {
  it('matches inside the operation window with agreeing route', () => {
    expect(sightingMatchesFlight(sighting(), boardFlight())).toBe(true);
  });
  it('rejects sightings outside the operation window (another day’s instance)', () => {
    expect(sightingMatchesFlight(sighting({ seenAtMs: depSec * 1000 - 24 * H }), boardFlight())).toBe(false);
    expect(sightingMatchesFlight(sighting({ seenAtMs: arrSec * 1000 + 24 * H }), boardFlight())).toBe(false);
  });
  it('uses a 16h span when scheduled arrival is missing', () => {
    const fl = boardFlight({ time: { scheduled: { departure: depSec } } });
    expect(sightingMatchesFlight(sighting(), fl)).toBe(true);
    expect(sightingMatchesFlight(sighting({ seenAtMs: depSec * 1000 + 20 * H }), fl)).toBe(false);
  });
  it('rejects a route mismatch, tolerates missing codes on either side', () => {
    expect(sightingMatchesFlight(sighting({ origin: 'DEN' }), boardFlight())).toBe(false);
    expect(sightingMatchesFlight(sighting({ dest: 'LAX' }), boardFlight())).toBe(false);
    expect(sightingMatchesFlight(sighting({ origin: '', dest: '' }), boardFlight())).toBe(true);
    const noRouteFlight = boardFlight({ airport: {} });
    expect(sightingMatchesFlight(sighting(), noRouteFlight)).toBe(true);
  });
  it('requires a scheduled departure and a usable sighting', () => {
    expect(sightingMatchesFlight(sighting(), boardFlight({ time: { scheduled: {} } }))).toBe(false);
    expect(sightingMatchesFlight(sighting({ seenAtMs: NaN }), boardFlight())).toBe(false);
    expect(sightingMatchesFlight(sighting({ reg: '' }), boardFlight())).toBe(false);
    expect(sightingMatchesFlight(null, boardFlight())).toBe(false);
  });
});

describe('applySightingsToBoard', () => {
  const mapOf = (s) => new Map([['UA123', s]]);

  it('backfills a blank registration and tags regSource', () => {
    const payload = { flights: [boardFlight()], meta: { completeness: 1 } };
    const out = applySightingsToBoard(payload, mapOf(sighting()), NOW);
    expect(out.flights[0].aircraft.registration).toBe('N12345');
    expect(out.flights[0].aircraft.regSource).toBe('live_feed');
    expect(out.flights[0].aircraft.model.code).toBe('739'); // rest of aircraft preserved
  });

  it('NEVER overwrites a provider registration', () => {
    const payload = { flights: [boardFlight({ aircraft: { registration: 'N77777' } })] };
    const out = applySightingsToBoard(payload, mapOf(sighting()), NOW);
    expect(out.flights[0].aircraft.registration).toBe('N77777');
    expect(out.flights[0].aircraft.regSource).toBeUndefined();
  });

  it('attaches live:{seenAt} for recent sightings — including rows WITH a provider reg', () => {
    const recent = sighting({ seenAtMs: NOW - 5 * 60e3 });
    const withReg = { flights: [boardFlight({ aircraft: { registration: 'N77777' } })] };
    expect(applySightingsToBoard(withReg, mapOf(recent), NOW).flights[0].live).toEqual({ seenAt: recent.seenAtMs });
    const old = sighting({ seenAtMs: NOW - LIVE_RECENT_MS - 1000 });
    const out = applySightingsToBoard({ flights: [boardFlight()] }, mapOf(old), NOW);
    expect(out.flights[0].live).toBeUndefined();          // old sighting: reg fills, no live flag
    expect(out.flights[0].aircraft.registration).toBe('N12345');
  });

  it('does not mutate the input payload or its flights (shared cache objects)', () => {
    const fl = boardFlight();
    const payload = { flights: [fl] };
    const out = applySightingsToBoard(payload, mapOf(sighting()), NOW);
    expect(fl.aircraft.registration).toBe('');
    expect(fl.live).toBeUndefined();
    expect(payload.flights[0]).toBe(fl);
    expect(out).not.toBe(payload);
  });

  it('returns the SAME payload reference when nothing changes', () => {
    const payload = { flights: [boardFlight({ identification: { number: { default: 'UA999' } } })] };
    expect(applySightingsToBoard(payload, mapOf(sighting()), NOW)).toBe(payload);
    expect(applySightingsToBoard(payload, new Map(), NOW)).toBe(payload);
    expect(applySightingsToBoard(null, mapOf(sighting()), NOW)).toBe(null);
  });
});
