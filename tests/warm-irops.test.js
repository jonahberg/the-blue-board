// Data-quality release (Jul 3 2026 audit) — #7 IROPS-aware warm cron: hubs with an active FAA
// program rotate fairly into the front of each run's stride. Priority injections are capped at
// stride-1 slots per run (≥1 base ring slot always survives) and the disrupted-hub order is
// rotated by the clock-derived warm slot, so with 2+ disrupted hubs every hub's boards cycle
// through the priority slots across consecutive runs instead of the first hubs in HUBS order
// winning every run. Task count and 300s budget unchanged.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const snapshotMocks = vi.hoisted(() => ({
  loadScheduleSnapshot: vi.fn(async () => null),
  saveScheduleSnapshot: vi.fn(async () => {}),
  getSupabaseAdmin: vi.fn(async () => null),
}));

vi.mock(process.cwd() + '/api/_schedule-snapshots.ts', () => snapshotMocks);

import handler, { applyIropsPriority, buildWarmPlan } from '../api/cron/warm-schedules.js';
import { __resetFaaDisruptionCacheForTests } from '../api/faa.js';
import { __resetAlertThrottleForTests } from '../api/_alert.js';
import { __resetAdbSpendForTests } from '../api/_cost-state.js';

const t = (hub, dir, dayOffset) => ({ hub, dir, dayOffset, label: dayOffset === 0 ? 'today' : 'tomorrow' });
const key = (task) => `${task.hub}-${task.dir}-${task.label}`;

