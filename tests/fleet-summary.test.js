import { describe, it, expect, vi, beforeEach } from 'vitest';
import handler, { _resetCacheForTest } from '../api/fleet-summary.js';

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
    query: {},
    ...overrides,
  };
}

const SAMPLE = {
  airlines: [
    { code: 'UA', name: 'United Airlines', installed: 400, total: 1782, percentage: 22.4 },
    { code: 'HA', name: 'Hawaiian Airlines', installed: 42, total: 61, percentage: 68.9 },
    { code: 'AS', name: 'Alaska Airlines', installed: 97, total: 346, percentage: 28 },
  ],
  generatedAt: '2026-06-14T00:00:00.000Z',
};

describe('fleet-summary API', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    _resetCacheForTest();
  });

  it('rejects non-GET requests', async () => {
    const res = createRes();
    await handler(makeReq({ method: 'POST' }), res);
    expect(res.statusCode).toBe(405);
  });

  it('rejects a disallowed cross-origin request', async () => {
    const res = createRes();
    await handler(makeReq({ headers: { origin: 'https://evil.example' } }), res);
    expect(res.statusCode).toBe(403);
  });

  it('allows the production origin and proxies the upstream payload through unchanged', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => SAMPLE,
    });
    const res = createRes();
    await handler(makeReq({ headers: { origin: 'https://theblueboard.co' } }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(SAMPLE);
    expect(res.headers['Access-Control-Allow-Origin']).toBe('https://theblueboard.co');
  });

  it('allows a localhost origin', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => SAMPLE });
    const res = createRes();
    await handler(makeReq({ headers: { origin: 'http://localhost:4321' } }), res);
    expect(res.statusCode).toBe(200);
    expect(res.headers['Access-Control-Allow-Origin']).toBe('http://localhost:4321');
  });

  it('sets the 5-minute cache-control header on success', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => SAMPLE });
    const res = createRes();
    await handler(makeReq(), res);
    expect(res.statusCode).toBe(200);
    expect(res.headers['Cache-Control']).toBe('public, s-maxage=300, stale-while-revalidate=60');
  });

  it('sends the correct User-Agent and hits the documented upstream URL', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => SAMPLE });
    const res = createRes();
    await handler(makeReq(), res);
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://unitedstarlinktracker.com/api/fleet-summary',
      expect.objectContaining({ headers: { 'User-Agent': 'BlueBoard-FleetSummary/1.0' } })
    );
  });

  it('serves a second request from cache without re-fetching upstream', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => SAMPLE });
    await handler(makeReq(), createRes());
    const res2 = createRes();
    await handler(makeReq(), res2);
    expect(res2.statusCode).toBe(200);
    expect(res2.body).toEqual(SAMPLE);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('forwards upstream non-2xx status codes', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 503 });
    const res = createRes();
    await handler(makeReq(), res);
    expect(res.statusCode).toBe(503);
    expect(res.body.error).toMatch(/503/);
  });

  it('returns 502 on upstream connection failure (degraded — strip hides client-side)', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
    const res = createRes();
    await handler(makeReq(), res);
    expect(res.statusCode).toBe(502);
    expect(res.body.error).toMatch(/unavailable/);
  });

  it('short-circuits to 502 without re-fetching inside the negative-cache window', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
    await handler(makeReq(), createRes());
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const res2 = createRes();
    await handler(makeReq(), res2);
    expect(res2.statusCode).toBe(502);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('probes upstream again once the negative-cache window expires', async () => {
    vi.useFakeTimers();
    try {
      const fetchSpy = vi.spyOn(globalThis, 'fetch')
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockResolvedValue({ ok: true, json: async () => SAMPLE });

      await handler(makeReq(), createRes());
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(61 * 1000);

      const resOk = createRes();
      await handler(makeReq(), resOk);
      expect(resOk.statusCode).toBe(200);
      expect(resOk.body).toEqual(SAMPLE);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
