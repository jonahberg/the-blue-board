import { describe, it, expect } from 'vitest';
import { AIRPORT_TZ, airportTz, formatTimeWithTz, getTzAbbrev } from '../src/lib/time-format.js';
import { AIRPORTS } from '../src/lib/airports.js';

// This module exists to stop the flight popup silently rendering a departure time
// in the viewer's timezone next to a labeled arrival. Its guarantee: always append
// a real tz abbreviation (or the zone's GMT offset), or an explicit "your time" label
// — never a silent, unlabeled viewer-local render, and never "local" for a time that
// is really on the viewer's clock (F11). These tests guard that contract.

describe('formatTimeWithTz', () => {
  const iso = '2026-07-10T18:00:00Z';

  it('appends a real timezone abbreviation for a known IANA tz (never bare "local")', () => {
    const out = formatTimeWithTz(iso, 'America/Chicago');
    expect(out).toMatch(/\b(CST|CDT)\b/);
    expect(out.endsWith(' local')).toBe(false);
  });

  it('labels a missing tz as "your time" — "local" read as the airport clock (F11)', () => {
    expect(formatTimeWithTz(iso, undefined).endsWith(' your time')).toBe(true);
    expect(formatTimeWithTz(iso, '').endsWith(' your time')).toBe(true);
    expect(formatTimeWithTz(iso, '')).not.toMatch(/local/);
  });

  it('falls back to "your time" (no throw) for an unrecognized IANA string', () => {
    let out;
    expect(() => {
      out = formatTimeWithTz(iso, 'Not/AZone');
    }).not.toThrow();
    expect(out.endsWith(' your time')).toBe(true);
  });

  it('labels a zone with no US abbreviation by its offset, in that zone', () => {
    // 18:00Z is 02:00 the next morning in Singapore.
    expect(formatTimeWithTz(iso, 'Asia/Singapore')).toBe('2:00 AM GMT+8');
  });

  it('returns null for a null/absent iso', () => {
    expect(formatTimeWithTz(null, 'America/Chicago')).toBeNull();
    expect(formatTimeWithTz(undefined, 'America/Chicago')).toBeNull();
  });

  it('returns null for an unparseable iso string', () => {
    expect(formatTimeWithTz('garbage', 'America/Chicago')).toBeNull();
  });
});

describe('getTzAbbrev', () => {
  const date = new Date('2026-07-10T18:00:00Z');

  it('resolves a non-empty abbreviation for a real tz', () => {
    expect(getTzAbbrev(date, 'America/Chicago')).toMatch(/\b(CST|CDT)\b/);
  });

  it('rejects a bare numeric-offset fallback (GMT-5) so the caller labels "local"', () => {
    // Etc/GMT+5 formats as "GMT-5" — not a real abbreviation; must return ''.
    expect(getTzAbbrev(date, 'Etc/GMT+5')).toBe('');
  });

  it('returns empty string for an invalid tz (via catch)', () => {
    expect(getTzAbbrev(date, 'Not/AZone')).toBe('');
  });
});

describe('airportTz', () => {
  it('knows the zone of every airport in the static airport table', () => {
    const missing = AIRPORTS.map((a) => a.iata).filter((code) => !AIRPORT_TZ[code]);
    expect(missing).toEqual([]);
  });

  it('every zone is one the runtime accepts', () => {
    for (const zone of new Set(Object.values(AIRPORT_TZ))) {
      expect(() => new Intl.DateTimeFormat('en-US', { timeZone: zone })).not.toThrow();
    }
  });

  it('resolves case-insensitively and answers "" for an unknown code', () => {
    expect(airportTz('ord')).toBe('America/Chicago');
    expect(airportTz('SIN')).toBe('Asia/Singapore');
    expect(airportTz('ZZZ')).toBe('');
    expect(airportTz(undefined)).toBe('');
  });

  it('an ORD takeoff reads in Chicago time, not the viewer\'s (F11 repro)', () => {
    // 03:17Z = 22:17 CDT the evening before.
    expect(formatTimeWithTz('2026-09-27T03:17:53Z', airportTz('ORD'))).toBe('10:17 PM CDT');
  });
});
