import { describe, it, expect } from 'vitest';
import {
  normalizeFlightNumber,
  epochToISO,
  getClientIp,
} from '../api/flight-times.js';

describe('normalizeFlightNumber', () => {
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


describe('getClientIp', () => {
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
