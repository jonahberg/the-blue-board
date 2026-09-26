import { describe, it, expect } from 'vitest';
import { HOME_HUB_CYCLE, readHomeAirport, writeHomeAirport, nextHomeAirport } from '../src/lib/home-airport.js';

/** Minimal in-memory stand-in for localStorage. */
function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    _dump: () => Object.fromEntries(map),
  };
}

describe('HOME_HUB_CYCLE', () => {
  it('starts with the "no preference" empty string, then the nine hubs', () => {
    expect(HOME_HUB_CYCLE).toEqual(['', 'ORD', 'DEN', 'IAH', 'EWR', 'SFO', 'IAD', 'LAX', 'NRT', 'GUM']);
  });

  it('is the header button cycle, not the hub-health bar order', () => {
    // The health bar renders ORD DEN IAH EWR SFO IAD LAX NRT GUM with no blank slot.
    expect(HOME_HUB_CYCLE[0]).toBe('');
    expect(HOME_HUB_CYCLE).toHaveLength(10);
  });

  it('contains each hub exactly once (edge case)', () => {
    expect(new Set(HOME_HUB_CYCLE).size).toBe(HOME_HUB_CYCLE.length);
  });
});

describe('readHomeAirport', () => {
  it('reads the stored IATA code', () => {
    expect(readHomeAirport(fakeStorage({ bb_home_airport: 'DEN' }))).toBe('DEN');
  });

  it('returns an empty string when nothing is stored', () => {
    expect(readHomeAirport(fakeStorage())).toBe('');
  });

  it('returns an empty string for a stored empty value (edge case)', () => {
    expect(readHomeAirport(fakeStorage({ bb_home_airport: '' }))).toBe('');
  });
});

describe('writeHomeAirport', () => {
  it('stores a chosen hub under bb_home_airport', () => {
    const s = fakeStorage();
    writeHomeAirport(s, 'SFO');
    expect(s._dump()).toEqual({ bb_home_airport: 'SFO' });
  });

  it('REMOVES the key rather than storing an empty string when the choice is cleared', () => {
    const s = fakeStorage({ bb_home_airport: 'ORD' });
    writeHomeAirport(s, '');
    expect(s._dump()).toEqual({});
    expect(readHomeAirport(s)).toBe('');
  });

  it('treats null/undefined the same as clearing (edge case)', () => {
    const s = fakeStorage({ bb_home_airport: 'IAH' });
    writeHomeAirport(s, null);
    expect(s._dump()).toEqual({});
    writeHomeAirport(s, 'IAD');
    writeHomeAirport(s, undefined);
    expect(s._dump()).toEqual({});
  });

  it('round-trips through readHomeAirport', () => {
    const s = fakeStorage();
    writeHomeAirport(s, 'NRT');
    expect(readHomeAirport(s)).toBe('NRT');
  });
});

describe('nextHomeAirport', () => {
  it('advances one step along the cycle', () => {
    expect(nextHomeAirport('')).toBe('ORD');
    expect(nextHomeAirport('ORD')).toBe('DEN');
    expect(nextHomeAirport('NRT')).toBe('GUM');
  });

  it('wraps from the last hub back to "no preference"', () => {
    expect(nextHomeAirport('GUM')).toBe('');
  });

  it('falls back to ORD for a code that is not in the cycle (edge case)', () => {
    // indexOf → -1, so (-1 + 1) % 10 === 0 → '' … then the caller cycles on.
    expect(nextHomeAirport('ATL')).toBe('');
    expect(nextHomeAirport(undefined)).toBe('');
  });

  it('visits every hub in ten steps and returns to the start', () => {
    let cur = '';
    const seen = [];
    for (let i = 0; i < HOME_HUB_CYCLE.length; i++) { cur = nextHomeAirport(cur); seen.push(cur); }
    expect(seen).toEqual(['ORD', 'DEN', 'IAH', 'EWR', 'SFO', 'IAD', 'LAX', 'NRT', 'GUM', '']);
    expect(cur).toBe('');
  });
});
