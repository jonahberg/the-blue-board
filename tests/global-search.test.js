import { describe, it, expect } from 'vitest';
import { normalizeQuery, matchLiveFlights, matchScheduleFlights, classifyEmptyState, FR24_LOOKUP_RE } from '../src/lib/global-search.js';

const live = (over = {}) => ({ callsign: 'UAL373', flightIATA: 'UA373', reg: 'N37502', origin: 'ORD', dest: 'DEN', icao24: 'a1b2c3', ...over });
const sched = (over = {}) => ({
  identification: { number: { default: 'UA373' } },
  aircraft: { registration: 'N37502' },
  airport: { origin: { code: { iata: 'ORD' } }, destination: { code: { iata: 'DEN' } } },
  ...over,
});

describe('normalizeQuery', () => {
  it('upper-cases and strips spaces, hyphens and arrows', () => {
    expect(normalizeQuery('ua 373')).toEqual({ q: 'UA 373', qNorm: 'UA373' });
    expect(normalizeQuery('ORD-DEN')).toEqual({ q: 'ORD-DEN', qNorm: 'ORDDEN' });
    expect(normalizeQuery('ORD → DEN')).toEqual({ q: 'ORD → DEN', qNorm: 'ORDDEN' });
  });

  it('treats " to " as a route separator', () => {
    expect(normalizeQuery('ORD to DEN')).toEqual({ q: 'ORD DEN', qNorm: 'ORDDEN' });
    expect(normalizeQuery('ord  TO  den').qNorm).toBe('ORDDEN');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeQuery('  ua373  ').qNorm).toBe('UA373');
  });

  it('handles empty input (edge case)', () => {
    expect(normalizeQuery('')).toEqual({ q: '', qNorm: '' });
    expect(normalizeQuery('   ')).toEqual({ q: '', qNorm: '' });
  });
});

describe('matchLiveFlights', () => {
  it('matches on callsign, IATA flight number and registration', () => {
    const flights = [live()];
    expect(matchLiveFlights(flights, 'UAL373')).toHaveLength(1);
    expect(matchLiveFlights(flights, 'UA373')).toHaveLength(1);
    expect(matchLiveFlights(flights, 'N37502')).toHaveLength(1);
  });

  it('matches a route in either direction', () => {
    const flights = [live()];
    expect(matchLiveFlights(flights, 'ORDDEN')).toHaveLength(1);
    expect(matchLiveFlights(flights, 'DENORD')).toHaveLength(1);
  });

  it('builds the result label and carries icao24 for focus-flight', () => {
    expect(matchLiveFlights([live()], 'UA373')).toEqual([
      { type: 'live', label: 'UA373 ORD→DEN N37502', icao24: 'a1b2c3' },
    ]);
  });

  it('renders ? for a missing origin or destination (edge case)', () => {
    expect(matchLiveFlights([live({ origin: '', dest: '' })], 'UA373')[0].label).toBe('UA373 ?→? N37502');
    expect(matchLiveFlights([live({ origin: '', dest: '', reg: '' })], 'UA373')[0].label).toBe('UA373 ?→? ');
  });

  it('ignores case and internal punctuation in the flight\'s own fields (edge case)', () => {
    expect(matchLiveFlights([live({ reg: 'n375-02', callsign: '', flightIATA: '' })], 'N37502')).toHaveLength(1);
  });

  it('returns nothing for a query that matches no field', () => {
    expect(matchLiveFlights([live()], 'ZZZZ')).toEqual([]);
    expect(matchLiveFlights([], 'UA373')).toEqual([]);
  });
});

describe('matchScheduleFlights', () => {
  it('matches on ident, registration, origin and destination', () => {
    const rows = [sched()];
    expect(matchScheduleFlights(rows, 'UA373')).toHaveLength(1);
    expect(matchScheduleFlights(rows, 'N37502')).toHaveLength(1);
    expect(matchScheduleFlights(rows, 'ORD')).toHaveLength(1);
    expect(matchScheduleFlights(rows, 'DEN')).toHaveLength(1);
  });

  it('labels schedule rows with the calendar glyph and keeps the row for navigation', () => {
    const rows = [sched()];
    const out = matchScheduleFlights(rows, 'UA373');
    expect(out[0].type).toBe('sched');
    expect(out[0].label).toBe('📅 UA373 ORD→DEN N37502');
    expect(out[0].flight).toBe(rows[0]);
  });

  it('does NOT match a schedule row on a reversed route, unlike the live search (edge case)', () => {
    expect(matchScheduleFlights([sched()], 'ORDDEN')).toEqual([]);
  });

  it('renders ? placeholders for rows missing identifiers (edge case)', () => {
    const bare = { aircraft: {}, airport: {}, identification: {} };
    expect(matchScheduleFlights([bare], '')).toEqual([
      { type: 'sched', label: '📅 ? ?→? ', flight: bare },
    ]);
  });

  it('handles an empty row list', () => {
    expect(matchScheduleFlights([], 'UA373')).toEqual([]);
    expect(matchScheduleFlights(null, 'UA373')).toEqual([]);
  });
});

describe('FR24_LOOKUP_RE', () => {
  it('accepts UA/UAL flight numbers and bare numbers', () => {
    expect(FR24_LOOKUP_RE.test('UA373')).toBe(true);
    expect(FR24_LOOKUP_RE.test('UAL373')).toBe(true);
    expect(FR24_LOOKUP_RE.test('373')).toBe(true);
    expect(FR24_LOOKUP_RE.test('ua1')).toBe(true);
  });

  it('rejects tails, routes and over-long numbers', () => {
    expect(FR24_LOOKUP_RE.test('N37502')).toBe(false);
    expect(FR24_LOOKUP_RE.test('ORDDEN')).toBe(false);
    expect(FR24_LOOKUP_RE.test('12345')).toBe(false);
  });

  it('is not sticky, so repeated tests do not alternate (edge case)', () => {
    expect(FR24_LOOKUP_RE.test('UA373')).toBe(true);
    expect(FR24_LOOKUP_RE.test('UA373')).toBe(true);
  });
});

describe('classifyEmptyState', () => {
  it('points a flight-number query at the Schedule tab', () => {
    const out = classifyEmptyState('UA373');
    expect(out.kind).toBe('flight');
    expect(out.display).toBe('UA373');
  });

  it('prefixes a bare number with UA', () => {
    expect(classifyEmptyState('373')).toEqual({ kind: 'flight', display: 'UA373' });
  });

  it('recognises a tail number', () => {
    expect(classifyEmptyState('N37502')).toEqual({ kind: 'tail', display: 'N37502' });
    expect(classifyEmptyState('N123AB')).toEqual({ kind: 'tail', display: 'N123AB' });
  });

  it('falls back to a generic message for anything else', () => {
    expect(classifyEmptyState('ORDDEN')).toEqual({ kind: 'generic', display: 'ORDDEN' });
    expect(classifyEmptyState('BOEING')).toEqual({ kind: 'generic', display: 'BOEING' });
  });

  it('keeps an already-prefixed UAL query intact (edge case)', () => {
    expect(classifyEmptyState('UAL373')).toEqual({ kind: 'flight', display: 'UAL373' });
  });

  it('handles an empty query (edge case)', () => {
    expect(classifyEmptyState('')).toEqual({ kind: 'generic', display: '' });
  });
});
