import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  budgetWithin,
  boundedQuery,
  withinBudget,
  isDbTimeout,
  DB_TIMEOUT_CODE,
  DEADLINE_SAFETY_MARGIN_MS,
} from '../api/_bounded.js';

describe('budgetWithin', () => {
  it('is the own budget when the deadline is far away or absent', () => {
    expect(budgetWithin(2500, 1_000_000, 500, 0)).toBe(2500);
    expect(budgetWithin(2500, undefined)).toBe(2500);
    expect(budgetWithin(2500, null)).toBe(2500);
  });

  it('is cut to what is left before the deadline, less the margin, and never negative', () => {
    expect(budgetWithin(2500, 10_000, 500, 8_000)).toBe(1500);
    expect(budgetWithin(2500, 10_000, 500, 9_800)).toBe(0);
    expect(budgetWithin(2500, 10_000, 500, 20_000)).toBe(0);
    expect(DEADLINE_SAFETY_MARGIN_MS).toBeGreaterThan(0);
  });
});

describe('boundedQuery / withinBudget', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('gives the query an abort signal and answers like a failed query when time runs out', async () => {
    let signal = null;
    const builder = {
      abortSignal(s) {
        signal = s;
        // Like postgrest-js: the request settles only when the signal fires.
        return new Promise((resolve) => s.addEventListener('abort', () => resolve({ data: null, error: { message: 'AbortError' } })));
      },
      then() { throw new Error('the signal-carrying builder must be the one awaited'); },
    };
    const pending = boundedQuery(builder, 1000);
    await vi.advanceTimersByTimeAsync(999);
    expect(signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const result = await pending;
    expect(signal.aborted).toBe(true);
    expect(result.data).toBe(null);
    expect(result.error.code).toBe(DB_TIMEOUT_CODE);
    expect(isDbTimeout(result.error)).toBe(true);
  });

  it('bounds a thenable with no abortSignal method too (test doubles, older clients)', async () => {
    const pending = boundedQuery(new Promise(() => {}), 500);
    await vi.advanceTimersByTimeAsync(500);
    expect(isDbTimeout((await pending).error)).toBe(true);
  });

  it('passes a prompt answer through untouched and leaves no timer behind', async () => {
    const result = await boundedQuery(Promise.resolve({ data: [1], error: null }), 1000);
    expect(result).toEqual({ data: [1], error: null });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a zero budget does not send the query at all', async () => {
    const abortSignal = vi.fn();
    const result = await boundedQuery({ abortSignal, then: vi.fn() }, 0);
    expect(abortSignal).not.toHaveBeenCalled();
    expect(isDbTimeout(result.error)).toBe(true);
  });

  it('withinBudget resolves the fallback once, after the budget, and calls onTimeout once', async () => {
    const onTimeout = vi.fn();
    const pending = withinBudget(new Promise(() => {}), 300, 'fallback', onTimeout);
    await vi.advanceTimersByTimeAsync(300);
    expect(await pending).toBe('fallback');
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('withinBudget passes a rejection through', async () => {
    await expect(withinBudget(Promise.reject(new Error('boom')), 300, null)).rejects.toThrow('boom');
  });
});
