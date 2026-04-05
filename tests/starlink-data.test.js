import { describe, it, expect, vi, beforeEach } from 'vitest';
import handler from '../api/starlink-data.js';

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

function makeReq(overrides = {}) {
  return {
    method: 'GET',
    headers: {},
    ...overrides,
  };
}

function mockUpstreamResponse() {
  return {
    starlinkPlanes: [
      { TailNumber: 'N37559', fleet: 'mainline', Aircraft: 'B738', OperatedBy: 'United Airlines' },
      { TailNumber: 'N77296', fleet: 'express', Aircraft: 'E175', OperatedBy: 'SkyWest Airlines' },
    ],
    totalCount: 2,
    fleetStats: {
      mainline: { starlink: 100, total: 800 },
      express: { starlink: 50, total: 500 },
      combined: { starlink: 150, total: 1300 },
    },
    flightsByTail: {
      N37559: [
        { flight_number: 'UA1234', departure_airport: 'ORD', arrival_airport: 'LAX', departure_time: '2026-04-04T10:00:00Z' },
      ],
    },
    lastUpdated: '2026-04-04T12:00:00Z',
  };
}

// IMPORTANT: The handler uses a module-level inMemoryCache that persists across tests.
// Tests are ordered so error/validation tests run FIRST (before any successful fetch
// populates the cache), then success tests populate the cache for remaining tests.
describe('starlink-data API', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete (globalThis).__starlinkCache;
  });

  // --- Validation (no fetch needed) ---

  it('rejects non-GET methods', async () => {
    const res = createRes();
    await handler(makeReq({ method: 'POST' }), res);
    expect(res.statusCode).toBe(405);
  });

  // --- Error paths (must run before any successful fetch populates inMemoryCache) ---

  it('returns 502 when upstream fails and no cache exists', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('upstream down'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = createRes();
    await handler(makeReq(), res);

    expect(res.statusCode).toBe(502);
    expect(res.body.error).toMatch(/Failed to fetch/);
    spy.mockRestore();
  });

  it('returns 502 when upstream returns non-ok status and no cache', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 503 });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = createRes();
    await handler(makeReq(), res);

    expect(res.statusCode).toBe(502);
    spy.mockRestore();
  });

  // --- Cron cache ---

  it('serves cron-populated cache when available', async () => {
    const cronData = { aircraft: [], totalCount: 0, syncedAt: '2026-04-04T12:00:00Z' };
    (globalThis).__starlinkCache = cronData;

    const res = createRes();
    await handler(makeReq(), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(cronData);
    expect(res.headers['Cache-Control']).toMatch(/s-maxage=3600/);
  });

  // --- Success paths (populate inMemoryCache for subsequent tests) ---

  it('fetches upstream and normalizes aircraft data', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => mockUpstreamResponse(),
    });

    const res = createRes();
    await handler(makeReq(), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.aircraft).toHaveLength(2);
    expect(res.body.aircraft[0].tail).toBe('N37559');
    expect(res.body.aircraft[0].fleet).toBe('Mainline');
    expect(res.body.aircraft[1].fleet).toBe('Express');
    expect(res.body.fleetStats.mainline).toBe(100);
    expect(res.body.fleetStats.express).toBe(50);
    expect(res.body.totalCount).toBe(2);

    // Verify flight normalization
    const flights = res.body.flightsByTail.N37559;
    expect(flights).toHaveLength(1);
    expect(flights[0].origin).toBe('ORD');
    expect(flights[0].destination).toBe('LAX');
  });

  // --- After inMemoryCache is populated, error falls back to stale cache ---

  it('serves stale cache when upstream fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('upstream down again'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = createRes();
    await handler(makeReq(), res);

    // Should serve stale cache (200) instead of 502
    expect(res.statusCode).toBe(200);
    expect(res.body.aircraft).toBeDefined();
    spy.mockRestore();
  });
});
