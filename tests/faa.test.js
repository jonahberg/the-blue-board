import { describe, it, expect } from 'vitest';
import { toArray, parseDelayMinutes } from '../api/faa.js';

describe('toArray', () => {
  it('returns empty array for undefined', () => {
    expect(toArray(undefined)).toEqual([]);
  });

  it('returns empty array for null', () => {
    expect(toArray(null)).toEqual([]);
  });

  it('returns empty array for 0', () => {
    expect(toArray(0)).toEqual([]);
  });

  it('returns empty array for empty string', () => {
    expect(toArray('')).toEqual([]);
  });

  it('wraps a single object in an array', () => {
    const obj = { ARPT: 'ORD', Reason: 'Weather' };
    expect(toArray(obj)).toEqual([obj]);
  });

  it('returns an array as-is', () => {
    const arr = [{ ARPT: 'ORD' }, { ARPT: 'EWR' }];
    expect(toArray(arr)).toBe(arr); // same reference
  });

  it('wraps a string in an array', () => {
    expect(toArray('hello')).toEqual(['hello']);
  });

  it('wraps a number in an array', () => {
    expect(toArray(42)).toEqual([42]);
  });
});

describe('parseDelayMinutes', () => {
  it('returns null for null/undefined/empty', () => {
    expect(parseDelayMinutes(null)).toBe(null);
    expect(parseDelayMinutes(undefined)).toBe(null);
    expect(parseDelayMinutes('')).toBe(null);
  });

  it('parses numeric values directly', () => {
    expect(parseDelayMinutes(18)).toBe(18);
    expect(parseDelayMinutes(18.7)).toBe(19);
    expect(parseDelayMinutes(0)).toBe(0);
  });

  it('parses numeric strings', () => {
    expect(parseDelayMinutes('30')).toBe(30);
    expect(parseDelayMinutes('45')).toBe(45);
  });

  it('parses "X minutes" format (XML fallback)', () => {
    expect(parseDelayMinutes('31 minutes')).toBe(31);
    expect(parseDelayMinutes('45 minutes')).toBe(45);
  });

  it('parses "X hours and Y minutes" format (XML fallback)', () => {
    expect(parseDelayMinutes('5 hours and 45 minutes')).toBe(345);
    expect(parseDelayMinutes('1 hour and 30 minutes')).toBe(90);
    expect(parseDelayMinutes('24 hours')).toBe(1440);
  });

  it('returns null for NaN/Infinity', () => {
    expect(parseDelayMinutes(NaN)).toBe(null);
    expect(parseDelayMinutes(Infinity)).toBe(null);
  });

  it('returns null for non-parseable strings', () => {
    expect(parseDelayMinutes('hello')).toBe(null);
    expect(parseDelayMinutes('N/A')).toBe(null);
  });

  it('handles JSON numeric avgDelay (18.0)', () => {
    expect(parseDelayMinutes(18.0)).toBe(18);
  });

  it('handles JSON numeric maxDelay (54)', () => {
    expect(parseDelayMinutes(54)).toBe(54);
  });
});
