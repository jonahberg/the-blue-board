import { describe, it, expect } from 'vitest';
import { firstFutureIndex, nowDividerIndex, NOW_GRACE_SECONDS, effectiveRowTime } from '../src/lib/board-now.js';

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

describe('effectiveRowTime (F075: held-flight divider placement)', () => {
  it('uses scheduled time when there is no real or estimated time', () => {
    expect(effectiveRowTime({ scheduled: NOW - 3600 })).toBe(NOW - 3600);
  });

  it('keeps the scheduled anchor once a real time exists (departed rows stay put)', () => {
    // A flight that pushed back late (real 2h after schedule) still anchors on scheduled,
    // preserving the pre-fix behavior for resolved rows.
    expect(effectiveRowTime({ scheduled: NOW - 7200, real: NOW - 3600 })).toBe(NOW - 7200);
  });

  it('floats a held flight (past schedule, estimated future, no real) down to its estimate', () => {
    // The bug: scheduled 2h ago → sorted above NOW as if resolved. With max(sched, est)
    // the row anchors to its future estimate and falls below the divider.
    const held = { scheduled: NOW - 7200, estimated: NOW + 1800 };
    expect(effectiveRowTime(held)).toBe(NOW + 1800);
  });

  it('ignores an estimate earlier than schedule', () => {
    expect(effectiveRowTime({ scheduled: NOW + 600, estimated: NOW - 600 })).toBe(NOW + 600);
  });

  it('is defensive against missing/zero fields', () => {
    expect(effectiveRowTime()).toBe(0);
    expect(effectiveRowTime({})).toBe(0);
    expect(effectiveRowTime({ scheduled: 0, estimated: 0, real: 0 })).toBe(0);
  });

  it('a held flight now lands below the NOW divider (end-to-end with the divider math)', () => {
    // Board sorted by scheduled departure ascending: an early departed flight, then a held
    // flight scheduled in the past (est future), then genuinely-future rows.
    const rows = [
      { scheduled: NOW - 7200, real: NOW - 7000 },  // departed, resolved
      { scheduled: NOW - 3600, estimated: NOW + 2400 }, // HELD 1h past schedule, est +40m
      { scheduled: NOW + 3600 },                    // future
    ];
    const times = rows.map(effectiveRowTime);
    // Before the fix, times were [-7200, -3600, +3600] → divider at index 2, leaving the
    // held flight above NOW. Now the held row's effective time is future, so the divider
    // moves up to index 1 and the held flight renders below "── NOW ──".
    expect(nowDividerIndex(times, NOW)).toBe(1);
  });
});
