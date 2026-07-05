import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import handler, { buildScheduleWarmUrl, buildWarmPlan } from '../api/cron/warm-schedules.js';
import { __resetAlertThrottleForTests } from '../api/_alert.js';
import { recordAdbUnits, __resetAdbSpendForTests } from '../api/_cost-state.js';
import { getStartOfHubDay } from '../src/lib/hubTz.js';

describe('warm-schedules buildWarmPlan', () => {
  // The production code reads this env per call; pin it so an ambient export in a dev/CI shell
  // can't skew every count-based assertion in this file.
  beforeEach(() => { process.env.SCHEDULE_WARM_TASKS_PER_RUN = '3'; });
  afterEach(() => { delete process.env.SCHEDULE_WARM_TASKS_PER_RUN; });

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
    process.env.SCHEDULE_WARM_TASKS_PER_RUN = '3'; // pin the per-call env read (see plan describe)
    __resetAlertThrottleForTests();
    __resetAdbSpendForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.CRON_SECRET;
    delete process.env.SCHEDULE_WARM_DELAY_MS;
    delete process.env.SCHEDULE_WARM_TASKS_PER_RUN;
    delete process.env.ALERT_WEBHOOK_URL;
    __resetAlertThrottleForTests();
    __resetAdbSpendForTests();
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
      // Exact per-task assertion (not "either day"): a bug that swaps the today/tomorrow
      // dayOffset mapping must fail here, not just the yesterday-rollback regression.
      const plan = buildWarmPlan(Date.now());
      for (const [url] of scheduleCalls) {
        const u = new URL(String(url));
        const hub = u.searchParams.get('hub');
        const dir = u.searchParams.get('dir');
        const ts = Number(u.searchParams.get('timestamp'));
        const task = plan.find(t => t.hub === hub && t.dir === dir);
        expect(task, `${h}:30Z no plan task for ${hub} ${dir}`).toBeTruthy();
        expect(ts, `${h}:30Z ${hub} ${dir} (${task.label})`).toBe(getStartOfHubDay(task.hub, task.dayOffset));
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
    const scheduleResults = Object.entries(res.body.results).filter(([k]) => k !== 'starlink-data' && k !== 'regSightings');
    for (const [, r] of scheduleResults) expect(r.status).toBe('stale_served');
    // The Starlink ping has nothing to do with AeroDataBox and is built to never fail — its
    // success must not turn an every-board-frozen run into a green 200 (that 200-while-frozen
    // masking is the exact incident this commit exists to surface).
    expect(res.body.scheduleWarmed).toBe(0);
    expect(res.statusCode).toBe(503);
  });

  it('counts a fresh complete board as warmed', async () => {
    mockFetchOk({ cached: false, stale: false, partial: false, total: 312, meta: { completeness: 1 } });
    const res = createRes();
    await handler(createReq(), res);
    expect(res.body.failed).toBe(0);
    expect(res.body.warmed).toBe(4); // 3 schedule tasks + starlink
    expect(res.statusCode).toBe(200);
  });

  it('counts a CDN HIT or cache-served warm as NOT refreshed — a warm that did not refetch warmed nothing', async () => {
    // Tripwire for CDN pinning of the warm URL: a HIT means the stored body (possibly a frozen
    // board recorded as cached:false hours ago) came back without the lambda running at all.
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => ({
      ok: true,
      status: 200,
      headers: { get: (h) => (h === 'x-vercel-cache' && String(url).includes('/api/schedule') ? 'HIT' : null) },
      json: async () => (String(url).includes('/api/schedule')
        ? { cached: false, stale: false, partial: false, total: 300, meta: { completeness: 1 } }
        : { ok: true }),
    }));
    const res = createRes();
    await handler(createReq(), res);
    expect(res.body.scheduleWarmed).toBe(0);
    expect(res.statusCode).toBe(503);
    const scheduleResults = Object.entries(res.body.results).filter(([k]) => k !== 'starlink-data' && k !== 'regSightings');
    for (const [, r] of scheduleResults) expect(r.status).toBe('not_refreshed');
  });

  it('counts a cache-served body (cached:true, e.g. force silently ignored) as NOT refreshed', async () => {
    // If CRON_SECRET is missing from the schedule lambda's env, forceRefresh is silently ignored
    // and the warm gets the cached board back — that must not report a green ok.
    mockFetchOk({ cached: true, stale: false, partial: false, total: 300, meta: { completeness: 1 } });
    const res = createRes();
    await handler(createReq(), res);
    expect(res.body.scheduleWarmed).toBe(0);
    expect(res.statusCode).toBe(503);
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

  it('alerts the webhook when every schedule warm is frozen (stale_served)', async () => {
    process.env.ALERT_WEBHOOK_URL = 'https://discord.test/webhook';
    const fetchSpy = mockFetchOk({ cached: true, stale: true, degraded: true, partial: false, total: 628, meta: { dataAge: 106495 } });
    await handler(createReq(), createRes());
    const alertCalls = fetchSpy.mock.calls.filter(([url]) => String(url).includes('discord.test'));
    expect(alertCalls.length).toBe(1);
    const body = JSON.parse(alertCalls[0][1].body);
    expect(body.content).toMatch(/stale|frozen/i);
  });

  it('does not alert on a fully healthy run', async () => {
    process.env.ALERT_WEBHOOK_URL = 'https://discord.test/webhook';
    const fetchSpy = mockFetchOk({ cached: false, stale: false, partial: false, total: 312, meta: { completeness: 1 } });
    await handler(createReq(), createRes());
    const alertCalls = fetchSpy.mock.calls.filter(([url]) => String(url).includes('discord.test'));
    expect(alertCalls.length).toBe(0);
  });

  it('alerts when daily AeroDataBox spend crosses 80% of the budget, even on a healthy run', async () => {
    process.env.ALERT_WEBHOOK_URL = 'https://discord.test/webhook';
    await recordAdbUnits(340); // 85% of the 400 default
    const fetchSpy = mockFetchOk({ cached: false, stale: false, partial: false, total: 312, meta: { completeness: 1 } });
    await handler(createReq(), createRes());
    const alertCalls = fetchSpy.mock.calls.filter(([url]) => String(url).includes('discord.test'));
    expect(alertCalls.length).toBe(1);
    expect(JSON.parse(alertCalls[0][1].body).content).toMatch(/budget|units/i);
  });

  it('fails CLOSED when CRON_SECRET is unset — "Bearer undefined" must not authenticate', async () => {
    // A plain `auth !== `Bearer ${process.env.CRON_SECRET}`` check with the env var missing
    // compares against the literal string "Bearer undefined" — a guessable constant.
    delete process.env.CRON_SECRET;
    const res = createRes();
    await handler({ method: 'GET', headers: { authorization: 'Bearer undefined' } }, res);
    expect(res.statusCode).toBe(401);
  });

  it('counts a partial non-empty board as degraded_partial — a FAILED warm', async () => {
    mockFetchOk({ cached: false, stale: false, partial: true, total: 50, meta: { completeness: 0.5 } });
    const res = createRes();
    await handler(createReq(), res);
    const scheduleResults = Object.entries(res.body.results).filter(([k]) => k !== 'starlink-data' && k !== 'regSightings');
    expect(scheduleResults.length).toBe(3);
    for (const [key, r] of scheduleResults) expect(r.status, key).toBe('degraded_partial');
    // A half-board did not warm anything: the schedule counters must reflect total failure even
    // though the starlink ping succeeded, and the run must go red for cron monitoring.
    expect(res.body.scheduleWarmed).toBe(0);
    expect(res.body.scheduleFailed).toBe(3);
    expect(res.body.failed).toBe(3);
    expect(res.statusCode).toBe(503);
  });

  it('counts a partial EMPTY board as degraded_empty — a FAILED warm', async () => {
    mockFetchOk({ cached: false, stale: false, partial: true, total: 0, meta: { completeness: 0 } });
    const res = createRes();
    await handler(createReq(), res);
    const scheduleResults = Object.entries(res.body.results).filter(([k]) => k !== 'starlink-data' && k !== 'regSightings');
    expect(scheduleResults.length).toBe(3);
    for (const [key, r] of scheduleResults) expect(r.status, key).toBe('degraded_empty');
    expect(res.body.scheduleWarmed).toBe(0);
    expect(res.body.scheduleFailed).toBe(3);
    expect(res.statusCode).toBe(503);
  });

  it("marks a schedule warm whose fetch throws as status 'error' (a FAILED warm)", async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('/api/schedule')) throw new Error('socket hang up');
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ ok: true }) };
    });
    const res = createRes();
    await handler(createReq(), res);
    const scheduleResults = Object.entries(res.body.results).filter(([k]) => k !== 'starlink-data' && k !== 'regSightings');
    expect(scheduleResults.length).toBe(3);
    for (const [key, r] of scheduleResults) {
      expect(r.status, key).toBe('error');
      expect(r.message, key).toBe('socket hang up');
    }
    expect(res.body.scheduleWarmed).toBe(0);
    expect(res.body.scheduleFailed).toBe(3);
    // Starlink still warmed (its fetch resolves), but that must not mask the schedule incident.
    expect(res.statusCode).toBe(503);
  });

  it('returns 200 on a MIXED run where at least one board actually warmed', async () => {
    // 503 is reserved for "warmed NOTHING": one genuinely fresh board out of three is a partial
    // success, and flapping the cron red on every transient stale-serve would bury real incidents.
    let scheduleCalls = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const isSchedule = String(url).includes('/api/schedule');
      if (!isSchedule) {
        return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ ok: true }) };
      }
      scheduleCalls++;
      const fresh = scheduleCalls === 1;
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => fresh
          ? { cached: false, stale: false, partial: false, total: 280, meta: { completeness: 1 } }
          : { cached: true, stale: true, degraded: true, partial: false, total: 600, meta: { dataAge: 106495 } },
      };
    });
    const res = createRes();
    await handler(createReq(), res);
    expect(res.body.scheduleWarmed).toBe(1);
    expect(res.body.scheduleFailed).toBe(2);
    expect(res.statusCode).toBe(200);
  });
});
