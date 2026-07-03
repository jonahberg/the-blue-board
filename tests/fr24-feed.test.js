import { describe, it, expect, vi, beforeEach } from 'vitest';
import handler, { countFeedAircraft } from '../api/fr24-feed.js';

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

describe('fr24-feed API', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects non-GET requests', async () => {
    const res = createRes();
    await handler({ method: 'POST', headers: {}, query: {} }, res);
    expect(res.statusCode).toBe(405);
  });

  it('rejects forbidden origins', async () => {
    const res = createRes();
    await handler({ method: 'GET', headers: { origin: 'https://evil.com' }, query: {} }, res);
    expect(res.statusCode).toBe(403);
  });

  it('rejects invalid airline codes', async () => {
    const res = createRes();
    await handler({
      method: 'GET',
      headers: { origin: 'http://localhost:3000' },
      query: { airline: 'DROP TABLE' },
    }, res);
    expect(res.statusCode).toBe(400);
  });

  // Error tests run before success to avoid module-level cache interference.
  // The fr24-feed handler uses a persistent in-memory cache that survives across tests.

  it('returns 502 on upstream failure (cold cache)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 500,
    });

    const res = createRes();
    await handler({
      method: 'GET',
      headers: { origin: 'http://localhost:3000' },
      query: {},
    }, res);

    expect(res.statusCode).toBe(502);
  });

  it('returns 504 on timeout (cold cache)', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      Object.assign(new Error('timeout'), { name: 'AbortError' })
    );

    const res = createRes();
    await handler({
      method: 'GET',
      headers: { origin: 'http://localhost:3000' },
      query: {},
    }, res);

    expect(res.statusCode).toBe(504);
  });

  it('returns flight data on success', async () => {
    const mockData = { full_count: 500, version: 4, '2d5c8a': ['data'] };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => mockData,
    });

    const res = createRes();
    await handler({
      method: 'GET',
      headers: { origin: 'http://localhost:3000' },
      query: {},
    }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(mockData);
    expect(res.headers['Cache-Control']).toContain('s-maxage=15');
  });


  it('uses airline-specific cache keys to avoid cross-airline contamination', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const airline = new URL(url).searchParams.get('airline');
      return {
        ok: true,
        // Must contain at least one aircraft entry (array value) — meta-only bodies are
        // rejected as empty feeds since the Jul 3 2026 cold-load fix.
        json: async () => ({ airline, full_count: airline === 'DAL' ? 500 : 120, aabbcc: ['pos'] }),
      };
    });

    const resUAL = createRes();
    await handler({
      method: 'GET',
      headers: { origin: 'http://localhost:3000' },
      query: { airline: 'DAL' },
    }, resUAL);

    const resAAL = createRes();
    await handler({
      method: 'GET',
      headers: { origin: 'http://localhost:3000' },
      query: { airline: 'JBU' },
    }, resAAL);

    const resAALCached = createRes();
    await handler({
      method: 'GET',
      headers: { origin: 'http://localhost:3000' },
      query: { airline: 'JBU' },
    }, resAALCached);

    expect(resUAL.statusCode).toBe(200);
    expect(resUAL.body.airline).toBe('DAL');
    expect(resAAL.statusCode).toBe(200);
    expect(resAAL.body.airline).toBe('JBU');
    expect(resAALCached.body.airline).toBe('JBU');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('returns cached data on subsequent requests', async () => {
    const mockData = { full_count: 500, version: 4, '2d5c8a': ['data'] };
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => mockData,
    });

    const firstRes = createRes();
    await handler({
      method: 'GET',
      headers: { origin: 'http://localhost:3000' },
      query: { airline: 'UAL' },
    }, firstRes);

    const secondRes = createRes();
    await handler({
      method: 'GET',
      headers: { origin: 'http://localhost:3000' },
      query: { airline: 'UAL' },
    }, secondRes);

    expect(firstRes.statusCode).toBe(200);
    expect(secondRes.statusCode).toBe(200);
    expect(secondRes.body.full_count).toBe(500);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

// Jul 3 2026 audit: the upstream feed occasionally 200s with a meta-only body
// ({full_count, version}, zero aircraft arrays). Serving that as success wiped the client's
// map/boards into "NO DATA". The handler must surface it as a 503 and never cache it.
describe('fr24-feed empty-payload rejection', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 503 (no-store) when upstream 200s with a meta-only body', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ full_count: 22684, version: 4 }),
    });

    const res = createRes();
    await handler({
      method: 'GET',
      headers: { origin: 'http://localhost:3000' },
      query: { airline: 'SWA' }, // unique airline → cold cache regardless of test order
    }, res);

    expect(res.statusCode).toBe(503);
    expect(res.body.error).toMatch(/empty feed/i);
    expect(res.headers['Cache-Control']).toBe('no-store');
  });

  it('does not cache the empty body — next request refetches and succeeds', async () => {
    let call = 0;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => ({
      ok: true,
      json: async () => (++call === 1
        ? { full_count: 22684, version: 4 }
        : { full_count: 22684, version: 4, ddeeff: ['pos'] }),
    }));

    const first = createRes();
    await handler({
      method: 'GET',
      headers: { origin: 'http://localhost:3000' },
      query: { airline: 'ASA' },
    }, first);
    expect(first.statusCode).toBe(503);

    const second = createRes();
    await handler({
      method: 'GET',
      headers: { origin: 'http://localhost:3000' },
      query: { airline: 'ASA' },
    }, second);
    expect(second.statusCode).toBe(200);
    expect(second.body.ddeeff).toEqual(['pos']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('countFeedAircraft', () => {
  it('counts only array-valued entries', () => {
    expect(countFeedAircraft({ full_count: 5, version: 4, a1: ['x'], b2: ['y'] })).toBe(2);
    expect(countFeedAircraft({ full_count: 5, version: 4, stats: { total: 5 } })).toBe(0);
    expect(countFeedAircraft({ full_count: 22684, version: 4 })).toBe(0);
  });

  it('is 0 for null/undefined/non-object payloads', () => {
    expect(countFeedAircraft(null)).toBe(0);
    expect(countFeedAircraft(undefined)).toBe(0);
    expect(countFeedAircraft('nope')).toBe(0);
    expect(countFeedAircraft(42)).toBe(0);
  });
});
