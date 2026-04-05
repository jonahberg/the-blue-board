import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import handler from '../api/cron/refresh-tsa.js';

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

describe('refresh-tsa cron', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubEnv('CRON_SECRET', 'test-cron-secret');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
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

  it('calls /api/tsa and returns hub count on success', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        hubs: { ORD: {}, DEN: {}, EWR: {} },
        lastRefreshed: '2026-04-04T12:00:00Z',
      }),
    });

    const res = createRes();
    await handler(makeReq(), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.hubs).toBe(3);
  });

  it('returns 502 when /api/tsa responds with error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'Internal error',
    });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = createRes();
    await handler(makeReq(), res);

    expect(res.statusCode).toBe(502);
    expect(res.body.error).toMatch(/Cache warm failed/);
    spy.mockRestore();
  });

  it('returns 504 on timeout (AbortError)', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      Object.assign(new Error('aborted'), { name: 'AbortError' })
    );
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = createRes();
    await handler(makeReq(), res);

    expect(res.statusCode).toBe(504);
    expect(res.body.error).toMatch(/timed out/);
    spy.mockRestore();
  });

  it('returns 500 on generic error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('DNS failure'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = createRes();
    await handler(makeReq(), res);

    expect(res.statusCode).toBe(500);
    spy.mockRestore();
  });

  it('uses production URL when VERCEL_PROJECT_PRODUCTION_URL is set', async () => {
    vi.stubEnv('VERCEL_PROJECT_PRODUCTION_URL', 'theblueboard.co');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ hubs: {}, lastRefreshed: '2026-04-04T12:00:00Z' }),
    });

    const res = createRes();
    await handler(makeReq(), res);

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://theblueboard.co/api/tsa',
      expect.anything()
    );
  });
});
