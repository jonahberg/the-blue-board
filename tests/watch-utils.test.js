import { describe, it, expect } from 'vitest';
import { MAX_WATCHED, readWatched, writeWatched, isSignificantStatusChange, flightTimesCacheTtl } from '../src/lib/watch-utils.js';

function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    _dump: () => Object.fromEntries(map),
  };
}

const watch = (flight) => ({ flight, route: 'ORD→DEN', status: 'SCHEDULED', ts: 1 });

describe('MAX_WATCHED', () => {
  it('caps the watch list at 20', () => {
    expect(MAX_WATCHED).toBe(20);
  });
});

describe('readWatched', () => {
  it('parses the stored list', () => {
    const s = fakeStorage({ bb_watched_flights: JSON.stringify([watch('UA373')]) });
    expect(readWatched(s)).toEqual([watch('UA373')]);
  });

  it('returns an empty list when nothing is stored', () => {
    expect(readWatched(fakeStorage())).toEqual([]);
  });

  it('returns an empty list rather than throwing on corrupt JSON (edge case)', () => {
    expect(readWatched(fakeStorage({ bb_watched_flights: 'not json{' }))).toEqual([]);
  });

  it('returns an empty list when storage itself throws (edge case)', () => {
    expect(readWatched({ getItem() { throw new Error('SecurityError'); } })).toEqual([]);
  });
});

describe('writeWatched', () => {
  it('stores the list under bb_watched_flights as JSON', () => {
    const s = fakeStorage();
    writeWatched(s, [watch('UA373')]);
    expect(JSON.parse(s.getItem('bb_watched_flights'))).toEqual([watch('UA373')]);
  });

  it('truncates to MAX_WATCHED entries', () => {
    const s = fakeStorage();
    writeWatched(s, Array.from({ length: 25 }, (_, i) => watch('UA' + i)));
    const stored = JSON.parse(s.getItem('bb_watched_flights'));
    expect(stored).toHaveLength(MAX_WATCHED);
    expect(stored[19].flight).toBe('UA19');
  });

  it('never throws when storage is full or unavailable (edge case)', () => {
    expect(() => writeWatched({ setItem() { throw new Error('QuotaExceededError'); } }, [watch('UA1')])).not.toThrow();
  });

  it('round-trips through readWatched', () => {
    const s = fakeStorage();
    writeWatched(s, [watch('UA1'), watch('UA2')]);
    expect(readWatched(s).map((w) => w.flight)).toEqual(['UA1', 'UA2']);
  });
});

describe('isSignificantStatusChange', () => {
  it('notifies on the terminal states', () => {
    expect(isSignificantStatusChange('SCHEDULED', 'CANCELLED')).toBe(true);
    expect(isSignificantStatusChange('EN ROUTE', 'DIVERTED')).toBe(true);
    expect(isSignificantStatusChange('EN ROUTE', 'LANDED')).toBe(true);
    expect(isSignificantStatusChange('SCHEDULED', 'DEPARTED')).toBe(true);
  });

  it('notifies when a delay appears or a gate changes', () => {
    expect(isSignificantStatusChange('SCHEDULED', 'DELAYED +25m')).toBe(true);
    expect(isSignificantStatusChange('Gate C12', 'Gate C14')).toBe(true);
  });

  it('notifies when either side mentions a significant keyword', () => {
    expect(isSignificantStatusChange('SCHEDULED', 'EN ROUTE')).toBe(true);
    expect(isSignificantStatusChange('DELAYED', 'SCHEDULED')).toBe(true);
  });

  it('stays quiet when the status is unchanged', () => {
    expect(isSignificantStatusChange('SCHEDULED', 'SCHEDULED')).toBe(false);
    expect(isSignificantStatusChange('LANDED', 'LANDED')).toBe(false);
  });

  it('stays quiet when either status is missing (edge case)', () => {
    expect(isSignificantStatusChange('', 'CANCELLED')).toBe(false);
    expect(isSignificantStatusChange('SCHEDULED', '')).toBe(false);
    expect(isSignificantStatusChange(null, undefined)).toBe(false);
  });

  it('stays quiet for a cosmetic change with no significant keyword (edge case)', () => {
    expect(isSignificantStatusChange('On time', 'On Time')).toBe(false);
  });
});

describe('flightTimesCacheTtl', () => {
  // Jitter is deterministic: sum of char codes mod 20000.
  const jitter = (s) => s.split('').reduce((n, c) => n + c.charCodeAt(0), 0) % 20000;
  const NOW = Date.parse('2026-09-11T12:00:00Z');
  const dep = (iso) => ({ success: true, departure: { gate: { scheduled: iso } } });

  it('caches a failed lookup for 30 seconds plus jitter', () => {
    expect(flightTimesCacheTtl({ success: false }, 'UA373', NOW)).toBe(30000 + jitter('UA373'));
    expect(flightTimesCacheTtl(null, 'UA373', NOW)).toBe(30000 + jitter('UA373'));
  });

  it('caches a resolved flight for 5 minutes plus jitter', () => {
    const landed = { success: true, status: 'Landed', arrival: { gate: { actual: '2026-09-11T11:00:00Z' } } };
    expect(flightTimesCacheTtl(landed, 'UA373', NOW)).toBe(300000 + jitter('UA373'));
    expect(flightTimesCacheTtl({ success: true, cancelled: true }, 'UA373', NOW)).toBe(300000 + jitter('UA373'));
    expect(flightTimesCacheTtl({ success: true, diverted: true }, 'UA373', NOW)).toBe(300000 + jitter('UA373'));
  });

  it('tightens to 45 seconds inside the 90-minute departure window', () => {
    expect(flightTimesCacheTtl(dep('2026-09-11T13:00:00Z'), 'UA373', NOW)).toBe(45000 + jitter('UA373'));
  });

  it('uses 60 seconds inside 6 hours and 120 seconds beyond it', () => {
    expect(flightTimesCacheTtl(dep('2026-09-11T15:00:00Z'), 'UA373', NOW)).toBe(60000 + jitter('UA373'));
    expect(flightTimesCacheTtl(dep('2026-09-11T23:00:00Z'), 'UA373', NOW)).toBe(120000 + jitter('UA373'));
  });

  it('prefers the estimated departure over the scheduled one', () => {
    const td = { success: true, departure: { gate: { scheduled: '2026-09-11T23:00:00Z', estimated: '2026-09-11T13:00:00Z' } } };
    expect(flightTimesCacheTtl(td, 'UA373', NOW)).toBe(45000 + jitter('UA373'));
  });

  it('falls back to the long TTL when there is no departure time at all (edge case)', () => {
    expect(flightTimesCacheTtl({ success: true }, 'UA373', NOW)).toBe(120000 + jitter('UA373'));
  });

  it('spreads identical flights apart by a deterministic jitter under 20 s (edge case)', () => {
    const a = flightTimesCacheTtl({ success: false }, 'UA1', NOW);
    const b = flightTimesCacheTtl({ success: false }, 'UA2', NOW);
    expect(a).not.toBe(b);
    expect(Math.abs(a - b)).toBeLessThan(20000);
    expect(flightTimesCacheTtl({ success: false }, '', NOW)).toBe(30000);
    expect(flightTimesCacheTtl({ success: false }, null, NOW)).toBe(30000);
  });
});