describe('applyIropsPriority (pure)', () => {
  it('no disrupted hubs → plan unchanged', () => {
    const plan = [t('DEN', 'departures', 0), t('GUM', 'arrivals', 1)];
    const out = applyIropsPriority(plan, []);
    expect(out.plan).toEqual(plan);
    expect(out.injected).toEqual([]);
    expect(out.displaced).toEqual([]);
  });

  it('injects the disrupted hub today boards, displacing tomorrow slots first', () => {
    const plan = [t('DEN', 'departures', 0), t('IAH', 'departures', 1), t('GUM', 'arrivals', 1)];
    const out = applyIropsPriority(plan, ['ORD']);
    expect(out.plan).toHaveLength(3); // task count is the budget — never grows
    const keys = out.plan.map(key);
    expect(keys).toContain('ORD-departures-today');
    expect(keys).toContain('ORD-arrivals-today');
    // Priority tasks run FIRST; the surviving slot is the today board, tomorrow slots were displaced.
    expect(out.plan[0].hub).toBe('ORD');
    expect(out.plan[1].hub).toBe('ORD');
    expect(keys).toContain('DEN-departures-today');
    expect(out.injected).toHaveLength(2);
    expect(out.displaced.sort()).toEqual(['GUM-arrivals-tomorrow', 'IAH-departures-tomorrow'].sort());
  });

  it('displaces undisrupted today slots only when no tomorrow slots remain', () => {
    const plan = [t('DEN', 'departures', 0), t('IAH', 'arrivals', 0), t('SFO', 'departures', 0)];
    const out = applyIropsPriority(plan, ['ORD']);
    const keys = out.plan.map(key);
    expect(out.plan).toHaveLength(3);
    expect(keys).toContain('ORD-departures-today');
    expect(keys).toContain('ORD-arrivals-today');
    // Displaced from the BACK of the stride.
    expect(out.displaced).toEqual(['SFO-departures-today', 'IAH-arrivals-today']);
  });

  it('reorders (no displacement) when the stride already covers the disrupted hub today boards', () => {
    const plan = [t('DEN', 'departures', 0), t('ORD', 'departures', 0), t('ORD', 'arrivals', 0)];
    const out = applyIropsPriority(plan, ['ORD']);
    expect(out.injected).toEqual([]);
    expect(out.displaced).toEqual([]);
    expect(out.plan.map(key)).toEqual(['ORD-departures-today', 'ORD-arrivals-today', 'DEN-departures-today']);
  });

  it('never grows the plan; a stride of 1 allows zero injections (cap = stride-1)', () => {
    const plan = [t('ORD', 'departures', 0)]; // stride of 1
    const out = applyIropsPriority(plan, ['ORD', 'SFO']);
    expect(out.plan).toHaveLength(1);
    // Injection cap is stride-1 = 0: nothing can be displaced. The single slot happens to be an
    // ORD-today priority task already, so it simply runs first.
    expect(out.plan[0].hub).toBe('ORD');
    expect(out.injected).toEqual([]);
    expect(out.displaced).toEqual([]);
  });

  it('ignores non-hub airport codes (FAA programs at ATL/LGA are not our hubs)', () => {
    const plan = [t('DEN', 'departures', 0), t('GUM', 'arrivals', 1)];
    const out = applyIropsPriority(plan, ['ATL', 'LGA']);
    expect(out.plan).toEqual(plan);
  });

  it('caps injections at stride-1 with multiple disrupted hubs — at least one ring slot survives', () => {
    // 2 disrupted hubs used to consume the entire stride-4 run; now the cap (3) leaves the
    // front-most surviving ring slot in place and the 4th priority board waits for rotation.
    const plan = [t('DEN', 'departures', 1), t('IAH', 'departures', 1), t('GUM', 'arrivals', 1), t('NRT', 'arrivals', 1)];
    const out = applyIropsPriority(plan, ['ORD', 'EWR'], 0);
    expect(out.plan).toHaveLength(4);
    expect(out.plan.map(key)).toEqual([
      'ORD-departures-today', 'ORD-arrivals-today', 'EWR-departures-today', 'DEN-departures-tomorrow',
    ]);
    expect(out.injected).toHaveLength(3);
    expect(out.displaced).toEqual([
      'NRT-arrivals-tomorrow', 'GUM-arrivals-tomorrow', 'IAH-departures-tomorrow',
    ]);
  });

  it('rotates which disrupted hub wins the capped slots across consecutive runs (seed)', () => {
    const plan = [t('DEN', 'departures', 1), t('IAH', 'departures', 1), t('GUM', 'arrivals', 1), t('NRT', 'arrivals', 1)];
    const run0 = applyIropsPriority(plan, ['ORD', 'EWR'], 0);
    const run1 = applyIropsPriority(plan, ['ORD', 'EWR'], 1);
    // Run 0 leads with ORD; run 1 leads with EWR — EWR-arrivals (left out of run 0) warms now.
    expect(run0.injected).toEqual(['ORD-departures-today', 'ORD-arrivals-today', 'EWR-departures-today']);
    expect(run1.injected).toEqual(['EWR-departures-today', 'EWR-arrivals-today', 'ORD-departures-today']);
    // Across the two runs, ALL four disrupted-hub today boards were warmed.
    const union = new Set([...run0.injected, ...run1.injected]);
    expect(union.size).toBe(4);
  });

  it('with 3+ disrupted hubs, every hub board cycles through within a rotation period (no starvation)', () => {
    // The old fixed HUBS-order victim scan let the SAME first two hubs win every run — hub 3's
    // boards never warmed. Three consecutive slots must collectively cover all 6 boards.
    const plan = [t('DEN', 'departures', 1), t('IAH', 'departures', 1), t('GUM', 'arrivals', 1), t('NRT', 'arrivals', 1)];
    const hubs = ['ORD', 'EWR', 'SFO'];
    const warmedAcrossRuns = new Set();
    for (let seed = 0; seed < 3; seed++) {
      const out = applyIropsPriority(plan, hubs, seed);
      for (const k of out.plan.map(key)) {
        if (k.endsWith('-today')) warmedAcrossRuns.add(k);
      }
      // Every individual run still leaves ≥1 ring slot.
      expect(out.injected.length).toBeLessThanOrEqual(plan.length - 1);
    }
    expect(warmedAcrossRuns.size).toBe(6); // 3 hubs × 2 directions all cycled through
  });

  it('rotation seed is stable modulo the disrupted-hub count (negative/large seeds are safe)', () => {
    const plan = [t('DEN', 'departures', 1), t('IAH', 'departures', 1), t('GUM', 'arrivals', 1), t('NRT', 'arrivals', 1)];
    const a = applyIropsPriority(plan, ['ORD', 'EWR'], 2);
    const b = applyIropsPriority(plan, ['ORD', 'EWR'], 0);
    expect(a.plan.map(key)).toEqual(b.plan.map(key));
    const c = applyIropsPriority(plan, ['ORD', 'EWR'], -1);
    const d = applyIropsPriority(plan, ['ORD', 'EWR'], 1);
    expect(c.plan.map(key)).toEqual(d.plan.map(key));
  });
});

