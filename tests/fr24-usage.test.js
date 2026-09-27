import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import handler, { __resetFr24UsageForTests } from '../api/fr24-usage.js';
import { __resetRateLimitersForTests } from '../api/_rate-limit.js';

function createRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    ended: false,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
    end() { this.ended = true; return this; },
  };
}

// All non-preflight requests must carry the CRON_SECRET bearer — this endpoint
// exposes paid FR24 plan billing/credit telemetry and is owner/ops-only.
const CRON_SECRET = 'test-cron-secret';
function authedHeaders(extra = {}) {
  return { origin: 'http://localhost:3000', authorization: `Bearer ${CRON_SECRET}`, ...extra };
}

describe('fr24-usage API', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    __resetFr24UsageForTests();
    __resetRateLimitersForTests();
    process.env.CRON_SECRET = CRON_SECRET;
  });

  afterEach(() => {
    delete process.env.FR24_API_TOKEN;
    delete process.env.CRON_SECRET;
  });

  it('returns 401 with no Authorization header and never calls upstream', async () => {
    process.env.FR24_API_TOKEN = 'test-token-12345678';
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const req = { method: 'GET', headers: { origin: 'http://localhost:3000' } };
    const res = createRes();
    await handler(req, res);

    expect(res.statusCode).toBe(401);
    expect(res.body.error).toBe('Unauthorized');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns 401 for a wrong bearer token and never calls upstream', async () => {
    process.env.FR24_API_TOKEN = 'test-token-12345678';
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const req = { method: 'GET', headers: { origin: 'http://localhost:3000', authorization: 'Bearer wrong-secret' } };
    const res = createRes();
    await handler(req, res);

    expect(res.statusCode).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('fails closed (401) when CRON_SECRET is unset, even with a bearer', async () => {
    delete process.env.CRON_SECRET;
    process.env.FR24_API_TOKEN = 'test-token-12345678';
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const req = { method: 'GET', headers: { origin: 'http://localhost:3000', authorization: 'Bearer undefined' } };
    const res = createRes();
    await handler(req, res);

    expect(res.statusCode).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns graceful error when no API token configured', async () => {
    const req = { method: 'GET', headers: authedHeaders() };
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.data).toBeNull();
    expect(res.body.error).toContain('No FR24 API token');
  });

  it('sets correct CORS headers for allowed origin', async () => {
    const req = { method: 'GET', headers: { origin: 'https://theblueboard.co' } };
    const res = createRes();

    await handler(req, res);

    expect(res.headers['Access-Control-Allow-Origin']).toBe('https://theblueboard.co');
    expect(res.headers['Access-Control-Allow-Methods']).toBe('GET, OPTIONS');
  });

  it('defaults CORS origin for disallowed origin', async () => {
    const req = { method: 'GET', headers: { origin: 'https://evil.com' } };
    const res = createRes();

    await handler(req, res);

    expect(res.headers['Access-Control-Allow-Origin']).toBe('https://theblueboard.co');
  });

  it('returns 204 for OPTIONS preflight', async () => {
    const req = { method: 'OPTIONS', headers: { origin: 'https://theblueboard.co' } };
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(204);
    expect(res.ended).toBe(true);
  });

  it('returns 405 for non-GET methods', async () => {
    const req = { method: 'POST', headers: { origin: 'http://localhost:3000' } };
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(405);
  });

  it('proxies FR24 usage data with cached flag when authorized', async () => {
    process.env.FR24_API_TOKEN = 'test-token-12345678';

    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { endpoint: '/api/flight-summary', request_count: 50, credits: 150 },
          { endpoint: '/api/live/flight-positions', request_count: 30, credits: 90 },
        ]
      }),
    });

    const req = { method: 'GET', headers: authedHeaders() };
    const res = createRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.cached).toBe(false);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0].credits).toBe(150);
  });

  it('never emits a shared-cache directive — an s-maxage 200 would be served to unauthenticated requests', async () => {
    process.env.FR24_API_TOKEN = 'test-token-12345678';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ endpoint: '/test', request_count: 1, credits: 5 }] }),
    });
    const res = createRes();
    await handler({ method: 'GET', headers: authedHeaders() }, res);
    expect(res.statusCode).toBe(200);
    // The CDN caches by URL with no Vary: Authorization — a shared-cache TTL on the authorized
    // 200 is a 5-minute auth bypass for the billing telemetry this gate protects.
    expect(res.headers['Cache-Control']).toBe('private, no-store');
  });

  it('returns cached data on second call', async () => {
    process.env.FR24_API_TOKEN = 'test-token-12345678';

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ endpoint: '/test', request_count: 1, credits: 5 }] }),
    });

    const req = { method: 'GET', headers: authedHeaders() };

    const res1 = createRes();
    await handler(req, res1);
    expect(res1.body.cached).toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const res2 = createRes();
    await handler(req, res2);
    expect(res2.body.cached).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('refetches once the 5-minute cache TTL has passed', async () => {
    process.env.FR24_API_TOKEN = 'test-token-12345678';
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-01T12:00:00Z'));

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ endpoint: '/test', request_count: 1, credits: 5 }] }),
    });
    const req = { method: 'GET', headers: authedHeaders() };

    await handler(req, createRes());
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date('2026-09-01T12:05:01Z'));
    const res = createRes();
    await handler(req, res);
    expect(res.body.cached).toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
