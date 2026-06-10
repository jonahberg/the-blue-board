import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import handler, { buildScheduleWarmUrl, buildWarmPlan } from '../api/cron/warm-schedules.js';
import { getStartOfHubDay } from '../src/lib/hubTz.js';

describe('warm-schedules buildWarmPlan', () => {
  const HUBS = ['ORD', 'DEN', 'IAH', 'EWR', 'SFO', 'IAD', 'LAX', 'NRT', 'GUM'];
  const UNIQUE_WINDOWS = 9 * 4;       // 9 hubs × (today+tomorrow) × 2 dirs; yesterday is on-demand
  const TODAY_ROUNDS = 3;             // each today window is warmed 3×/day (~every 8h)
  const RING_SIZE = 9 * 2 * TODAY_ROUNDS + 9 * 2; // 54 today slots + 18 tomorrow slots = 72
  const SLOT_MS = 60 * 60 * 1000;     // must match the cron interval / SLOT_MS in warm-schedules.ts (hourly)

  it('returns an array of warm tasks', () => {
    const plan = buildWarmPlan();
    expect(Array.isArray(plan)).toBe(true);
    expect(plan.length).toBeGreaterThan(0);
  });

  it('each task has required fields and never warms yesterday', () => {
    // Sweep a full rotation so we assert across every window the plan can emit, not just one slot.
    const start = new Date('2026-04-03T00:00:00Z').getTime();
    for (let i = 0; i < RING_SIZE + 4; i++) {
      const plan = buildWarmPlan(start + i * SLOT_MS);
      for (const task of plan) {
        expect(HUBS).toContain(task.hub);
        expect(['departures', 'arrivals']).toContain(task.dir);
        expect([0, 1]).toContain(task.dayOffset);          // today / tomorrow only
        expect(['today', 'tomorrow']).toContain(task.label); // yesterday is on-demand, never warmed
      }
    }
  });

  it('returns different tasks for different hourly slots', () => {
    const t1 = new Date('2026-04-03T00:00:00Z').getTime();
    const t2 = new Date('2026-04-03T01:00:00Z').getTime();
    const keys1 = buildWarmPlan(t1).map(t => `${t.hub}-${t.dir}-${t.label}`);
    const keys2 = buildWarmPlan(t2).map(t => `${t.hub}-${t.dir}-${t.label}`);
    expect(keys1).not.toEqual(keys2);
  });

  it('returns consistent results for the same timestamp', () => {
    const t = new Date('2026-04-03T12:00:00Z').getTime();
    expect(buildWarmPlan(t)).toEqual(buildWarmPlan(t));
  });

  it('limits plan size to WARM_TASKS_PER_RUN (default 3)', () => {
    // 3 tasks × 24 hourly fires = 72 slots/day = one full ring: today boards 3×/day, tomorrow 1×/day,
    // ≈ 72 fresh boards × 4 units = 288 AeroDataBox units/day — the metered-plan budget.
    expect(buildWarmPlan().length).toBe(3);
  });

  it('covers every window over a day, warming today 3× and tomorrow 1×', () => {
    const counts = new Map();
    const start = new Date('2026-04-03T00:00:00Z').getTime();
    // 24 hourly fires × 3 tasks = 72 slots = exactly one full ring.
    for (let i = 0; i < 24; i++) {
      for (const task of buildWarmPlan(start + i * SLOT_MS)) {
        const key = `${task.hub}-${task.dir}-${task.label}`;
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    }
    expect(counts.size).toBe(UNIQUE_WINDOWS);
    for (const [key, n] of counts) {
      expect(n, key).toBe(key.endsWith('today') ? TODAY_ROUNDS : 1);
    }
  });

  it('spreads the repeats of a given today-window across the day instead of bunching them', () => {
    const start = new Date('2026-04-03T00:00:00Z').getTime();
    const fires = [];
    for (let i = 0; i < 24; i++) {
      for (const task of buildWarmPlan(start + i * SLOT_MS)) {
        if (task.hub === 'ORD' && task.dir === 'departures' && task.label === 'today') fires.push(i);
      }
    }
    expect(fires.length).toBe(3);
    // Consecutive warms of the same board should be roughly a round apart (≥4h), not back-to-back.
    for (let i = 1; i < fires.length; i++) {
      expect(fires[i] - fires[i - 1]).toBeGreaterThanOrEqual(4);
    }
  });

  it('warms via the provider with a forced refresh while keeping paid FR24 + dead scrape off', () => {
    const url = buildScheduleWarmUrl('ORD', 'departures', 1778907600);
    expect(url).toContain('/api/schedule?');
    expect(url).toContain('hub=ORD');
    expect(url).toContain('dir=departures');
    expect(url).toContain('timestamp=1778907600');
    // Background warming uses the provider (the only working full-board source) ...
    expect(url).toContain('providerFallback=1');
    // ... but never burns FR24 official credits, and skips the Cloudflare-dead scrape.
    expect(url).toContain('officialFallback=0');
    expect(url).toContain('scraperFallback=0');
    // The whole point of the warm is a FRESH board: bypass the frozen-snapshot serve paths.
    expect(url).toContain('forceRefresh=1');
  });
});

describe('warm-schedules handler', () => {
  const SECRET = 'test-cron-secret-1234';

  function createRes() {
    return {
      statusCode: 200,
      body: null,
      status(code) { this.statusCode = code; return this; },
      json(payload) { this.body = payload; return this; },
    };
  }

  function createReq() {
    return { method: 'GET', headers: { authorization: `Bearer ${SECRET}` } };
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.CRON_SECRET = SECRET;
    process.env.SCHEDULE_WARM_DELAY_MS = '0';
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.CRON_SECRET;
    delete process.env.SCHEDULE_WARM_DELAY_MS;
  });

  function mockFetchOk(schedulePayload) {
    return vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => (String(url).includes('/api/schedule') ? schedulePayload : { ok: true }),
    }));
  }

  it('sends forceRefresh + cron authorization on every schedule warm request', async () => {
    const fetchSpy = mockFetchOk({ cached: false, stale: false, partial: false, total: 100, meta: {} });
    await handler(createReq(), createRes());
    const scheduleCalls = fetchSpy.mock.calls.filter(([url]) => String(url).includes('/api/schedule'));
    expect(scheduleCalls.length).toBeGreaterThan(0);
    for (const [url, opts] of scheduleCalls) {
      expect(String(url)).toContain('forceRefresh=1');
      expect(opts.headers['Authorization']).toBe(`Bearer ${SECRET}`);
    }
  });

  it('warms hub-correct day keys (getStartOfHubDay) at every hour, even pre-6AM hub-local', async () => {
    // Sweep the clock across the day: pre-6AM hub-local (e.g. 3:30 AM Chicago) is the window where
    // the old getStartOfDayForHub rollback warmed YESTERDAY's key and the slot's quota was spent on
    // a mislabeled board (~25% of slots).
    for (let h = 0; h < 24; h += 3) {
      vi.useFakeTimers({ now: new Date(Date.UTC(2026, 5, 10, h, 30)), toFake: ['Date'] });
      const fetchSpy = mockFetchOk({ cached: false, stale: false, partial: false, total: 100, meta: {} });
      await handler(createReq(), createRes());
      const scheduleCalls = fetchSpy.mock.calls.filter(([url]) => String(url).includes('/api/schedule'));
      expect(scheduleCalls.length).toBeGreaterThan(0);
      for (const [url] of scheduleCalls) {
        const u = new URL(String(url));
        const hub = u.searchParams.get('hub');
        const ts = Number(u.searchParams.get('timestamp'));
        expect([getStartOfHubDay(hub, 0), getStartOfHubDay(hub, 1)], `${h}:30Z ${hub} ts ${ts}`).toContain(ts);
      }
      vi.restoreAllMocks();
      vi.useRealTimers();
    }
  });

  it('counts a stale-served board as a FAILED warm (the frozen-board signature)', async () => {
    mockFetchOk({ cached: true, stale: true, degraded: true, partial: false, total: 628, meta: { dataAge: 106495 } });
    const res = createRes();
    await handler(createReq(), res);
    // All schedule tasks served frozen snapshots → none warmed; only starlink succeeded.
    expect(res.body.failed).toBeGreaterThanOrEqual(3);
    expect(res.body.warmed).toBe(1);
    const scheduleResults = Object.entries(res.body.results).filter(([k]) => k !== 'starlink-data');
    for (const [, r] of scheduleResults) expect(r.status).toBe('stale_served');
  });

  it('counts a fresh complete board as warmed', async () => {
    mockFetchOk({ cached: false, stale: false, partial: false, total: 312, meta: { completeness: 1 } });
    const res = createRes();
    await handler(createReq(), res);
    expect(res.body.failed).toBe(0);
    expect(res.body.warmed).toBe(4); // 3 schedule tasks + starlink
    expect(res.statusCode).toBe(200);
  });

  it('returns 503 when every warm task fails so cron monitoring turns red', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 500,
      headers: { get: () => null },
      json: async () => ({}),
    });
    const res = createRes();
    await handler(createReq(), res);
    expect(res.body.warmed).toBe(0);
    expect(res.statusCode).toBe(503);
  });

  it('rejects requests without the cron secret', async () => {
    const res = createRes();
    await handler({ method: 'GET', headers: {} }, res);
    expect(res.statusCode).toBe(401);
  });
});
