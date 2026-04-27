import { describe, it, expect, beforeEach } from 'vitest';
import { createDailyCounter } from '../api/_daily-counter.js';

function nowFactory(initial) {
  let t = initial;
  return {
    fn: () => t,
    advance(ms) { t += ms; },
    setDate(iso) { t = new Date(iso).getTime(); },
  };
}

describe('createDailyCounter', () => {
  it('starts at 0 and increments per IP', () => {
    const time = nowFactory(new Date('2026-04-26T12:00:00Z').getTime());
    const counter = createDailyCounter('test', { now: time.fn });
    expect(counter.get('1.1.1.1')).toBe(0);
    expect(counter.increment('1.1.1.1')).toBe(1);
    expect(counter.increment('1.1.1.1')).toBe(2);
    expect(counter.get('1.1.1.1')).toBe(2);
  });

  it('isolates counts per IP', () => {
    const time = nowFactory(new Date('2026-04-26T12:00:00Z').getTime());
    const counter = createDailyCounter('test2', { now: time.fn });
    counter.increment('a');
    counter.increment('a');
    counter.increment('b');
    expect(counter.get('a')).toBe(2);
    expect(counter.get('b')).toBe(1);
  });

  it('resets at UTC midnight', () => {
    const time = nowFactory(new Date('2026-04-26T23:59:00Z').getTime());
    const counter = createDailyCounter('test3', { now: time.fn });
    counter.increment('x');
    counter.increment('x');
    expect(counter.get('x')).toBe(2);

    // Cross UTC midnight
    time.setDate('2026-04-27T00:00:01Z');
    expect(counter.get('x')).toBe(0);
    expect(counter.increment('x')).toBe(1);
  });

  it('isOverLimit returns true when count >= limit', () => {
    const time = nowFactory(new Date('2026-04-26T12:00:00Z').getTime());
    const counter = createDailyCounter('test4', { now: time.fn });
    counter.increment('x');
    counter.increment('x');
    counter.increment('x');
    expect(counter.isOverLimit('x', 3)).toBe(true);
    expect(counter.isOverLimit('x', 4)).toBe(false);
  });

  it('isolates counts across separate counter instances by name', () => {
    const time = nowFactory(new Date('2026-04-26T12:00:00Z').getTime());
    const a = createDailyCounter('aaa', { now: time.fn });
    const b = createDailyCounter('bbb', { now: time.fn });
    a.increment('ip');
    expect(a.get('ip')).toBe(1);
    expect(b.get('ip')).toBe(0);
  });
});
