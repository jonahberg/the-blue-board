import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const supabaseMocks = vi.hoisted(() => ({
  getSupabaseAdmin: vi.fn(async () => null),
  loadScheduleSnapshot: vi.fn(async () => null),
  saveScheduleSnapshot: vi.fn(async () => {}),
}));

vi.mock(process.cwd() + '/api/_schedule-snapshots.ts', () => supabaseMocks);

import {
  recordAdbUnits,
  getAdbUnitsToday,
  isAdbBudgetExhausted,
  hydrateAdbSpend,
  __resetAdbSpendForTests,
} from '../api/_cost-state.js';
import { fetchViaAeroDataBox } from '../api/_schedule-aerodatabox.js';

describe('AeroDataBox daily unit budget (cost-state)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    __resetAdbSpendForTests();
    supabaseMocks.getSupabaseAdmin.mockReset();
    supabaseMocks.getSupabaseAdmin.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.AERODATABOX_API_KEY;
    delete process.env.AERODATABOX_DAILY_UNIT_BUDGET;
    delete process.env.AERODATABOX_INTER_WINDOW_DELAY_MS;
    __resetAdbSpendForTests();
  });

  it('accumulates recorded units in memory and trips the breaker at the budget', async () => {
    expect(getAdbUnitsToday()).toBe(0);
    expect(isAdbBudgetExhausted()).toBe(false);
    await recordAdbUnits(2);
    await recordAdbUnits(2);
    expect(getAdbUnitsToday()).toBe(4);
    process.env.AERODATABOX_DAILY_UNIT_BUDGET = '4';
    expect(isAdbBudgetExhausted()).toBe(true);
  });

  it('defaults the daily budget to 400 units', async () => {
    await recordAdbUnits(399);
    expect(isAdbBudgetExhausted()).toBe(false);
    await recordAdbUnits(1);
    expect(isAdbBudgetExhausted()).toBe(true);
  });

  it('resets the counter on UTC day rollover', async () => {
    vi.useFakeTimers({ now: new Date('2026-06-10T23:50:00Z'), toFake: ['Date'] });
    await recordAdbUnits(10);
    expect(getAdbUnitsToday()).toBe(10);
    vi.setSystemTime(new Date('2026-06-11T00:10:00Z'));
    expect(getAdbUnitsToday()).toBe(0);
    expect(isAdbBudgetExhausted()).toBe(false);
  });

  it('persists spend through the increment RPC and adopts the cross-instance total', async () => {
    const rpc = vi.fn(async () => ({ data: 50, error: null }));
    supabaseMocks.getSupabaseAdmin.mockResolvedValue({ rpc });
    await recordAdbUnits(4);
    expect(rpc).toHaveBeenCalledWith('increment_adb_units', expect.objectContaining({ p_units: 4 }));
    // RPC returned the global running total (other instances spent too) — adopt the higher value.
    expect(getAdbUnitsToday()).toBe(50);
  });

  it('hydrates a higher cross-instance count from supabase', async () => {
    supabaseMocks.getSupabaseAdmin.mockResolvedValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            limit: async () => ({ data: [{ units: 120 }], error: null }),
          }),
        }),
      }),
    });
    await hydrateAdbSpend();
    expect(getAdbUnitsToday()).toBe(120);
  });

  it('degrades to in-memory accounting when supabase is unavailable', async () => {
    supabaseMocks.getSupabaseAdmin.mockRejectedValue(new Error('down'));
    await recordAdbUnits(6);
    await hydrateAdbSpend();
    expect(getAdbUnitsToday()).toBe(6);
  });

  it('ignores zero, negative, and NaN unit amounts', async () => {
    await recordAdbUnits(0);
    await recordAdbUnits(-5);
    await recordAdbUnits(NaN);
    await recordAdbUnits('abc');
    expect(getAdbUnitsToday()).toBe(0);
    // Garbage input must not poison the counter for subsequent valid spend either.
    await recordAdbUnits(2);
    await recordAdbUnits(-1);
    expect(getAdbUnitsToday()).toBe(2);
  });

  it('keeps the locally recorded count when the increment RPC returns an error object', async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { message: 'x' } }));
    supabaseMocks.getSupabaseAdmin.mockResolvedValue({ rpc });
    await recordAdbUnits(4);
    expect(rpc).toHaveBeenCalled();
    // The errored RPC's data (null → Number(null) = 0) must never replace local spend.
    expect(getAdbUnitsToday()).toBe(4);
  });

  it('falls back to the 400-unit default when AERODATABOX_DAILY_UNIT_BUDGET is invalid', async () => {
    // '0' or '-5' honoured literally would brick the provider (always exhausted); 'abc' honoured
    // as NaN would disable the budget entirely. All three must fall back to the 400 default.
    for (const bad of ['0', '-5', 'abc']) {
      __resetAdbSpendForTests();
      process.env.AERODATABOX_DAILY_UNIT_BUDGET = bad;
      await recordAdbUnits(399);
      expect(isAdbBudgetExhausted(), `budget=${bad} at 399 units`).toBe(false);
      await recordAdbUnits(1);
      expect(isAdbBudgetExhausted(), `budget=${bad} at 400 units`).toBe(true);
    }
  });

  it('rate-limits hydrate reads to one per 10s: a second hydrate inside the TTL is a no-op', async () => {
    let storedUnits = 120;
    supabaseMocks.getSupabaseAdmin.mockResolvedValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            limit: async () => ({ data: [{ units: storedUnits }], error: null }),
          }),
        }),
      }),
    });
    await hydrateAdbSpend();
    expect(getAdbUnitsToday()).toBe(120);
    // The store moves, but a hydrate within the 10s TTL must NOT re-read it (hot-path read guard).
    storedUnits = 500;
    await hydrateAdbSpend();
    expect(getAdbUnitsToday()).toBe(120);
  });
});