describe('warm-schedules handler IROPS integration', () => {
  const SECRET = 'test-cron-secret-1234';

  function createRes() {
    return {
      statusCode: 200,
      body: null,
      status(code) { this.statusCode = code; return this; },
      json(payload) { this.body = payload; return this; },
    };
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.CRON_SECRET = SECRET;
    process.env.SCHEDULE_WARM_DELAY_MS = '0';
    process.env.SCHEDULE_WARM_TASKS_PER_RUN = '3';
    __resetFaaDisruptionCacheForTests();
    __resetAlertThrottleForTests();
    __resetAdbSpendForTests();
  });

  afterEach(() => {
    delete process.env.CRON_SECRET;
    delete process.env.SCHEDULE_WARM_DELAY_MS;
    delete process.env.SCHEDULE_WARM_TASKS_PER_RUN;
    __resetFaaDisruptionCacheForTests();
    __resetAlertThrottleForTests();
    __resetAdbSpendForTests();
  });

  it('warms the disrupted hub today boards every run while an FAA program is active', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes('nasstatus.faa.gov/api/airport-events')) {
        return {
          ok: true, status: 200,
          headers: { get: () => null },
          json: async () => ([{ airportId: 'ORD', groundDelay: { impactingCondition: 'thunderstorms', avgDelay: 293, maxDelay: 353 } }]),
        };
      }
      return {
        ok: true, status: 200,
        headers: { get: () => null },
        json: async () => (u.includes('/api/schedule')
          ? { cached: false, stale: false, partial: false, total: 300, meta: { completeness: 1 } }
          : { ok: true }),
      };
    });
    const res = createRes();
    await handler({ method: 'GET', headers: { authorization: `Bearer ${SECRET}` } }, res);

    expect(res.statusCode).toBe(200);
    const scheduleKeys = Object.keys(res.body.results).filter((k) => k !== 'starlink-data');
    // Task budget unchanged (3), and both ORD today boards are in this run.
    expect(scheduleKeys).toHaveLength(3);
    expect(scheduleKeys).toContain('ORD-departures-today');
    expect(scheduleKeys).toContain('ORD-arrivals-today');
    // Priority boards run FIRST.
    expect(res.body.warmPlan[0].hub).toBe('ORD');
    expect(res.body.warmPlan[0].label).toBe('today');
  });

  it('leaves the ring plan untouched when no hub has an active program', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes('nasstatus.faa.gov/api/airport-events')) {
        return { ok: true, status: 200, headers: { get: () => null }, json: async () => ([]) };
      }
      return {
        ok: true, status: 200, headers: { get: () => null },
        json: async () => (u.includes('/api/schedule')
          ? { cached: false, stale: false, partial: false, total: 300, meta: { completeness: 1 } }
          : { ok: true }),
      };
    });
    const res = createRes();
    await handler({ method: 'GET', headers: { authorization: `Bearer ${SECRET}` } }, res);
    expect(res.statusCode).toBe(200);
    const basePlan = buildWarmPlan().map((task) => `${task.hub}-${task.dir}-${task.label}`);
    const executed = res.body.warmPlan.map((task) => `${task.hub}-${task.dir}-${task.label}`);
    expect(executed).toEqual(basePlan);
  });
});
