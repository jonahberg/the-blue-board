/**
 * The visitor's own count of flights looked up this month (localStorage only, never sent).
 * Shown by the support strip only when it is at least five; never an estimate.
 */

import { describe, expect, it } from 'vitest';

import {
  FLIGHT_COUNT_STORAGE_KEY,
  PERSONAL_COUNT_MIN,
  localMonthKey,
  parseFlightCount,
  personalCountLine,
  readFlightCount,
  recordFlightOpen,
} from '../src/lib/usage-count.js';

function memoryStore(initial = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => {
      data[key] = String(value);
    },
  };
}

const nov = new Date(2026, 10, 10, 12);
const dec = new Date(2026, 11, 1, 0, 5);

describe('flight count', () => {
  it('counts up within the month and stores `<YYYY-MM>:<n>`', () => {
    const store = memoryStore();
    expect(readFlightCount(store, nov)).toBe(0);
    expect(recordFlightOpen(store, nov)).toBe(1);
    expect(recordFlightOpen(store, nov)).toBe(2);
    expect(store.data[FLIGHT_COUNT_STORAGE_KEY]).toBe('2026-11:2');
    expect(readFlightCount(store, nov)).toBe(2);
  });

  it('starts over on the 1st of the next month', () => {
    const store = memoryStore({ [FLIGHT_COUNT_STORAGE_KEY]: '2026-11:41' });
    expect(readFlightCount(store, dec)).toBe(0);
    expect(recordFlightOpen(store, dec)).toBe(1);
    expect(store.data[FLIGHT_COUNT_STORAGE_KEY]).toBe('2026-12:1');
  });

  it('reads garbage as zero and survives a store that throws', () => {
    expect(readFlightCount(memoryStore({ [FLIGHT_COUNT_STORAGE_KEY]: 'lots' }), nov)).toBe(0);
    const throwing = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };
    expect(readFlightCount(throwing, nov)).toBe(0);
    expect(recordFlightOpen(throwing, nov)).toBeNull();
    expect(readFlightCount(null, nov)).toBe(0);
    expect(recordFlightOpen(null, nov)).toBeNull();
  });

  it('parses only its own format', () => {
    expect(parseFlightCount('2026-11:23')).toEqual({ month: '2026-11', count: 23 });
    for (const bad of [null, '', '23', '2026-11', '2026-11:-1', '2026-11:1.5']) expect(parseFlightCount(bad)).toBeNull();
    expect(localMonthKey(new Date(2027, 0, 3))).toBe('2027-01');
  });
});

describe('personalCountLine', () => {
  it('is null below five and exact from five up', () => {
    expect(PERSONAL_COUNT_MIN).toBe(5);
    expect(personalCountLine(0)).toBeNull();
    expect(personalCountLine(4)).toBeNull();
    expect(personalCountLine(5)).toBe("You've looked up 5 flights here this month.");
    expect(personalCountLine(23)).toBe("You've looked up 23 flights here this month.");
    expect(personalCountLine(Number.NaN)).toBeNull();
    expect(personalCountLine(7.5)).toBeNull();
  });
});
