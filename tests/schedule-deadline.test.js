// /api/schedule must answer inside its 60-second maxDuration even when a dependency hangs
// (TODOS: "/api/schedule can run past its 60-second limit"; two invocations hit it on Nov 7 2026).
//
// These run the REAL snapshot / cost-state / sightings modules and the REAL postgrest-js query
// builder, so the `.abortSignal()` plumbing is exercised end to end: every Supabase request goes
// through `globalThis.fetch`, and the fake network below never answers one — it only rejects when
// the request's own AbortSignal fires, which is what undici does. On the code before the fix
// (no signal on any query, the FR24 timer cleared before the body read) each handler call below
// never settles, so the "finished" assertions fail.
//
// Timers are fake (setTimeout/clearTimeout/Date) so a 50-second deadline costs no real time.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PostgrestClient } from '@supabase/postgrest-js';

const vercelFunctionMocks = vi.hoisted(() => ({ waitUntil: vi.fn() }));
vi.mock('@vercel/functions', () => vercelFunctionMocks);

// supabase-js's createClient → a bare PostgREST client on the same URL. It is the query builder
// both api/_schedule-snapshots.ts (dynamic import) and api/_supabase.ts use, minus the auth layer
// (which only adds headers); requests go out through the global fetch at call time.
vi.mock('@supabase/supabase-js', () => ({
  createClient: (url, key) => new PostgrestClient(`${url}/rest/v1`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
    fetch: (...args) => globalThis.fetch(...args),
  }),
}));

import handler, { __resetScheduleCachesForTests, resetFallbackBreaker } from '../api/schedule.js';
import { __resetRateLimitersForTests } from '../api/_rate-limit.js';
import { __resetRegSightingsForTests } from '../api/_reg-sightings.js';

const SUPABASE_URL = 'https://bb-test.supabase.invalid';
const FUNCTION_LIMIT_MS = 60_000;

const abortError = () => Object.assign(new Error('This operation was aborted'), { name: 'AbortError' });

/** A request that never answers; it rejects only when its AbortSignal fires (undici behaviour). */
function hangUntilAborted(signal) {
  return new Promise((_, reject) => {
    if (!signal) return;
    if (signal.aborted) { reject(abortError()); return; }
    signal.addEventListener('abort', () => reject(abortError()), { once: true });
  });
}

const FR24_PAGE = {
  result: {
    response: {
      airport: {
        pluginData: {
          schedule: {
            departures: {
              page: { current: 1, total: 1 },
              data: [{
                flight: {
                  airline: { code: { iata: 'UA' } },
                  identification: { number: { default: 'UA100' } },
                  // Noon CDT on Jul 4 2026, the board day scheduleRequest() asks for (ORD day start 1783141200).
                  time: { scheduled: { departure: 1783184400, arrival: 1783195200 } },
                  airport: { origin: { code: { iata: 'ORD' } }, destination: { code: { iata: 'LAX' } } },
                },
              }],
            },
          },
        },
      },
    },
  },
};

function createRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

/** Drive the fake clock until the handler settles or the platform would have killed it. */
async function runUntilSettledOrKilled(promise) {
  const startedAt = Date.now();
  let settled = false;
  promise.then(() => { settled = true; }, () => { settled = true; });
  while (!settled && Date.now() - startedAt < FUNCTION_LIMIT_MS + 5_000) {
    await vi.advanceTimersByTimeAsync(250);
    // Let real I/O callbacks (module loading) run between fake ticks.
    await new Promise((resolve) => setImmediate(resolve));
  }
  return { settled, elapsedMs: Date.now() - startedAt };
}

/** Drive the fake clock until every promise handed to waitUntil has settled (or the limit passed). */
async function drainBackground(startedAt) {
  let done = false;
  Promise.all(vercelFunctionMocks.waitUntil.mock.calls.map((c) => c[0])).then(() => { done = true; }, () => { done = true; });
  while (!done && Date.now() - startedAt < FUNCTION_LIMIT_MS + 5_000) {
    await vi.advanceTimersByTimeAsync(250);
    await new Promise((resolve) => setImmediate(resolve));
  }
  return done;
}

function scheduleRequest() {
  // Yesterday's board: no same-day live-feed rescue, no targeted official rescue.
  const ts = Math.floor(Date.now() / 1000) - 86400;
  return { method: 'GET', headers: { origin: 'http://localhost:3000' }, query: { hub: 'ORD', dir: 'departures', timestamp: String(ts) } };
}

