import { describe, it, expect, vi, beforeEach } from 'vitest';
import handler from '../api/predict-flight.js';

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

describe('predict-flight API', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects non-GET requests', async () => {
    const res = createRes();
    await handler(makeReq({ method: 'POST' }), res);
    expect(res.statusCode).toBe(405);
  });

  it('returns 400 when flight_number is missing', async () => {
    const res = createRes();
    await handler(makeReq({ query: {} }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/flight_number/);
  });

  it('returns 400 when flight_number is empty string', async () => {
    const res = createRes();
    await handler(makeReq({ query: { flight_number: '  ' } }), res);
    expect(res.statusCode).toBe(400);
  });

  // Error tests run before success to avoid module-level cache interference
  it('returns 502 on upstream failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network error'));
    const res = createRes();
    await handler(makeReq({ query: { flight_number: 'UA100' } }), res);
    expect(res.statusCode).toBe(502);
    expect(res.body.error).toMatch(/unavailable/);
  });

  it('forwards upstream error status codes', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 404,
    });
    const res = createRes();
    await handler(makeReq({ query: { flight_number: 'UA999' } }), res);
    expect(res.statusCode).toBe(404);
    expect(res.body.error).toMatch(/404/);
  });

  it('normalizes flight numbers with UA prefix', async () => {
    const prediction = { flightNumber: 'UA1234', hasStarlink: true };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => prediction,
    });

    const res = createRes();
    await handler(makeReq({ query: { flight_number: '1234' } }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(prediction);
    // Should add UA prefix and encode in URL
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('flight_number=UA1234'),
      expect.any(Object)
    );
  });

  it('uppercases existing UA prefix', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ flightNumber: 'UA500' }),
    });

    const res = createRes();
    await handler(makeReq({ query: { flight_number: 'ua500' } }), res);

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('flight_number=UA500'),
      expect.any(Object)
    );
  });

  it('sets cache control headers on success', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ prediction: 'data' }),
    });

    const res = createRes();
    await handler(makeReq({ query: { flight_number: 'UA200' } }), res);

    expect(res.statusCode).toBe(200);
    expect(res.headers['Cache-Control']).toBe('public, s-maxage=1800, stale-while-revalidate=300');
  });

  it('sends correct User-Agent header to upstream', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });

    const res = createRes();
    await handler(makeReq({ query: { flight_number: 'UA300' } }), res);

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: { 'User-Agent': 'BlueBoard-PredictFlight/1.0' },
      })
    );
  });
});
