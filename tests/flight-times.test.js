import { describe, it, expect } from 'vitest';
import {
  normalizeFlightNumber,
  epochToISO,
  getClientIp,
  extractFaRegistration,
  faLocalDate,
  pickBestFaCandidate,
} from '../api/flight-times.js';

describe('normalizeFlightNumber (FlightAware)', () => {
  it('converts UA prefix to UAL', () => {
    expect(normalizeFlightNumber('UA2221')).toBe('UAL2221');
  });

  it('prepends UAL to bare numbers', () => {
    expect(normalizeFlightNumber('2221')).toBe('UAL2221');
  });

  it('leaves UAL prefix as-is', () => {
    expect(normalizeFlightNumber('UAL100')).toBe('UAL100');
  });

  it('trims whitespace and uppercases', () => {
    expect(normalizeFlightNumber('  ua 838 ')).toBe('UAL838');
  });

  it('handles empty/null input', () => {
    expect(normalizeFlightNumber('')).toBe('');
    expect(normalizeFlightNumber(null)).toBe('');
    expect(normalizeFlightNumber(undefined)).toBe('');
  });

  it('handles array input (takes first element)', () => {
    expect(normalizeFlightNumber(['UA100', 'UA200'])).toBe('UAL100');
  });

  it('handles single-digit flight numbers', () => {
    expect(normalizeFlightNumber('1')).toBe('UAL1');
  });
});

describe('epochToISO', () => {
  it('converts valid epoch to ISO string', () => {
    // 2024-01-01T00:00:00.000Z
    const result = epochToISO(1704067200);
    expect(result).toBe('2024-01-01T00:00:00.000Z');
  });

  it('returns empty string for 0', () => {
    expect(epochToISO(0)).toBe('');
  });

  it('returns empty string for null', () => {
    expect(epochToISO(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(epochToISO(undefined)).toBe('');
  });

  it('handles recent timestamps', () => {
    const result = epochToISO(1700000000);
    expect(result).toMatch(/^2023-11-14T/);
  });
});


describe('getClientIp (FlightAware)', () => {
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

// F001: flight-times must expose a real `registration` field so consumers stop
// mis-treating the aircraft TYPE string as a tail number.
describe('extractFaRegistration (F001)', () => {
  it('reads a string aircraft field as the tail', () => {
    expect(extractFaRegistration({ aircraft: 'N37502' })).toBe('N37502');
  });
  it('reads nested aircraft.registration', () => {
    expect(extractFaRegistration({ aircraft: { registration: 'N12345' } })).toBe('N12345');
  });
  it('reads a top-level tailNumber / registration', () => {
    expect(extractFaRegistration({ tailNumber: 'N-77066' })).toBe('N77066');
    expect(extractFaRegistration({ registration: 'n14118' })).toBe('N14118');
  });
  it('returns empty string when no tail is present (graceful degradation)', () => {
    expect(extractFaRegistration({ aircraftTypeFriendly: 'Boeing 737-900' })).toBe('');
    expect(extractFaRegistration({})).toBe('');
    expect(extractFaRegistration(null)).toBe('');
  });
});

describe('faLocalDate (F013)', () => {
  it('formats the departure epoch in the origin timezone (YYYY-MM-DD)', () => {
    // 2026-07-08T02:00:00Z is still 2026-07-07 in America/Chicago.
    const sec = Math.floor(Date.parse('2026-07-08T02:00:00Z') / 1000);
    expect(faLocalDate(sec, ':America/Chicago')).toBe('2026-07-07');
    expect(faLocalDate(sec, 'UTC')).toBe('2026-07-08');
  });
  it('returns empty string for a missing epoch', () => {
    expect(faLocalDate(0, 'UTC')).toBe('');
  });
});

describe('pickBestFaCandidate — date + phase ranking (F005/F013)', () => {
  const nowSec = Math.floor(Date.parse('2026-07-08T12:00:00Z') / 1000);
  const c = (phase, depSec, localDate) => ({ flight: { phase, depSec, localDate }, key: phase + depSec, phase, depSec, localDate });

  it('todays scheduled beats a past landed leg (reverses the old landed-wins bug)', () => {
    const landed = c('landed', nowSec - 6 * 3600, '2026-07-08');
    const scheduled = c('scheduled', nowSec + 3 * 3600, '2026-07-08');
    const best = pickBestFaCandidate([landed, scheduled], '', nowSec);
    expect(best.phase).toBe('scheduled');
  });

  it('in-air wins over everything', () => {
    const landed = c('landed', nowSec - 3600, '2026-07-08');
    const scheduled = c('scheduled', nowSec + 3600, '2026-07-08');
    const inair = c('inair', nowSec - 1800, '2026-07-08');
    expect(pickBestFaCandidate([landed, scheduled, inair], '', nowSec).phase).toBe('inair');
  });

  it('a matching target date wins outright over phase', () => {
    // Tomorrow's scheduled leg beats today's already-landed leg when date=tomorrow.
    const landedToday = c('landed', nowSec - 3600, '2026-07-08');
    const schedTomorrow = c('scheduled', nowSec + 20 * 3600, '2026-07-09');
    const best = pickBestFaCandidate([landedToday, schedTomorrow], '2026-07-09', nowSec);
    expect(best.localDate).toBe('2026-07-09');
    expect(best.phase).toBe('scheduled');
  });

  it('scheduled ties pick the SOONEST upcoming leg, not the furthest-future', () => {
    const soon = c('scheduled', nowSec + 2 * 3600, '2026-07-08');
    const later = c('scheduled', nowSec + 8 * 3600, '2026-07-08');
    expect(pickBestFaCandidate([later, soon], '', nowSec).depSec).toBe(soon.depSec);
  });

  // A stale board row (scheduled but the departure time is well in the past, never
  // departed) must rank BELOW a real landed leg — the incident-#3 failure class.
  it('a stale past-scheduled leg loses to a real landed leg', () => {
    const stale = c('scheduled', nowSec - 6 * 3600, '2026-07-08');
    const landed = c('landed', nowSec - 3 * 3600, '2026-07-08');
    expect(pickBestFaCandidate([stale, landed], '', nowSec).phase).toBe('landed');
  });

  it('the scheduled grace boundary is 30 minutes past nowSec', () => {
    // Just inside the grace window (rank 2): current scheduled beats a landed leg.
    const current = c('scheduled', nowSec - 1799, '2026-07-08');
    const landedA = c('landed', nowSec - 3 * 3600, '2026-07-08');
    expect(pickBestFaCandidate([current, landedA], '', nowSec).phase).toBe('scheduled');

    // Just past the grace window (rank 0, stale): the landed leg wins instead.
    const stale = c('scheduled', nowSec - 1801, '2026-07-08');
    const landedB = c('landed', nowSec - 3 * 3600, '2026-07-08');
    expect(pickBestFaCandidate([stale, landedB], '', nowSec).phase).toBe('landed');
  });

  it('returns null for an empty candidate list', () => {
    expect(pickBestFaCandidate([], '', nowSec)).toBeNull();
  });
});
