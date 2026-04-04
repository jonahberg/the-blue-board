import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import handler from '../api/cron/sync-starlink.js';

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
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
    ...overrides,
  };
}

function mockUpstream(planes = 2) {
  return {
    starlinkPlanes: Array.from({ length: planes }, (_, i) => ({
      TailNumber: `N${10000 + i}`,
      fleet: i % 2 === 0 ? 'mainline' : 'express',
      Aircraft: 'B738',
      OperatedBy: 'United Airlines',
    })),
    totalCount: planes,
    fleetStats: {
      mainline: { starlink: 1, total: 800 },
      express: { starlink: 1, total: 500 },
      combined: { starlink: planes, total: 1300 },
    },
    flightsByTail: {},
    lastUpdated: '2026-04-04T12:00:00Z',
  };
}

describe('sync-starlink cron', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubEnv('CRON_SECRET', 'test-secret');
    delete (globalThis).__starlinkCache;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    delete (globalThis).__starlinkCache;
  });

  it('rejects unauthorized requests', async () => {
    const res = createRes();
    await handler(makeReq({ headers: { authorization: 'Bearer wrong' } }), res);
    expect(res.statusCode).toBe(401);
  });

  it('rejects requests with no auth header', async () => {
    const res = createRes();
    await handler(makeReq({ headers: {} }), res);
    expect(res.statusCode).toBe(401);
  });

  it('syncs data from upstream and stores in globalThis', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => mockUpstream(3),
    });

    const res = createRes();
    await handler(makeReq(), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.aircraft_count).toBe(3);

    // Verify globalThis cache was populated
    const cache = (globalThis).__starlinkCache;
    expect(cache).toBeDefined();
    expect(cache.aircraft).toHaveLength(3);
    expect(cache.syncedAt).toBeDefined();
  });

  it('normalizes aircraft data format', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => mockUpstream(1),
    });

    const res = createRes();
    await handler(makeReq(), res);

    const cache = (globalThis).__starlinkCache;
    expect(cache.aircraft[0].tail).toBe('N10000');
    expect(cache.aircraft[0].fleet).toBe('Mainline'); // capitalized
    expect(cache.aircraft[0].type).toBe('B738');
  });

  it('returns 502 when upstream returns error status', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 503,
    });

    const res = createRes();
    await handler(makeReq(), res);

    expect(res.statusCode).toBe(502);
    expect(res.body.error).toMatch(/503/);
  });

  it('returns 500 on network error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network fail'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = createRes();
    await handler(makeReq(), res);

    expect(res.statusCode).toBe(500);
    spy.mockRestore();
  });
});
