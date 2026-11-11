// A slow database read must not cost money (/api/schedule).
//
// The stored-snapshot read in front of the fetch decides whether a metered provider is called at
// all. It was bounded at 2.5 s, and a read that ran out of time answered "no snapshot", so the
// request went on to fetch, provider fallback included. Now the read gets ~6 s, and a read that
// still runs out of time serves a copy already in memory instead of fetching. With nothing in hand
// the fetch proceeds as before (tests/schedule-deadline.test.js pins that a board is still served).
//
// Real snapshot / cost-state / postgrest modules, fake network and fake timers, as in
// tests/schedule-deadline.test.js.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PostgrestClient } from '@supabase/postgrest-js';

const vercelFunctionMocks = vi.hoisted(() => ({ waitUntil: vi.fn() }));
vi.mock('@vercel/functions', () => vercelFunctionMocks);
vi.mock('@supabase/supabase-js', () => ({
  createClient: (url, key) => new PostgrestClient(`${url}/rest/v1`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
    fetch: (...args) => globalThis.fetch(...args),
  }),
}));

import handler, { __resetScheduleCachesForTests, resetFallbackBreaker } from '../api/schedule.js';
import { __resetRateLimitersForTests } from '../api/_rate-limit.js';
import { __resetRegSightingsForTests } from '../api/_reg-sightings.js';
import { __resetAdbSpendForTests, getAdbPacedAllowance, getAdbUnitsToday, recordAdbUnits } from '../api/_cost-state.js';

const SUPABASE_URL = 'https://bb-test.supabase.invalid';
// Compare origins, not prefixes: a prefix check would also accept a longer look-alike host.
const isSupabaseUrl = (href) => {
  try {
    return new URL(href).origin === new URL(SUPABASE_URL).origin;
  } catch {
    return false;
  }
};
const abortError = () => Object.assign(new Error('This operation was aborted'), { name: 'AbortError' });
function hangUntilAborted(signal) {
  return new Promise((_, reject) => {
    if (!signal) return;
    if (signal.aborted) { reject(abortError()); return; }
    signal.addEventListener('abort', () => reject(abortError()), { once: true });
  });
}

// Noon CDT on Jul 4 2026: yesterday's ORD board (no same-day live-feed or official rescue).
const flight = (n) => ({
  airline: { code: { iata: 'UA' } },
  identification: { number: { default: `UA${n}` } },
  time: { scheduled: { departure: 1783184400 + n * 60, arrival: 1783195200 + n * 60 } },
  airport: { origin: { code: { iata: 'ORD' } }, destination: { code: { iata: 'LAX' } } },
});
const fr24Page = (current, total, flights) => ({
  result: { response: { airport: { pluginData: { schedule: { departures: { page: { current, total }, data: flights.map((f) => ({ flight: f })) } } } } } },
});

