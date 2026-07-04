import { describe, it, expect } from 'vitest';
import { firstFutureIndex, nowDividerIndex, NOW_GRACE_SECONDS } from '../src/lib/board-now.js';

const NOW = 1_800_000_000; // arbitrary anchor

describe('firstFutureIndex', () => {
  it('finds the first row at or after now', () => {
    const times = [NOW - 7200, NOW - 3600, NOW + 600, NOW + 7200];
    expect(firstFutureIndex(times, NOW)).toBe(2);
  });

  it('includes rows up to 30 minutes in the past (still boarding)', () => {
    const times = [NOW - 7200, NOW - 1200, NOW + 600];
    expect(firstFutureIndex(times, NOW)).toBe(1); // -20min row counts as "now"
    expect(NOW_GRACE_SECONDS).toBe(1800);
  });

  it('returns -1 when every row is in the past (late-night board)', () => {
    const times = [NOW - 86400, NOW - 7200, NOW - 3600];
    expect(firstFutureIndex(times, NOW)).toBe(-1);
  });

  it('returns 0 when every row is in the future (tomorrow board)', () => {
    const times = [NOW + 3600, NOW + 7200];
    expect(firstFutureIndex(times, NOW)).toBe(0);
  });

  it('skips rows with missing/zero timestamps', () => {
    const times = [0, null, undefined, NOW + 600];
    expect(firstFutureIndex(times, NOW)).toBe(3);
  });

  it('is defensive against garbage input', () => {
    expect(firstFutureIndex(null, NOW)).toBe(-1);
    expect(firstFutureIndex([NOW + 1], NaN)).toBe(-1);
    expect(firstFutureIndex([], NOW)).toBe(-1);
  });
});

describe('nowDividerIndex', () => {
  it('places the divider between past and future rows', () => {
    const times = [NOW - 7200, NOW - 3600, NOW + 600, NOW + 7200];
    expect(nowDividerIndex(times, NOW)).toBe(2);
  });

  it('skips the divider when there are no future rows', () => {
    expect(nowDividerIndex([NOW - 7200, NOW - 3600], NOW)).toBe(-1);
  });

  it('skips the divider when there are no past rows (tomorrow board / early morning)', () => {
    expect(nowDividerIndex([NOW + 600, NOW + 7200], NOW)).toBe(-1);
  });

  it('skips the divider on an empty board', () => {
    expect(nowDividerIndex([], NOW)).toBe(-1);
  });
});
