// Data-quality release (Jul 3 2026 audit) — #3 server side: every aggregation-mode board
// response carries meta.hubDisruptionMinutes (live FAA program magnitude, 0 when none) so the
// frontend can extend the Departed-inference grace during a GDP.
// NON-BLOCKING contract: serve paths attach the synchronously PEEKED cached value and kick a
// background refresh when the cache is cold — a cache-hit serve never awaits the FAA fetch
// (the first request after a cold start may read 0; the refresh warms it for the next).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const scheduleSnapshotMocks = vi.hoisted(() => ({
  loadScheduleSnapshot: vi.fn(async () => null),
  saveScheduleSnapshot: vi.fn(async () => {}),
  getSupabaseAdmin: vi.fn(async () => null),
}));

const vercelFunctionMocks = vi.hoisted(() => ({
  waitUntil: vi.fn(),
}));

vi.mock(process.cwd() + '/api/_schedule-snapshots.ts', () => scheduleSnapshotMocks);
vi.mock('@vercel/functions', () => vercelFunctionMocks);

import handler, { resetFallbackBreaker, __resetScheduleCachesForTests } from '../api/schedule.js';
import { __resetFaaDisruptionCacheForTests } from '../api/faa.js';
import { __resetRateLimitersForTests } from '../api/_rate-limit.js';

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

function mockUpstreams({ ordDisruptionAvg = null, adbBoard = true } = {}) {
  const nowSec = Math.floor(Date.now() / 1000);
  const iso = (offsetS) => new Date((nowSec + offsetS) * 1000).toISOString();
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
    const u = String(url);
    if (u.includes('nasstatus.faa.gov/api/airport-events')) {
      const events = ordDisruptionAvg
        ? [{ airportId: 'ORD', groundDelay: { impactingCondition: 'thunderstorms', avgDelay: ordDisruptionAvg, maxDelay: ordDisruptionAvg + 60 } }]
        : [];
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => events };
    }
    if (u.includes('aedbx/aerodatabox') && adbBoard) {
      return {
        ok: true, status: 200,
        json: async () => ({
          departures: [{
            number: 'UA 123', callSign: 'UAL123', status: 'Scheduled',
            airline: { iata: 'UA', icao: 'UAL', name: 'United Airlines' },
            departure: { scheduledTime: { utc: iso(7200) }, terminal: '1', gate: 'C18', airport: { iata: 'ORD' } },
            arrival: { scheduledTime: { utc: iso(18000) }, airport: { iata: 'SFO' } },
            aircraft: { model: 'Boeing 737 MAX 9', reg: 'N37502' },
          }],
        }),
      };
    }
    return { ok: false, status: 403, text: async () => 'blocked', headers: { get: () => null }, json: async () => ({}) };
  });
}

describe('schedule board meta.hubDisruptionMinutes', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    __resetRateLimitersForTests();
    __resetScheduleCachesForTests();
    __resetFaaDisruptionCacheForTests();
    process.env.AERODATABOX_INTER_WINDOW_DELAY_MS = '0';
    process.env.SCHEDULE_SOURCE_PRIORITY = 'provider';
    process.env.AERODATABOX_API_KEY = 'adb-test-key';
    scheduleSnapshotMocks.loadScheduleSnapshot.mockReset();
    scheduleSnapshotMocks.loadScheduleSnapshot.mockResolvedValue(null);
    scheduleSnapshotMocks.saveScheduleSnapshot.mockReset();
    scheduleSnapshotMocks.saveScheduleSnapshot.mockResolvedValue(undefined);
  });

  afterEach(() => {
    delete process.env.AERODATABOX_INTER_WINDOW_DELAY_MS;
    delete process.env.SCHEDULE_SOURCE_PRIORITY;
    delete process.env.AERODATABOX_API_KEY;
    __resetFaaDisruptionCacheForTests();
    resetFallbackBreaker();
  });

  function boardReq(hub = 'ORD') {
    return {
      method: 'GET',
      headers: { origin: 'http://localhost:3000' },
      query: { hub, dir: 'departures', timestamp: String(Math.floor(Date.now() / 1000)) },
    };
  }

  it('carries the live GDP magnitude on a fresh provider board (the ORD 293-min case)', async () => {
    // The kick fires at request start; the FAA mock resolves in microtasks while the (much
    // longer) provider board fetch runs, so the peek at serve time reads the warmed 293.
    mockUpstreams({ ordDisruptionAvg: 293 });
    const res = createRes();
    await handler(boardReq('ORD'), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.meta.source).toBe('aerodatabox');
    expect(res.body.meta.hubDisruptionMinutes).toBe(293);
  });

  it('reports 0 when the hub has no active FAA program', async () => {
    mockUpstreams({ ordDisruptionAvg: null });
    const res = createRes();
    await handler(boardReq('ORD'), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.meta.hubDisruptionMinutes).toBe(0);
  });

  it('reports 0 (never throws) when the FAA lookup itself is down', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const iso = (offsetS) => new Date((nowSec + offsetS) * 1000).toISOString();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes('nasstatus.faa.gov')) throw new Error('FAA down');
      if (u.includes('aedbx/aerodatabox')) {
        return {
          ok: true, status: 200,
          json: async () => ({
            departures: [{
              number: 'UA 456', callSign: 'UAL456', status: 'Scheduled',
              airline: { iata: 'UA' },
              departure: { scheduledTime: { utc: iso(7200) }, airport: { iata: 'DEN' } },
              arrival: { scheduledTime: { utc: iso(18000) }, airport: { iata: 'ORD' } },
              aircraft: {},
            }],
          }),
        };
      }
      return { ok: false, status: 403, text: async () => 'blocked', headers: { get: () => null } };
    });
    const res = createRes();
    await handler(boardReq('DEN'), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.meta.hubDisruptionMinutes).toBe(0);
  });

  it('also attaches the field on cache-served boards (second request, same key)', async () => {
    mockUpstreams({ ordDisruptionAvg: 293 });
    const first = createRes();
    await handler(boardReq('ORD'), first);
    expect(first.body.cached).toBeFalsy();

    const second = createRes();
    await handler(boardReq('ORD'), second);
    expect(second.statusCode).toBe(200);
    expect(second.body.cached).toBe(true);
    expect(second.body.meta.hubDisruptionMinutes).toBe(293);
  });

  it('a cache-hit serve does NOT await the FAA fetch: response returns while the FAA fetch hangs', async () => {
    // Warm the board cache with the FAA endpoint healthy-but-empty (no disruption).
    mockUpstreams({ ordDisruptionAvg: null });
    const first = createRes();
    await handler(boardReq('ORD'), first);
    expect(first.statusCode).toBe(200);

    // Expire the FAA disruption cache and make the FAA fetch HANG FOREVER. Under the old
    // blocking contract every cache-hit serve awaited withDisruption → this handler call would
    // never resolve (test timeout). The non-blocking contract peeks (0) and kicks the refresh
    // into the background instead.
    __resetFaaDisruptionCacheForTests();
    const faaCalls = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
      if (String(url).includes('nasstatus.faa.gov')) {
        faaCalls.push(String(url));
        return new Promise(() => {}); // hangs — never resolves
      }
      throw new Error(`cache-hit serve must not refetch the board: ${url}`);
    });

    const second = createRes();
    await handler(boardReq('ORD'), second);
    expect(second.statusCode).toBe(200);
    expect(second.body.cached).toBe(true);
    // The refresh WAS kicked (background), but the serve did not wait for it.
    expect(faaCalls.length).toBe(1);
    expect(second.body.meta.hubDisruptionMinutes).toBe(0);
  });
});