describe('fetchViaAeroDataBox budget enforcement', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    __resetAdbSpendForTests();
    supabaseMocks.getSupabaseAdmin.mockReset();
    supabaseMocks.getSupabaseAdmin.mockResolvedValue(null);
    process.env.AERODATABOX_API_KEY = 'test-key';
    process.env.AERODATABOX_INTER_WINDOW_DELAY_MS = '0';
  });

  afterEach(() => {
    delete process.env.AERODATABOX_API_KEY;
    delete process.env.AERODATABOX_DAILY_UNIT_BUDGET;
    delete process.env.AERODATABOX_INTER_WINDOW_DELAY_MS;
    __resetAdbSpendForTests();
  });

  it('records 2 units per window request (4 per board fetch)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ departures: [] }),
    });
    await fetchViaAeroDataBox('ORD', 'departures', Math.floor(Date.now() / 1000), 5000);
    expect(getAdbUnitsToday()).toBe(4);
  });

  it('returns null without calling upstream once the daily budget is exhausted', async () => {
    await recordAdbUnits(400);
    // Stubbed (not call-through): a gate regression must fail fast, not via live provider calls.
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false, status: 500, headers: { get: () => null }, json: async () => ({}), text: async () => '',
    });
    const result = await fetchViaAeroDataBox('ORD', 'departures', Math.floor(Date.now() / 1000), 5000);
    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('bypassDailyBudget (authorized cron warms, ring-bounded at ~288/day) skips the gate but still records spend', async () => {
    await recordAdbUnits(400);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ departures: [] }),
    });
    const result = await fetchViaAeroDataBox('ORD', 'departures', Math.floor(Date.now() / 1000), 5000, {
      bypassDailyBudget: true,
    });
    expect(result).not.toBeNull();
    // Spend is still accounted (2 windows × 2 units) so the organic budget sees the true total.
    expect(getAdbUnitsToday()).toBe(404);
  });

  it('bypassDailyBudget still respects the 3x disaster ceiling — a leaked cron secret cannot spend unboundedly', async () => {
    await recordAdbUnits(1200); // 3 × the 400 default
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false, status: 500, headers: { get: () => null }, json: async () => ({}), text: async () => '',
    });
    const result = await fetchViaAeroDataBox('ORD', 'departures', Math.floor(Date.now() / 1000), 5000, {
      bypassDailyBudget: true,
    });
    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('the 3x ceiling sees CROSS-INSTANCE spend — a cold lambda (in-memory 0) must still refuse', async () => {
    // Without hydrating, every freshly-spawned instance reads 0 and the "absolute ceiling"
    // protecting the privileged force path is per-instance theater.
    supabaseMocks.getSupabaseAdmin.mockResolvedValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            limit: async () => ({ data: [{ units: 1200 }], error: null }),
          }),
        }),
      }),
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false, status: 500, headers: { get: () => null }, json: async () => ({}), text: async () => '',
    });
    const result = await fetchViaAeroDataBox('ORD', 'departures', Math.floor(Date.now() / 1000), 5000, {
      bypassDailyBudget: true,
    });
    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('bills 2 units per ATTEMPT: 429 retries are metered too (2×429 then 200 per window = 12 units)', { timeout: 20000 }, async () => {
    // The provider bills every request FIRED, not every success — fetchWindow records spend before
    // reading the outcome, so a 429 storm drains the budget fast (the intended circuit). Two 429s
    // then a 200 per window = 3 attempts × 2 units × 2 windows = 12 units for the board, not 4.
    const attemptsByWindow = new Map();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const key = String(url);
      const attempt = (attemptsByWindow.get(key) || 0) + 1;
      attemptsByWindow.set(key, attempt);
      if (attempt <= 2) {
        return {
          ok: false,
          status: 429,
          // fetchWindow honours a positive retry-after (seconds) as the backoff; a tiny fractional
          // value (10ms) keeps the retries fast. ('0' would NOT be honoured and would fall back to
          // the slow 1500ms×attempt default.)
          headers: { get: (name) => (String(name).toLowerCase() === 'retry-after' ? '0.01' : null) },
          text: async () => '',
        };
      }
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ departures: [] }) };
    });

    const result = await fetchViaAeroDataBox('ORD', 'departures', Math.floor(Date.now() / 1000), 60000);
    expect(result).not.toBeNull();
    // Both windows recovered on attempt 3, so the board itself is complete...
    expect(result.partial).toBe(false);
    // ...but every attempt was billed.
    expect(getAdbUnitsToday()).toBe(12);
  });
});