describe('/api/schedule answers inside its time limit when a dependency hangs', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(new Date('2026-07-05T18:00:00Z'));
    __resetRateLimitersForTests();
    __resetScheduleCachesForTests();
    __resetRegSightingsForTests();
    resetFallbackBreaker();
    vercelFunctionMocks.waitUntil.mockReset();
    process.env.SCHEDULE_RETRY_DELAY_SCALE = '0';
    process.env.SCHEDULE_LIVE_FEED_FALLBACK_ENABLED = 'false';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SCHEDULE_RETRY_DELAY_SCALE;
    delete process.env.SCHEDULE_LIVE_FEED_FALLBACK_ENABLED;
  });

  it('a Supabase that never answers costs the bounded reads and write, and the fetched board is served', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
    const supabaseSignals = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      const href = String(url);
      if (href.startsWith(SUPABASE_URL)) {
        supabaseSignals.push(init?.signal);
        return hangUntilAborted(init?.signal);
      }
      if (href.includes('api.flightradar24.com/common/v1/airport.json')) {
        return { ok: true, status: 200, headers: { get: () => null }, json: async () => FR24_PAGE };
      }
      return { ok: false, status: 503, headers: { get: () => null }, text: async () => '', json: async () => ({}) };
    });

    const startedAt = Date.now();
    const res = createRes();
    const { settled, elapsedMs } = await runUntilSettledOrKilled(handler(scheduleRequest(), res));

    expect(settled).toBe(true);
    expect(elapsedMs).toBeLessThan(FUNCTION_LIMIT_MS);
    expect(res.statusCode).toBe(200);
    expect(res.body.total).toBe(1);

    // The background work (the sightings load) settles inside the limit too, and every Supabase
    // request — quota read, snapshot read, snapshot write, sightings read — was cancelled by its
    // own signal rather than left open.
    expect(await drainBackground(startedAt)).toBe(true);
    expect(Date.now() - startedAt).toBeLessThan(FUNCTION_LIMIT_MS);
    expect(supabaseSignals.length).toBeGreaterThanOrEqual(4);
    expect(supabaseSignals.every((signal) => signal?.aborted)).toBe(true);
  });

  it('an FR24 body that never finishes is cut off by the request timeout, and the visitor still gets an answer', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      const href = String(url);
      if (href.includes('api.flightradar24.com/common/v1/airport.json')) {
        // Headers arrive; the body never does. Only the request's signal ends the read.
        return { ok: true, status: 200, headers: { get: () => null }, json: () => hangUntilAborted(init?.signal) };
      }
      return { ok: false, status: 503, headers: { get: () => null }, text: async () => '', json: async () => ({}) };
    });

    const res = createRes();
    const { settled, elapsedMs } = await runUntilSettledOrKilled(handler(scheduleRequest(), res));

    expect(settled).toBe(true);
    expect(elapsedMs).toBeLessThan(FUNCTION_LIMIT_MS);
    // The existing degraded answer for a failed first page: a partial board, not an error.
    expect(res.statusCode).toBe(200);
    expect(res.body.partial).toBe(true);
  });

  it('a background refresh started late in a request is held to that request\'s deadline, write included', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
    const startedAt = Date.now();
    // A complete board persisted 3 hours ago: served at once, and a background refresh is kicked.
    const snapshotRow = {
      payload: { flights: FR24_PAGE.result.response.airport.pluginData.schedule.departures.data.map((r) => r.flight), total: 1, partial: false, meta: { source: 'scraping' } },
      refreshed_at: new Date(startedAt - 3 * 3600_000).toISOString(),
    };
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      const href = String(url);
      if (href.startsWith(SUPABASE_URL)) {
        // The serve path's snapshot read answers; every other Supabase call hangs.
        if (href.includes('schedule_snapshots') && href.includes('expires_at=gt.') && (init?.method || 'GET') === 'GET') {
          return new Response(JSON.stringify([snapshotRow]), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return hangUntilAborted(init?.signal);
      }
      if (href.includes('api.flightradar24.com/common/v1/airport.json')) {
        return { ok: true, status: 200, headers: { get: () => null }, json: () => hangUntilAborted(init?.signal) };
      }
      return { ok: false, status: 503, headers: { get: () => null }, text: async () => '', json: async () => ({}) };
    });

    const res = createRes();
    const { settled } = await runUntilSettledOrKilled(handler(scheduleRequest(), res));
    expect(settled).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(res.body.meta.fallbackScope).toBe('persistent');

    // Everything handed to waitUntil must settle before the platform's limit, counted from the
    // START of the request — not from when the refresh was kicked.
    expect(vercelFunctionMocks.waitUntil).toHaveBeenCalled();
    expect(await drainBackground(startedAt)).toBe(true);
    expect(Date.now() - startedAt).toBeLessThan(FUNCTION_LIMIT_MS);
  });
});
