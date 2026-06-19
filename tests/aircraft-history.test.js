import { describe, it, expect, vi, beforeEach } from 'vitest';
import handler, { normalizeSegments } from '../api/aircraft-history.js';

function createRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
    end() { return this; },
  };
}

// Use unique reg per test to avoid module-level cache collisions
let regCounter = 0;
function uniqueReg() { return `N${String(++regCounter).padStart(5, '0')}`; }

function makeReq(overrides = {}) {
  return {
    method: 'GET',
    headers: { origin: 'http://localhost:3000' },
    query: { reg: uniqueReg() },
    ...overrides,
  };
}

describe('aircraft-history API', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.FR24_API_TOKEN = 'test-token';
  });

  // --- Method / validation ---

  it('handles OPTIONS preflight', async () => {
    const res = createRes();
    await handler(makeReq({ method: 'OPTIONS' }), res);
    expect(res.statusCode).toBe(204);
  });

  it('rejects non-GET/OPTIONS methods', async () => {
    const res = createRes();
    await handler(makeReq({ method: 'POST' }), res);
    expect(res.statusCode).toBe(405);
  });

  it('returns 500 when FR24_API_TOKEN is missing', async () => {
    delete process.env.FR24_API_TOKEN;
    const res = createRes();
    await handler(makeReq(), res);
    expect(res.statusCode).toBe(500);
    expect(res.body.error).toMatch(/FR24 API not configured/);
  });

  it('returns 400 for missing reg param', async () => {
    const res = createRes();
    await handler(makeReq({ query: {} }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/Invalid registration/);
  });

  it('returns 400 for invalid reg format', async () => {
    const res = createRes();
    await handler(makeReq({ query: { reg: 'AB' } }), res);
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 for reg with special characters', async () => {
    const res = createRes();
    await handler(makeReq({ query: { reg: 'N12!@#' } }), res);
    expect(res.statusCode).toBe(400);
  });

  // --- Successful fetch ---

  it('returns normalized segments on success', async () => {
    const reg = uniqueReg();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{
          flight_iata: 'UA123',
          origin: { iata: 'ORD' },
          destination: { iata: 'LAX' },
          status: 'landed',
          departure: { scheduled: '2026-04-04T10:00:00Z', actual: '2026-04-04T10:15:00Z' },
          arrival: { scheduled: '2026-04-04T14:00:00Z', actual: '2026-04-04T14:10:00Z', estimated: '2026-04-04T14:05:00Z' },
        }],
      }),
    });

    const res = createRes();
    await handler(makeReq({ query: { reg } }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.reg).toBe(reg);
    expect(res.body.segments).toHaveLength(1);
    expect(res.body.segments[0].flightNumber).toBe('UA123');
    expect(res.body.segments[0].delayMin).toBe(15);
  });

  it('normalizes reg to uppercase and strips hyphens', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ data: [] }),
    });

    const res = createRes();
    await handler(makeReq({ query: { reg: 'n-abcde' } }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.reg).toBe('NABCDE');
  });

  // --- Error paths ---

  it('returns 502 when FR24 responds with error status', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    });

    const res = createRes();
    await handler(makeReq(), res);

    expect(res.statusCode).toBe(502);
    expect(res.body.error).toMatch(/FR24 API error/);
  });

  it('returns HTTP 200 (not 5xx) when FR24 declines on billing/auth (402/403/429)', async () => {
    // An upstream BILLING/auth decline is not a gateway fault: returning 5xx for a credit-blocked
    // (402) feed violates HTTP semantics, is the only 5xx class in prod, and would trip any
    // 5xx-based uptime canary. The frontend reads only `success`, so a 200 + success:false degrades
    // identically. Genuine upstream 5xx / network faults still return 502 (see tests above/below).
    for (const status of [402, 403, 429]) {
      vi.restoreAllMocks();
      process.env.FR24_API_TOKEN = 'test-token';
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: false,
        status,
        text: async () => 'declined',
      });

      const res = createRes();
      await handler(makeReq(), res);

      expect(res.statusCode, `upstream ${status} should map to HTTP 200`).toBe(200);
      expect(res.body.success).toBe(false);
      expect(res.body.upstreamStatus).toBe(status);
    }
  });

  it('returns 504 on fetch timeout (AbortError)', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      Object.assign(new Error('aborted'), { name: 'AbortError' })
    );

    const res = createRes();
    await handler(makeReq(), res);

    expect(res.statusCode).toBe(504);
    expect(res.body.error).toMatch(/timeout/i);
  });

  it('returns 502 on network error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));

    const res = createRes();
    await handler(makeReq(), res);

    expect(res.statusCode).toBe(502);
    expect(res.body.error).toMatch(/unavailable/i);
  });

  // --- Caching ---

  it('serves cached response on second request', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ data: [] }),
    });

    const res1 = createRes();
    await handler(makeReq({ query: { reg: 'NCACHE1' } }), res1);
    expect(res1.statusCode).toBe(200);

    const res2 = createRes();
    await handler(makeReq({ query: { reg: 'NCACHE1' } }), res2);
    expect(res2.statusCode).toBe(200);
    expect(res2.body.cached).toBe(true);
    // fetch should only be called once — second request hits cache
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  // --- CORS ---

  it('sets correct CORS headers for allowed origin', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ data: [] }),
    });

    const res = createRes();
    await handler(makeReq({ headers: { origin: 'https://theblueboard.co' } }), res);
    expect(res.headers['Access-Control-Allow-Origin']).toBe('https://theblueboard.co');
  });

  it('defaults CORS to theblueboard.co for unknown origins', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ data: [] }),
    });

    const res = createRes();
    await handler(makeReq({ headers: { origin: 'https://evil.com' } }), res);
    expect(res.headers['Access-Control-Allow-Origin']).toBe('https://theblueboard.co');
  });
});

