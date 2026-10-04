import { describe, it, expect } from 'vitest';
import { MAX_WATCHED, readWatched, writeWatched, isSignificantStatusChange, flightTimesCacheTtl, applyWatchChanges, watchedFlightLanded } from '../src/lib/watch-utils.js';
import { classifySchedStatus } from '../src/lib/schedule-status.js';

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

  // Changed Oct 4 2026 (audit finding 3/4, phone QA): the status WORD no longer carries delays or
  // gates. A "Delayed" word was on 4 of 2,651 departure rows on Oct 3 while 610 left 15+ min late,
  // so in-tab delay alerts now come from the estimated departure in minutes
  // (evaluateWatchObservation, below); no board status reads "Gate …" at all.
  it('a delay word or a gate word is not a phase change', () => {
    expect(isSignificantStatusChange('SCHEDULED', 'DELAYED +25m')).toBe(false);
    expect(isSignificantStatusChange('Gate C12', 'Gate C14')).toBe(false);
  });

  // Changed: "either side mentions a keyword" is what let "En route (was: En Route)" fire for a
  // flight that had already landed (phone QA Oct 4 2026). Only a forward phase change notifies.
  it('notifies on a forward phase change only — never a re-statement or a step back', () => {
    expect(isSignificantStatusChange('SCHEDULED', 'EN ROUTE')).toBe(true);
    expect(isSignificantStatusChange('DELAYED', 'SCHEDULED')).toBe(false);
    expect(isSignificantStatusChange('En Route', 'En route')).toBe(false);
    expect(isSignificantStatusChange('Departed', 'En Route')).toBe(false);
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

describe('AeroDataBox says "Arrived", never "Landed" (v1.11.3)', () => {
  // classifySchedStatus shows the provider word, so a landed AeroDataBox row reads "Arrived".
  // Neither the watch alert nor the "glad you landed" toast knew that word: the toast's
  // `.includes('landed')` could never match, and Expected → Arrived was not even a change.
  const NOW = 2_000_000;
  const arrivedRow = {
    status: { generic: { status: { text: 'landed', diverted: false }, type: '' }, text: 'arrived', icon: 'green', live: false },
    time: {
      scheduled: { departure: NOW - 4 * 3600, arrival: NOW - 1800 },
      real: { departure: NOW - 4 * 3600, arrival: NOW - 1500 },
      estimated: { departure: null, arrival: null },
    },
  };

  it('treats a watched flight arriving as significant', () => {
    expect(isSignificantStatusChange('Expected', 'Arrived')).toBe(true);
    expect(isSignificantStatusChange('Approaching', 'Arrived')).toBe(true);
    expect(isSignificantStatusChange('En route', 'Arrived')).toBe(true);
  });

  it('stays quiet when only the landed vocabulary flips between providers', () => {
    expect(isSignificantStatusChange('Landed', 'Arrived')).toBe(false);
    expect(isSignificantStatusChange('Arrived', 'Landed')).toBe(false);
    expect(isSignificantStatusChange('LANDED', 'Landed')).toBe(false);
  });

  // Changed Oct 4 2026: leaving the landed state used to alert. It is either the next day's leg on a
  // board (the in-tab twin of the push cron's hub-midnight false alerts, audit finding 2) or the
  // departures board — which never advances to landed — loading after the arrivals board. Neither
  // is news, whichever landed word was stored.
  it('treats leaving the landed state the same whichever word it was stored as: quiet', () => {
    expect(isSignificantStatusChange('Landed', 'Expected')).toBe(false);
    expect(isSignificantStatusChange('Arrived', 'Expected')).toBe(false);
  });

  it('watchedFlightLanded fires for a real AeroDataBox arrival', () => {
    const status = classifySchedStatus(arrivedRow, 'arrivals', NOW);
    expect(status.text).toBe('Arrived');
    expect(status.text.toLowerCase().includes('landed')).toBe(false); // the old check
    expect(watchedFlightLanded('Expected', status)).toBe(true);
    expect(watchedFlightLanded('Departed', classifySchedStatus(arrivedRow, 'departures', NOW))).toBe(true);
  });

  it('watchedFlightLanded ignores a presumed landing, a repeat, and anything that is not a landing', () => {
    const presumed = classifySchedStatus(
      { ...arrivedRow, status: { generic: { status: { text: 'scheduled', diverted: false }, type: '' }, text: 'expected', icon: '', live: false }, time: { ...arrivedRow.time, real: { departure: null, arrival: null } } },
      'arrivals',
      NOW + 3 * 3600,
    );
    expect(presumed.key).toBe('landed');
    expect(presumed.inferred).toBe(true);
    expect(watchedFlightLanded('Expected', presumed)).toBe(false);

    const status = classifySchedStatus(arrivedRow, 'arrivals', NOW);
    expect(watchedFlightLanded('Arrived', status)).toBe(false);
    expect(watchedFlightLanded('Landed', status)).toBe(false);
    expect(watchedFlightLanded('Expected', { key: 'enroute', text: 'En Route' })).toBe(false);
    expect(watchedFlightLanded('Expected', { key: 'diverted', text: 'Diverted' })).toBe(false);
    expect(watchedFlightLanded('Expected', null)).toBe(false);
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

// ── applyWatchChanges — the batch a board load applies in one go ─────────────────────────
// A landed board changes several watched flights at once. Applying them one at a time is how
// earlier transitions get lost; this reducer is the whole batch, and returning the SAME array
// when nothing moved is what keeps a board of unchanged rows from rewriting storage and
// re-rendering every consumer once per poll.

describe('applyWatchChanges', () => {
  const list = () => [
    { flight: 'UA1', route: 'ORD→DEN', status: 'Scheduled', ts: 1 },
    { flight: 'UA2', route: 'ORD→SFO', status: 'Scheduled', ts: 2 },
    { flight: 'UA3', route: '', status: 'Scheduled', ts: 3 },
  ];

  it('applies every status in one pass, in list order', () => {
    const next = applyWatchChanges(list(), [
      { flight: 'UA1', status: 'Departed' },
      { flight: 'UA3', status: 'Landed' },
    ], 999);
    expect(next.map(e => [e.flight, e.status])).toEqual([
      ['UA1', 'Departed'], ['UA2', 'Scheduled'], ['UA3', 'Landed'],
    ]);
  });

  it('restamps ts on a status change and leaves the untouched entries alone', () => {
    const next = applyWatchChanges(list(), [{ flight: 'UA2', status: 'Landed' }], 999);
    expect(next[1].ts).toBe(999);
    expect(next[0].ts).toBe(1);
    expect(next[2].ts).toBe(3);
  });

  it('fills in a route without bumping ts', () => {
    const next = applyWatchChanges(list(), [{ flight: 'UA3', route: 'DEN→IAH' }], 999);
    expect(next[2].route).toBe('DEN→IAH');
    expect(next[2].ts).toBe(3);
  });

  it('takes a status and a route from the same change', () => {
    const next = applyWatchChanges(list(), [{ flight: 'UA3', status: 'Landed', route: 'DEN→IAH' }], 999);
    expect(next[2]).toEqual({ flight: 'UA3', route: 'DEN→IAH', status: 'Landed', ts: 999 });
  });

  it('returns the SAME array when nothing actually moved', () => {
    const before = list();
    expect(applyWatchChanges(before, [{ flight: 'UA1', status: 'Scheduled' }], 999)).toBe(before);
    expect(applyWatchChanges(before, [{ flight: 'UA2', route: 'ORD→SFO' }], 999)).toBe(before);
    expect(applyWatchChanges(before, [], 999)).toBe(before);
  });

  it('ignores a flight that is not watched', () => {
    const before = list();
    expect(applyWatchChanges(before, [{ flight: 'UA99', status: 'Landed' }], 999)).toBe(before);
  });

  it('ignores an empty route and an empty status (edge case)', () => {
    const before = list();
    expect(applyWatchChanges(before, [{ flight: 'UA3', route: '' }], 999)).toBe(before);
    expect(applyWatchChanges(before, [{ flight: 'UA1', status: '' }], 999)).toBe(before);
  });

  it('lets a later change in the same batch build on an earlier one (edge case)', () => {
    const next = applyWatchChanges(list(), [
      { flight: 'UA1', status: 'Departed' },
      { flight: 'UA1', status: 'Landed' },
    ], 999);
    expect(next[0].status).toBe('Landed');
    expect(next.filter(e => e.flight === 'UA1')).toHaveLength(1);
  });

  it('never mutates the list it was given', () => {
    const before = list();
    applyWatchChanges(before, [{ flight: 'UA1', status: 'Landed' }], 999);
    expect(before[0].status).toBe('Scheduled');
    expect(before[0].ts).toBe(1);
  });

  it('survives a malformed change list (edge case)', () => {
    const before = list();
    expect(applyWatchChanges(before, null, 999)).toBe(before);
    expect(applyWatchChanges(before, [null, undefined, {}], 999)).toBe(before);
  });
});