describe('ADB spend day-rollover races', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    __resetAdbSpendForTests();
    supabaseMocks.getSupabaseAdmin.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    __resetAdbSpendForTests();
  });

  it('discards an RPC total that lands after UTC midnight instead of adopting yesterday into the new day', async () => {
    vi.useFakeTimers({ now: new Date('2026-06-10T23:59:50Z'), toFake: ['Date'] });
    const rpc = vi.fn(async () => {
      // The RPC round-trip crosses UTC midnight: its return is YESTERDAY's running total.
      vi.setSystemTime(new Date('2026-06-11T00:00:10Z'));
      return { data: 350, error: null };
    });
    supabaseMocks.getSupabaseAdmin.mockResolvedValue({ rpc });
    await recordAdbUnits(4);
    // New day starts clean — adopting 350 would block the provider for the whole new day.
    expect(getAdbUnitsToday()).toBe(0);
  });

  it('discards a hydrate read that lands after UTC midnight instead of adopting yesterday into the new day', async () => {
    vi.useFakeTimers({ now: new Date('2026-06-10T23:59:50Z'), toFake: ['Date'] });
    supabaseMocks.getSupabaseAdmin.mockResolvedValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            limit: async () => {
              // The read round-trip crosses UTC midnight: 350 is YESTERDAY's running total.
              vi.setSystemTime(new Date('2026-06-11T00:00:10Z'));
              return { data: [{ units: 350 }], error: null };
            },
          }),
        }),
      }),
    });
    await hydrateAdbSpend();
    expect(getAdbUnitsToday()).toBe(0);
  });
});
