import { describe, it, expect, vi, beforeEach } from 'vitest';
import handler from '../api/tsa.js';

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
    headers: { origin: 'http://localhost:3000' },
    query: {},
    ...overrides,
  };
}

// Build a mock TSA API response for a single airport
function mockTsaApiResponse(waitTime, createdDatetime = '2026-04-03T12:00:00') {
  return [{ Wait_Time: waitTime, Created_Datetime: createdDatetime, Airport_Code: 'ORD' }];
}

describe('TSA API', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // --- Validation tests (no fetch needed) ---

  it('rejects non-GET requests', async () => {
    const res = createRes();
    await handler(makeReq({ method: 'POST' }), res);
    expect(res.statusCode).toBe(405);
  });

  it('rejects forbidden origins', async () => {
    const res = createRes();
    await handler(makeReq({ headers: { origin: 'https://evil.com' } }), res);
    expect(res.statusCode).toBe(403);
  });

  // --- Fetch-dependent tests run in specific order to avoid module-level cache interference ---
  // The TSA handler uses a persistent CacheStore that survives across tests.
  // Tests that need specific fetch responses must run before cache gets populated.

  it('filters invalid wait time entries from TSA response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => [
        { Wait_Time: 2, Created_Datetime: '2026-04-03T12:00:00' },
        { Wait_Time: -1, Created_Datetime: '2026-04-03T11:00:00' }, // negative
        { Wait_Time: 'invalid', Created_Datetime: '2026-04-03T10:00:00' }, // not integer
        null, // null entry
      ],
    });

    const res = createRes();
    await handler(makeReq(), res);

    expect(res.statusCode).toBe(200);
    // Only valid entry should be included in reports
    expect(res.body.hubs.ORD.standardWait).toBe(15); // bucket 2 = 15 min
  });

  // --- Success tests (populate cache) ---

  it('allows theblueboard.co origin', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => mockTsaApiResponse(2),
    });
    const res = createRes();
    await handler(makeReq({ headers: { origin: 'https://theblueboard.co' } }), res);
    expect(res.statusCode).toBe(200);
  });

  it('returns data for all 7 United hubs', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => mockTsaApiResponse(1),
    });

    const res = createRes();
    await handler(makeReq(), res);

    expect(res.statusCode).toBe(200);
    const hubs = Object.keys(res.body.hubs);
    expect(hubs).toEqual(expect.arrayContaining(['ORD', 'DEN', 'IAH', 'EWR', 'SFO', 'IAD', 'LAX']));
    expect(hubs).toHaveLength(7);
    expect(res.body.lastRefreshed).toBeDefined();
  });

  it('sets cache headers', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => [],
    });

    const res = createRes();
    await handler(makeReq(), res);

    expect(res.statusCode).toBe(200);
    expect(res.headers['Cache-Control']).toBe('s-maxage=60, stale-while-revalidate=300');
  });
});
