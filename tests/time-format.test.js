import { describe, it, expect } from 'vitest';
import { formatTimeWithTz, getTzAbbrev } from '../src/lib/time-format.js';

// This module exists to stop the flight popup silently rendering a departure time
// in the viewer's timezone next to a labeled arrival. Its guarantee: always append
// a real tz abbreviation, or an explicit "local" label — never a silent, unlabeled
// viewer-local render. These tests guard that contract.

describe('formatTimeWithTz', () => {
  const iso = '2026-07-10T18:00:00Z';

  it('appends a real timezone abbreviation for a known IANA tz (never bare "local")', () => {
    const out = formatTimeWithTz(iso, 'America/Chicago');
    expect(out).toMatch(/\b(CST|CDT)\b/);
    expect(out.endsWith(' local')).toBe(false);
  });

  it('labels a missing tz explicitly as "local" rather than rendering it unmarked', () => {
    expect(formatTimeWithTz(iso, undefined).endsWith(' local')).toBe(true);
    expect(formatTimeWithTz(iso, '').endsWith(' local')).toBe(true);
  });

  it('falls back to an explicit "local" label (no throw) for an unrecognized IANA string', () => {
    let out;
    expect(() => {
      out = formatTimeWithTz(iso, 'Not/AZone');
    }).not.toThrow();
    expect(out.endsWith(' local')).toBe(true);
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
