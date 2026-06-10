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

import { computeTsaFeedDown } from '../api/tsa.js';

describe('computeTsaFeedDown', () => {
  const liveHub = { standardWait: 15, precheckWait: 5, lastUpdated: '2026-06-10T12:00:00Z', reports: [{ wait: 15, precheck: false, created: '2026-06-10T12:00:00Z' }] };
  const deadHub = { standardWait: null, precheckWait: null, lastUpdated: null, reports: [] };

  it('is true when every hub is empty (the decommissioned-upstream signature)', () => {
    expect(computeTsaFeedDown({ ORD: deadHub, DEN: deadHub, IAH: deadHub })).toBe(true);
  });

  it('is true for an empty hub set', () => {
    expect(computeTsaFeedDown({})).toBe(true);
  });

  it('is false when at least one hub has real wait data', () => {
    expect(computeTsaFeedDown({ ORD: deadHub, DEN: liveHub })).toBe(false);
  });

  it('is false when a hub has reports even if the latest wait is null', () => {
    const reportedHub = { standardWait: null, precheckWait: null, lastUpdated: '2026-06-10T12:00:00Z', reports: [{ wait: 0, precheck: false, created: '2026-06-10T12:00:00Z' }] };
    expect(computeTsaFeedDown({ ORD: reportedHub })).toBe(false);
  });
});

describe('TSA API', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('flags feedDown when the live response has wait data for at least one hub (regression: was always absent)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => mockTsaApiResponse(2),
    });
    const res = createRes();
    await handler(makeReq({ headers: { origin: 'https://theblueboard.co' } }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('feedDown');
    expect(typeof res.body.feedDown).toBe('boolean');
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