function createRes() {
  return {
    statusCode: 200, headers: {}, body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}
async function run(promise) {
  const startedAt = Date.now();
  let settled = false;
  promise.then(() => { settled = true; }, () => { settled = true; });
  while (!settled && Date.now() - startedAt < 65_000) {
    await vi.advanceTimersByTimeAsync(250);
    await new Promise((resolve) => setImmediate(resolve));
  }
  return { settled, elapsedMs: Date.now() - startedAt };
}
function scheduleRequest() {
  const ts = Math.floor(Date.now() / 1000) - 86400;
  return { method: 'GET', headers: { origin: 'http://localhost:3000' }, query: { hub: 'ORD', dir: 'departures', timestamp: String(ts) } };
}

const net = { snapshotRead: 'empty', snapshotRow: null, snapshotDelayMs: 0, adbCalls: 0, fr24Calls: 0, officialCalls: 0 };

function installNetwork() {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    const href = String(url);
    const method = init?.method || 'GET';
    if (isSupabaseUrl(href)) {
      if (href.includes('schedule_snapshots') && href.includes('expires_at=gt.') && method === 'GET') {
        if (net.snapshotRead === 'hang') return hangUntilAborted(init?.signal);
        if (net.snapshotRead === 'slow') {
          await new Promise((resolve) => setTimeout(resolve, net.snapshotDelayMs));
          return new Response(JSON.stringify([net.snapshotRow]), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
      }
      // Everything else (quota, spend, sightings, writes) answers at once with nothing.
      return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (href.includes('aerodatabox')) {
      net.adbCalls++;
      return new Response(JSON.stringify({ departures: [flight(7), flight(8), flight(9)] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (href.includes('api.flightradar24.com/common/v1/airport.json')) {
      net.fr24Calls++;
      const page = Number(new URL(href).searchParams.get('page') || 1);
      if (page === 1) return { ok: true, status: 200, headers: { get: () => null }, json: async () => fr24Page(1, 2, [flight(1), flight(2)]) };
      return { ok: false, status: 503, headers: { get: () => null }, text: async () => '', json: async () => ({}) };
    }
    if (/fr24api\.flightradar24\.com/.test(href)) net.officialCalls++;
    return { ok: false, status: 503, headers: { get: () => null }, text: async () => '', json: async () => ({}) };
  });
}

describe('/api/schedule: a slow snapshot read does not buy a metered fetch', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(new Date('2026-07-05T18:00:00Z'));
    __resetRateLimitersForTests();
    __resetScheduleCachesForTests();
    __resetRegSightingsForTests();
    __resetAdbSpendForTests();
    resetFallbackBreaker();
    vercelFunctionMocks.waitUntil.mockReset();
    process.env.SCHEDULE_RETRY_DELAY_SCALE = '0';
    process.env.SCHEDULE_LIVE_FEED_FALLBACK_ENABLED = 'false';
    process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
    process.env.AERODATABOX_INTER_WINDOW_DELAY_MS = '0';
    process.env.AERODATABOX_DAILY_UNIT_BUDGET = '100000';
    Object.assign(net, { snapshotRead: 'empty', snapshotRow: null, snapshotDelayMs: 0, adbCalls: 0, fr24Calls: 0, officialCalls: 0 });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    installNetwork();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    for (const key of ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SCHEDULE_RETRY_DELAY_SCALE',
      'SCHEDULE_LIVE_FEED_FALLBACK_ENABLED', 'AERODATABOX_API_KEY', 'AERODATABOX_INTER_WINDOW_DELAY_MS', 'AERODATABOX_DAILY_UNIT_BUDGET']) {
      delete process.env[key];
    }
    __resetAdbSpendForTests();
  });

  it('a snapshot read that takes 4 s is waited for and served; nothing is fetched', async () => {
    process.env.AERODATABOX_API_KEY = 'adb-test-key';
    const startedAt = Date.now();
    net.snapshotRead = 'slow';
    net.snapshotDelayMs = 4_000;
    net.snapshotRow = {
      payload: { flights: [flight(1), flight(2), flight(3)], total: 3, partial: false, meta: { source: 'scraping' } },
      // Fresh: no background refresh either.
      refreshed_at: new Date(startedAt - 5 * 60_000).toISOString(),
    };
    const res = createRes();
    const { settled } = await run(handler(scheduleRequest(), res));
    expect(settled).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(res.body.total).toBe(3);
    expect(res.body.meta.fallbackScope).toBe('persistent');
    expect(net.fr24Calls).toBe(0);
    expect(net.adbCalls).toBe(0);
    expect(getAdbUnitsToday()).toBe(0);
  });

  it('a read that runs out of time serves the partial board already in memory, and spends no provider units', async () => {
    // First request, provider off: FR24 page 1 answers, page 2 fails → a non-empty partial in the hot cache.
    const first = createRes();
    await run(handler(scheduleRequest(), first));
    expect(first.statusCode).toBe(200);
    expect(first.body.partial).toBe(true);
    expect(first.body.total).toBe(2);

    // Past the partial's 60 s TTL, inside the stale grace: the copy is in hand but not served from
    // the hot cache. Now the provider is configured and allowed, and the database hangs.
    await vi.advanceTimersByTimeAsync(70_000);
    process.env.AERODATABOX_API_KEY = 'adb-test-key';
    net.snapshotRead = 'hang';
    const fr24Before = net.fr24Calls;
    const unitsBefore = getAdbUnitsToday();
    const second = createRes();
    const { settled, elapsedMs } = await run(handler(scheduleRequest(), second));

    expect(settled).toBe(true);
    // The read was given its ~6 s, then the in-memory copy was served.
    expect(elapsedMs).toBeGreaterThanOrEqual(6_000);
    expect(elapsedMs).toBeLessThan(10_000);
    expect(second.statusCode).toBe(200);
    expect(second.body.total).toBe(2);
    expect(second.body.cached).toBe(true);
    expect(second.body.stale).toBe(true);
    expect(second.body.meta.dataAge).toBeGreaterThanOrEqual(70);
    // No metered source was touched, by the request or by the refresh it kicked.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(net.adbCalls).toBe(0);
    expect(net.officialCalls).toBe(0);
    expect(getAdbUnitsToday()).toBe(unitsBefore);
    // (The free FR24 path may refresh it in the background; on the old code this request itself
    // re-fetched FR24 and then called AeroDataBox twice, 4 units.)
    expect(net.fr24Calls - fr24Before).toBeLessThanOrEqual(2);
  });

  it('a read that runs out of time does not unlock the first-load headroom: the fetch stays on the paced line', async () => {
    // Organic spend already at the paced line; the first-load headroom (10% of the budget) is left.
    process.env.AERODATABOX_API_KEY = 'adb-test-key';
    process.env.AERODATABOX_DAILY_UNIT_BUDGET = '100';
    await recordAdbUnits(getAdbPacedAllowance());

    // Control: the read answers "no snapshot" at once — a real first load, so the headroom is used.
    const control = createRes();
    await run(handler(scheduleRequest(), control));
    expect(control.statusCode).toBe(200);
    expect(net.adbCalls).toBeGreaterThan(0);

    // Same board, a hung read: not known to be a first load, so no headroom and no provider call.
    __resetScheduleCachesForTests();
    __resetRateLimitersForTests();
    net.adbCalls = 0;
    net.snapshotRead = 'hang';
    const res = createRes();
    const { settled } = await run(handler(scheduleRequest(), res));
    expect(settled).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(res.body.total).toBe(2);
    expect(net.adbCalls).toBe(0);
  });

  it('with nothing in hand, a read that runs out of time still fetches (a board beats an error)', async () => {
    net.snapshotRead = 'hang';
    const res = createRes();
    const { settled } = await run(handler(scheduleRequest(), res));
    expect(settled).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(net.fr24Calls).toBeGreaterThan(0);
    expect(res.body.total).toBe(2);
  });
});
