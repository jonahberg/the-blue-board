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
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const result = await fetchViaAeroDataBox('ORD', 'departures', Math.floor(Date.now() / 1000), 5000);
    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
