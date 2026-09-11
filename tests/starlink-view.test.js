import { describe, it, expect } from 'vitest';
import { isRecentlyFound, getServedConflictTails, formatFlightTime, airborneByTail, boardCapPolicy } from '../src/lib/starlink-view.js';

const NOW = Date.parse('2026-09-11T12:00:00Z');
const DAY = 86400000;

describe('isRecentlyFound', () => {
  it('is true for a tail first seen within the last 7 days', () => {
    expect(isRecentlyFound('2026-09-10T00:00:00Z', NOW)).toBe(true);
    expect(isRecentlyFound('2026-09-05T00:00:00Z', NOW)).toBe(true);
  });

  it('is false once the find is older than 7 days', () => {
    expect(isRecentlyFound('2026-09-01T00:00:00Z', NOW)).toBe(false);
    expect(isRecentlyFound(new Date(NOW - 7 * DAY - 1000).toISOString(), NOW)).toBe(false);
  });

  it('tolerates an upstream clock up to a day ahead but no further (edge case)', () => {
    expect(isRecentlyFound(new Date(NOW + DAY - 1000).toISOString(), NOW)).toBe(true);
    expect(isRecentlyFound(new Date(NOW + DAY + 1000).toISOString(), NOW)).toBe(false);
  });

  it('is false for a missing or unparseable date (edge case)', () => {
    expect(isRecentlyFound('', NOW)).toBe(false);
    expect(isRecentlyFound(null, NOW)).toBe(false);
    expect(isRecentlyFound('not a date', NOW)).toBe(false);
  });
});

describe('getServedConflictTails', () => {
  const tails = new Set(['N101', 'N102', 'N103']);

  it('flags a disputed tail that is still in the served snapshot', () => {
    const out = getServedConflictTails([{ tail: 'N101', verifiedAt: '2026-09-10T00:00:00Z' }], tails, '2026-09-11T00:00:00Z');
    expect([...out]).toEqual(['N101']);
  });

  it('ignores a dispute verified AFTER the snapshot — that is normal propagation lag', () => {
    const out = getServedConflictTails([{ tail: 'N101', verifiedAt: '2026-09-11T18:17:00Z' }], tails, '2026-09-11T16:00:00Z');
    expect(out.size).toBe(0);
  });

  it('ignores tails that are not in the served fleet at all', () => {
    const out = getServedConflictTails([{ tail: 'N999', verifiedAt: '2026-09-10T00:00:00Z' }], tails, '2026-09-11T00:00:00Z');
    expect(out.size).toBe(0);
  });

  it('flags the tail when either timestamp is unknown — fail loud (edge case)', () => {
    expect([...getServedConflictTails([{ tail: 'N102' }], tails, '2026-09-11T00:00:00Z')]).toEqual(['N102']);
    expect([...getServedConflictTails([{ tail: 'N102', verifiedAt: '2026-09-10T00:00:00Z' }], tails, null)]).toEqual(['N102']);
    expect([...getServedConflictTails([{ tail: 'N102', verifiedAt: 'garbage' }], tails, '2026-09-11T00:00:00Z')]).toEqual(['N102']);
  });

  it('skips malformed ledger rows and handles an empty ledger (edge case)', () => {
    expect(getServedConflictTails([null, {}, { tail: '' }], tails, '2026-09-11T00:00:00Z').size).toBe(0);
    expect(getServedConflictTails([], tails, '2026-09-11T00:00:00Z').size).toBe(0);
  });
});

describe('formatFlightTime', () => {
  const tzAbbrev = (iata) => ({ ORD: 'CDT', DEN: 'MDT', NRT: 'JST' })[iata] || 'CDT';
  const ts = Date.parse('2026-09-11T18:30:00Z') / 1000;

  it('renders hub departures in hub-local time with the hub TZ abbreviation', () => {
    expect(formatFlightTime(ts, 'ORD', tzAbbrev)).toBe('13:30 CDT');
    expect(formatFlightTime(ts, 'DEN', tzAbbrev)).toBe('12:30 MDT');
  });

  it('crosses the date line correctly for the Pacific hubs', () => {
    expect(formatFlightTime(ts, 'NRT', tzAbbrev)).toBe('03:30 JST');
  });

  it('always carries a timezone label for non-hub airports (edge case)', () => {
    const out = formatFlightTime(ts, 'ATL', tzAbbrev);
    expect(out).toMatch(/^\d{2}:\d{2} \S+$/);
    expect(out).not.toBe('18:30');
  });

  it('returns an empty string for a missing or invalid timestamp (edge case)', () => {
    expect(formatFlightTime(0, 'ORD', tzAbbrev)).toBe('');
    expect(formatFlightTime(null, 'ORD', tzAbbrev)).toBe('');
    expect(formatFlightTime(NaN, 'ORD', tzAbbrev)).toBe('');
  });
});

describe('airborneByTail', () => {
  const tails = new Set(['N37502', 'N26902']);

  it('indexes airborne Starlink aircraft by normalised tail', () => {
    const out = airborneByTail([
      { reg: 'N37502', onGround: false, icao24: 'aaa' },
      { reg: 'N26902', onGround: false, icao24: 'bbb' },
    ], tails);
    expect(Object.keys(out).sort()).toEqual(['N26902', 'N37502']);
    expect(out.N37502.icao24).toBe('aaa');
  });

  it('excludes aircraft on the ground', () => {
    const out = airborneByTail([{ reg: 'N37502', onGround: true }], tails);
    expect(out).toEqual({});
  });

  it('excludes aircraft that are not Starlink-equipped', () => {
    expect(airborneByTail([{ reg: 'N99999', onGround: false }], tails)).toEqual({});
  });

  it('normalises hyphens and case in the registration (edge case)', () => {
    const out = airborneByTail([{ reg: 'n375-02', onGround: false, icao24: 'ccc' }], tails);
    expect(out.N37502.icao24).toBe('ccc');
  });

  it('skips flights with no registration and handles an empty feed (edge case)', () => {
    expect(airborneByTail([{ onGround: false }, { reg: '', onGround: false }], tails)).toEqual({});
    expect(airborneByTail([], tails)).toEqual({});
  });
});

describe('boardCapPolicy', () => {
  it('caps the all-hubs view tightly so the board does not bury the roster', () => {
    expect(boardCapPolicy({ showAll: false, hub: '', windowH: 12 })).toBe(6);
    expect(boardCapPolicy({ showAll: false, hub: '', windowH: 48 })).toBe(6);
  });

  it('shows everything for a single hub over 12 hours', () => {
    expect(boardCapPolicy({ showAll: false, hub: 'ORD', windowH: 12 })).toBe(Infinity);
  });

  it('caps a single hub at 40 rows in the wide 48-hour view', () => {
    expect(boardCapPolicy({ showAll: false, hub: 'ORD', windowH: 48 })).toBe(40);
  });

  it('lifts every cap once the viewer asks to show all', () => {
    expect(boardCapPolicy({ showAll: true, hub: '', windowH: 12 })).toBe(Infinity);
    expect(boardCapPolicy({ showAll: true, hub: 'ORD', windowH: 48 })).toBe(Infinity);
  });

  it('treats the all-hubs check as "no hub selected" (edge case)', () => {
    expect(boardCapPolicy({ showAll: false, hub: null, windowH: 12 })).toBe(6);
    expect(boardCapPolicy({ showAll: false, hub: undefined, windowH: 48 })).toBe(6);
  });
});
