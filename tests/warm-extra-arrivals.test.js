// Live audit Oct 4 2026, finding 7: arrivals boards 1.5–2.6h stale between views because the warm
// ring revisits each board ~every 3h. One extra today-ARRIVALS warm per fire, paid only from spend
// headroom: it never takes the day past budget − 150 units.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const snapshotMocks = vi.hoisted(() => ({
  getSupabaseAdmin: vi.fn(async () => null),
  loadScheduleSnapshot: vi.fn(async () => null),
  saveScheduleSnapshot: vi.fn(async () => {}),
  cleanupExpiredSnapshots: vi.fn(async () => {}),
}));
vi.mock(process.cwd() + '/api/_schedule-snapshots.ts', () => snapshotMocks);

import handler, {
  EXTRA_ARRIVALS_HEADROOM_UNITS,
  extraArrivalsSpendLine,
  pickExtraArrivalsTask,
} from '../api/cron/warm-schedules.js';
import { __resetAlertThrottleForTests } from '../api/_alert.js';
import { recordAdbUnits, __resetAdbSpendForTests } from '../api/_cost-state.js';

const NOON = Date.UTC(2026, 9, 3, 12, 0, 0);
const today = (hub, dir) => ({ hub, dir, dayOffset: 0, label: 'today' });

describe('pickExtraArrivalsTask', () => {
  afterEach(() => { delete process.env.SCHEDULE_WARM_EXTRA_ARRIVALS; });

  it('the spend line is the 1,400 budget minus 150, paced over the UTC day', () => {
    expect(EXTRA_ARRIVALS_HEADROOM_UNITS).toBe(150);
    expect(extraArrivalsSpendLine(1400, Date.UTC(2026, 9, 3, 23, 30))).toBe(1250);
    expect(extraArrivalsSpendLine(1400, NOON)).toBe(Math.floor((1250 * 13) / 24)); // 1h head start
    expect(extraArrivalsSpendLine(150, NOON)).toBe(0); // no pool, no extras
  });

  it('adds one today-arrivals board while spend is under the line', () => {
    const task = pickExtraArrivalsTask([today('ORD', 'departures')], { nowMs: NOON, unitsToday: 400, budget: 1400, elapsedMs: 20_000 });
    expect(task).toMatchObject({ dir: 'arrivals', dayOffset: 0, label: 'today' });
  });

  it('adds nothing once the day is at the line (a typical evening at 1,100+/day stops on its own)', () => {
    const line = extraArrivalsSpendLine(1400, NOON);
    expect(pickExtraArrivalsTask([], { nowMs: NOON, unitsToday: line - 3, budget: 1400, elapsedMs: 0 })).toBeNull();
  });

  it('skips a slow run so the 300s budget holds, and honours the kill switch', () => {
    expect(pickExtraArrivalsTask([], { nowMs: NOON, unitsToday: 0, budget: 1400, elapsedMs: 181_000 })).toBeNull();
    process.env.SCHEDULE_WARM_EXTRA_ARRIVALS = '0';
    expect(pickExtraArrivalsTask([], { nowMs: NOON, unitsToday: 0, budget: 1400, elapsedMs: 0 })).toBeNull();
  });

  it('never repeats an arrivals board the ring already holds this fire, and rotates across fires', () => {
    const SLOT = 30 * 60 * 1000;
    const picks = new Set();
    for (let i = 0; i < 9; i++) {
      const at = NOON + i * SLOT;
      const first = pickExtraArrivalsTask([], { nowMs: at, unitsToday: 0, budget: 1400, elapsedMs: 0 });
      picks.add(first.hub);
      const plan = [today(first.hub, 'arrivals')];
      expect(pickExtraArrivalsTask(plan, { nowMs: at, unitsToday: 0, budget: 1400, elapsedMs: 0 }).hub).not.toBe(first.hub);
    }
    expect(picks.size).toBe(9); // every hub's arrivals board gets its turn
  });
});

describe('warm-schedules handler — the extra arrivals warm', () => {
  const SECRET = 'test-cron-secret-1234';
  const res = () => ({
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  });
  const req = () => ({ method: 'GET', headers: { authorization: `Bearer ${SECRET}` } });

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.CRON_SECRET = SECRET;
    process.env.SCHEDULE_WARM_DELAY_MS = '0';
    process.env.SCHEDULE_WARM_TASKS_PER_RUN = '3';
    process.env.AERODATABOX_DAILY_UNIT_BUDGET = '1400';
    __resetAlertThrottleForTests();
    __resetAdbSpendForTests();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => 'MISS' },
      json: async () => ({ total: 600, partial: false, cached: false, meta: { dataAge: 0 } }),
    }));
  });

  afterEach(() => {
    delete process.env.CRON_SECRET;
    delete process.env.SCHEDULE_WARM_DELAY_MS;
    delete process.env.SCHEDULE_WARM_TASKS_PER_RUN;
    delete process.env.AERODATABOX_DAILY_UNIT_BUDGET;
    __resetAlertThrottleForTests();
    __resetAdbSpendForTests();
  });

  const scheduleCalls = () => globalThis.fetch.mock.calls.map(([u]) => String(u)).filter((u) => u.includes('/api/schedule?'));

  it('warms the ring stride plus one today-arrivals board when there is headroom', async () => {
    const out = res();
    await handler(req(), out);
    const calls = scheduleCalls();
    expect(calls).toHaveLength(4);
    expect(calls[3]).toContain('dir=arrivals');
    const extraKey = Object.keys(out.body.results).find((k) => out.body.results[k]?.extra === true);
    expect(extraKey).toMatch(/-arrivals-today$/);
    expect(out.body.scheduleWarmed).toBe(4);
  });

  it('warms only the ring stride once spend is at the headroom line', async () => {
    await recordAdbUnits(1300);
    await handler(req(), res());
    expect(scheduleCalls()).toHaveLength(3);
  });
});
