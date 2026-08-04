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
  isAdbOrganicRefreshGated,
  isAdbBudgetPacingDisabled,
  getAdbPacedAllowance,
  hydrateAdbSpend,
  __resetAdbSpendForTests,
} from '../api/_cost-state.js';
import { fetchViaAeroDataBox, __resetScheduleWarnsForTests } from '../api/_schedule-aerodatabox.js';

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

  it('falls back to the 400-unit default when AERODATABOX_DAILY_UNIT_BUDGET is garbage', async () => {
    // '-5' honoured literally or 'abc' honoured as NaN would disable the budget entirely.
    for (const bad of ['-5', 'abc']) {
      __resetAdbSpendForTests();
      process.env.AERODATABOX_DAILY_UNIT_BUDGET = bad;
      await recordAdbUnits(399);
      expect(isAdbBudgetExhausted(), `budget=${bad} at 399 units`).toBe(false);
      await recordAdbUnits(1);
      expect(isAdbBudgetExhausted(), `budget=${bad} at 400 units`).toBe(true);
    }
  });

  it('honours an explicit budget of 0 as a kill switch — this is metered money', async () => {
    // An operator setting 0 during a billing incident means STOP ALL SPEND; silently substituting
    // the 400 default would be fail-open with the owner's wallet.
    process.env.AERODATABOX_DAILY_UNIT_BUDGET = '0';
    expect(isAdbBudgetExhausted()).toBe(true);
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

// The UTC-midnight reset lands at 7 PM CDT, so a flat first-come-first-served budget was drained by
// the US evening + overnight warm crons before the US afternoon peak ever started (Aug 4 2026:
// 732/700 units by 21:00 UTC, boards frozen at "1:02 PM CDT (3h old)"). Pacing hands out only the
// day's pro-rated slice — same daily ceiling, spread across all 24 hours.
describe('AeroDataBox paced organic allowance', () => {
  const atUtc = (h, m = 0) => Date.UTC(2026, 7, 4, h, m, 0);

  beforeEach(() => {
    __resetAdbSpendForTests();
    supabaseMocks.getSupabaseAdmin.mockReset();
    supabaseMocks.getSupabaseAdmin.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.AERODATABOX_DAILY_UNIT_BUDGET;
    delete process.env.AERODATABOX_BUDGET_PACING;
    __resetAdbSpendForTests();
  });

  it('pro-rates the budget across the UTC day, with a 1h head start and a full-budget cap', () => {
    process.env.AERODATABOX_DAILY_UNIT_BUDGET = '700';
    // Literal expected values, not a copy of the implementation's formula — a copied formula would
    // happily agree with a broken implementation. Derivations for budget=700:
    //   00:00 UTC -> floor(700 x  1/24) =  29   (the 1h head start, immediately usable)
    //   12:00 UTC -> floor(700 x 13/24) = 379
    //   23:00 UTC -> floor(700 x 24/24) = 700   (head start makes the full budget reachable at 23:00)
    // Right at rollover the pool is not zero, so the 7 PM CDT crowd is throttled, not locked out.
    expect(getAdbPacedAllowance(atUtc(0))).toBe(29);
    expect(getAdbPacedAllowance(atUtc(12))).toBe(379);
    // ...and never exceeds the budget after — the total daily ceiling is unchanged by pacing.
    expect(getAdbPacedAllowance(atUtc(23))).toBe(700);
    expect(getAdbPacedAllowance(atUtc(23, 59))).toBe(700);
  });

  it('never hands out a literal zero for a small-but-nonzero budget', () => {
    // floor(budget x 1/24) is 0 for every budget under 24, so at 00:00 UTC a deliberately small
    // budget used to gate organic refreshes to a DEAD STOP — the exact opposite of the "never
    // literally zero" promise, and a silent full outage for the operators who tuned the knob down.
    process.env.AERODATABOX_DAILY_UNIT_BUDGET = '20';
    expect(getAdbPacedAllowance(atUtc(0))).toBeGreaterThanOrEqual(1);
    expect(isAdbOrganicRefreshGated(atUtc(0))).toBe(false); // 0 units spent — the gate must be open
    // The floor never lets the allowance exceed the budget itself.
    expect(getAdbPacedAllowance(atUtc(0))).toBeLessThanOrEqual(20);
  });

  it('keeps a negative epoch (clock skew) inside [1..budget]', () => {
    // The double modulo exists so a pre-1970 clock still lands inside a day; pin the invariant
    // rather than the arithmetic, since the only thing that matters is that it stays in range.
    process.env.AERODATABOX_DAILY_UNIT_BUDGET = '700';
    for (const nowMs of [-1, -1000, -86_400_000, -86_400_000 * 3 - 43_200_000]) {
      const allowance = getAdbPacedAllowance(nowMs);
      expect(allowance, `nowMs=${nowMs}`).toBeGreaterThanOrEqual(1);
      expect(allowance, `nowMs=${nowMs}`).toBeLessThanOrEqual(700);
    }
  });

  it('treats an explicit 0 budget as an absolute kill switch, and a garbage budget as the 400 default', () => {
    process.env.AERODATABOX_DAILY_UNIT_BUDGET = '0';
    expect(getAdbPacedAllowance(atUtc(12))).toBe(0);
    expect(isAdbOrganicRefreshGated(atUtc(12))).toBe(true);
    // Even with pacing switched off, an explicit 0 must still mean STOP — this is metered money.
    process.env.AERODATABOX_BUDGET_PACING = '0';
    expect(isAdbOrganicRefreshGated(atUtc(12))).toBe(true);

    // Garbage is NOT "allow nothing": it falls back to the 400 default and gets that budget's paced
    // line (floor(400 x 13/24) = 216 at noon). Failing closed on a typo would take the boards down;
    // the explicit 0 above is the deliberate way to stop spend.
    delete process.env.AERODATABOX_BUDGET_PACING;
    process.env.AERODATABOX_DAILY_UNIT_BUDGET = 'abc';
    expect(getAdbPacedAllowance(atUtc(12))).toBe(216);
    expect(isAdbOrganicRefreshGated(atUtc(12))).toBe(false);
  });

  it('gates the organic path once today’s spend passes the paced line, not just the daily budget', async () => {
    process.env.AERODATABOX_DAILY_UNIT_BUDGET = '700';
    const noonAllowance = 379; // floor(700 x 13/24)
    await recordAdbUnits(noonAllowance - 4);
    expect(isAdbOrganicRefreshGated(atUtc(12))).toBe(false);
    await recordAdbUnits(4);
    expect(isAdbOrganicRefreshGated(atUtc(12))).toBe(true);
    // Same spend is still WELL under the absolute daily budget — pacing is what's holding it back,
    // and the units it withheld are what the 18:00–24:00 UTC peak gets to spend.
    expect(isAdbBudgetExhausted()).toBe(false);
    // ...and later in the day that same spend is under the line again, so refreshes resume.
    expect(isAdbOrganicRefreshGated(atUtc(18))).toBe(false);
  });

  it('AERODATABOX_BUDGET_PACING off-words restore the flat first-come-first-served gate', async () => {
    process.env.AERODATABOX_DAILY_UNIT_BUDGET = '700';
    await recordAdbUnits(300); // way past the 00:30 UTC paced line, way under the daily budget
    expect(isAdbOrganicRefreshGated(atUtc(0, 30))).toBe(true);
    // Trimmed + lowercased, and the same off-words the rest of the codebase honours: an env value
    // pasted with a stray space, or written 'false', must do what the operator plainly meant.
    for (const off of ['0', 'off', 'OFF', ' off ', 'false', 'FALSE', 'no']) {
      process.env.AERODATABOX_BUDGET_PACING = off;
      expect(isAdbBudgetPacingDisabled(), `pacing=${JSON.stringify(off)}`).toBe(true);
      expect(isAdbOrganicRefreshGated(atUtc(0, 30)), `pacing=${JSON.stringify(off)}`).toBe(false);
    }
    // Anything else — including the affirmative values and an unset/blank var — keeps pacing ON.
    for (const on of ['1', 'on', 'true', 'yes', '', '  ']) {
      process.env.AERODATABOX_BUDGET_PACING = on;
      expect(isAdbBudgetPacingDisabled(), `pacing=${JSON.stringify(on)}`).toBe(false);
      expect(isAdbOrganicRefreshGated(atUtc(0, 30)), `pacing=${JSON.stringify(on)}`).toBe(true);
    }
    delete process.env.AERODATABOX_BUDGET_PACING;
    expect(isAdbBudgetPacingDisabled()).toBe(false);

    // Disabling pacing does not disable the absolute budget.
    process.env.AERODATABOX_BUDGET_PACING = 'off';
    await recordAdbUnits(400);
    expect(isAdbOrganicRefreshGated(atUtc(0, 30))).toBe(true);
  });

  it('warns ONCE per UTC day when the budget cannot fund the warm cron plus organic refreshes', async () => {
    // The hourly warm cron bypasses the organic gate but records ~384 units/day against the SAME
    // counter the paced line measures, so the code default of 400 leaves ~16 organic units for the
    // whole day — the boards do not error, they just silently stop refreshing outside the cron ring.
    // That is a config mistake nobody would ever see without this warning.
    vi.useFakeTimers({ now: new Date('2026-08-04T09:00:00Z'), toFake: ['Date'] });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const starveWarns = () => warnSpy.mock.calls.filter((c) => /cannot fund the warm cron/.test(String(c[0])));

    process.env.AERODATABOX_DAILY_UNIT_BUDGET = '400';
    isAdbOrganicRefreshGated(Date.now());
    isAdbOrganicRefreshGated(Date.now());
    expect(starveWarns()).toHaveLength(1);
    expect(String(starveWarns()[0][0])).toMatch(/~384 units\/day/);
    expect(String(starveWarns()[0][0])).toMatch(/production runs 700/);

    // A budget with real headroom is silent — this must not become background noise for a healthy
    // deployment.
    __resetAdbSpendForTests();
    warnSpy.mockClear();
    process.env.AERODATABOX_DAILY_UNIT_BUDGET = '700';
    isAdbOrganicRefreshGated(Date.now());
    expect(starveWarns()).toHaveLength(0);

    // The explicit-0 kill switch is a deliberate operator choice, not a starved budget.
    process.env.AERODATABOX_DAILY_UNIT_BUDGET = '0';
    isAdbOrganicRefreshGated(Date.now());
    expect(starveWarns()).toHaveLength(0);
    vi.useRealTimers();
  });

  it('reopens the gate at UTC midnight: both the counter AND the paced line reset', async () => {
    // The gate reads two day-scoped values. If only one rolled over, a day that ended gated would
    // start the next one gated too — the frozen-board failure this whole pass exists to prevent.
    vi.useFakeTimers({ now: new Date('2026-08-04T23:59:00Z'), toFake: ['Date'] });
    process.env.AERODATABOX_DAILY_UNIT_BUDGET = '700';
    await recordAdbUnits(700);
    // After 23:00 UTC the paced line has reached the full budget, so late-day gating is the
    // absolute ceiling doing the work — pacing neither adds nor removes headroom here.
    expect(getAdbPacedAllowance(Date.now())).toBe(700);
    expect(isAdbOrganicRefreshGated(Date.now())).toBe(true);

    vi.setSystemTime(new Date('2026-08-05T00:01:00Z'));
    expect(getAdbUnitsToday()).toBe(0);
    // The line resets to the head-start slice, not the full budget — the new day is paced too.
    expect(getAdbPacedAllowance(Date.now())).toBe(29);
    expect(isAdbOrganicRefreshGated(Date.now())).toBe(false);
    vi.useRealTimers();
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
    vi.useRealTimers();
    delete process.env.AERODATABOX_API_KEY;
    delete process.env.AERODATABOX_DAILY_UNIT_BUDGET;
    delete process.env.AERODATABOX_BUDGET_PACING;
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

  it('logs the organic gate warning at most ONCE per UTC hour (no per-request log spam)', async () => {
    // The warning previously fired on EVERY gated organic request — dozens/hour for ~11h/day,
    // burying genuine warnings and inflating log-query latency. It throttles to once per instance
    // per UTC HOUR: the paced gate is episodic (spend crosses the line, the line catches up, spend
    // crosses again), so a once-per-DAY latch would report the morning episode and swallow every
    // afternoon one. Reset here so prior gated-path tests don't consume this hour's allowance.
    vi.useFakeTimers({ now: new Date('2026-08-04T14:20:00Z'), toFake: ['Date'] });
    __resetScheduleWarnsForTests();
    await recordAdbUnits(400);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false, status: 500, headers: { get: () => null }, json: async () => ({}), text: async () => '',
    });
    const gateWarns = () => warnSpy.mock.calls.filter((c) => /organic budget gate/.test(String(c[0])));

    const ts = Math.floor(Date.now() / 1000);
    await fetchViaAeroDataBox('ORD', 'departures', ts, 5000);
    await fetchViaAeroDataBox('SFO', 'arrivals', ts, 5000);
    await fetchViaAeroDataBox('DEN', 'departures', ts, 5000);

    expect(gateWarns()).toHaveLength(1);
    // The warn must name the PACED line, not just the budget — "400/400" would read as
    // "we spent the whole day's money" even when the gate tripped at 09:00 UTC on 160 paced units.
    expect(String(gateWarns()[0][0])).toMatch(/paced allowance \d+ \(budget \d+\/day\)/);

    // Still the same hour: silent.
    vi.setSystemTime(new Date('2026-08-04T14:59:00Z'));
    await fetchViaAeroDataBox('IAH', 'departures', ts, 5000);
    expect(gateWarns()).toHaveLength(1);

    // Next hour is a NEW episode and must be visible — the whole reason this is hourly.
    vi.setSystemTime(new Date('2026-08-04T15:00:00Z'));
    await fetchViaAeroDataBox('IAH', 'departures', ts, 5000);
    expect(gateWarns()).toHaveLength(2);
  });

  it('names the ABSOLUTE budget (not a phantom paced line) in the warn when pacing is disabled', async () => {
    // With AERODATABOX_BUDGET_PACING off the gate IS the flat daily budget. Printing a paced
    // allowance nobody is enforcing sends whoever reads the log chasing a line that doesn't exist.
    vi.useFakeTimers({ now: new Date('2026-08-04T09:00:00Z'), toFake: ['Date'] });
    __resetScheduleWarnsForTests();
    process.env.AERODATABOX_BUDGET_PACING = 'off';
    await recordAdbUnits(400);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false, status: 500, headers: { get: () => null }, json: async () => ({}), text: async () => '',
    });

    const result = await fetchViaAeroDataBox('ORD', 'departures', Math.floor(Date.now() / 1000), 5000);
    expect(result).toBeNull();
    const messages = warnSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(messages).toMatch(/daily unit budget exhausted \(400\/400\); pacing disabled/);
    expect(messages).not.toMatch(/paced allowance/);
    delete process.env.AERODATABOX_BUDGET_PACING;
  });

  it('gates an organic fetch that is inside the daily budget but ahead of the paced line', async () => {
    // 00:30 UTC = 7:30 PM CDT, the hour the old flat gate let the evening crowd eat the whole day.
    vi.useFakeTimers({ now: new Date('2026-08-04T00:30:00Z'), toFake: ['Date'] });
    __resetScheduleWarnsForTests();
    process.env.AERODATABOX_DAILY_UNIT_BUDGET = '700';
    await recordAdbUnits(300); // 43% of the day's money, 30 minutes into the day
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true, status: 200, headers: { get: () => null }, json: async () => ({ departures: [] }),
    });

    const result = await fetchViaAeroDataBox('ORD', 'departures', Math.floor(Date.now() / 1000), 5000);
    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    // The absolute budget is nowhere near gone — those units are being saved for the peak.
    expect(isAdbBudgetExhausted()).toBe(false);

    // Cron warms must still get through: they are the path that keeps boards from freezing.
    const warm = await fetchViaAeroDataBox('ORD', 'departures', Math.floor(Date.now() / 1000), 5000, {
      bypassDailyBudget: true,
    });
    expect(warm).not.toBeNull();
    expect(fetchSpy).toHaveBeenCalled();
    vi.useRealTimers();
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