describe('normalizeSegments', () => {
  it('returns empty array for null/undefined data', () => {
    expect(normalizeSegments(null)).toEqual([]);
    expect(normalizeSegments(undefined)).toEqual([]);
    expect(normalizeSegments({})).toEqual([]);
  });

  it('filters out segments with missing airports', () => {
    const result = normalizeSegments({
      data: [
        { flight_iata: 'UA1', origin: { iata: 'ORD' }, destination: { iata: 'LAX' }, departure: {}, arrival: {} },
        { flight_iata: 'UA2', origin: {}, destination: { iata: 'LAX' }, departure: {}, arrival: {} }, // missing origin
      ],
    });
    expect(result).toHaveLength(1);
    expect(result[0].flightNumber).toBe('UA1');
  });

  it('computes delay in minutes correctly', () => {
    const result = normalizeSegments({
      data: [{
        flight_iata: 'UA100',
        origin: { iata: 'EWR' },
        destination: { iata: 'SFO' },
        departure: { scheduled: '2026-04-04T08:00:00Z', actual: '2026-04-04T08:45:00Z' },
        arrival: {},
      }],
    });
    expect(result[0].delayMin).toBe(45);
  });

  it('returns null delay when times are missing', () => {
    const result = normalizeSegments({
      data: [{
        flight_iata: 'UA200',
        origin: { iata: 'DEN' },
        destination: { iata: 'IAH' },
        departure: {},
        arrival: {},
      }],
    });
    expect(result[0].delayMin).toBeNull();
  });

  it('limits to 5 segments sorted by most recent', () => {
    const data = Array.from({ length: 8 }, (_, i) => ({
      flight_iata: `UA${i}`,
      origin: { iata: 'ORD' },
      destination: { iata: 'LAX' },
      departure: { scheduled: new Date(2026, 3, 1 + i).toISOString() },
      arrival: {},
    }));
    const result = normalizeSegments({ data });
    expect(result).toHaveLength(5);
    // Most recent first
    expect(result[0].flightNumber).toBe('UA7');
  });
});
