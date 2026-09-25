import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

// Mirrors the live upstream: totalCount is the WHOLE tracked fleet (not the Starlink count),
// fleetStats has no `combined`, departure_time is a UNIX-seconds integer, operator/type casing
// is inconsistent. Sized to the live equipped count (513 on 2026-08-11) so it clears the §05
// absolute floor; the two hand-written aircraft stay at indexes 0 and 1 for the normalisation
// assertions, and fleetStats (170 mainline + 343 express) sums to the record count.
function mockUpstreamResponse() {
  const starlinkPlanes = [
    { TailNumber: 'N37559', fleet: 'mainline', Aircraft: 'Boeing 737-824', OperatedBy: 'United Airlines', DateFound: '2020-01-01', WiFi: 'Starlink' },
    { TailNumber: 'N77296', fleet: 'express', Aircraft: 'Bombardier CRJ-550', OperatedBy: 'Skywest dba UAX', DateFound: '2020-01-01', WiFi: 'StrLnk' },
  ];
  while (starlinkPlanes.length < 513) {
    const i = starlinkPlanes.length;
    starlinkPlanes.push({
      TailNumber: i === 2 ? 'N76265' : `N${20000 + i}`,
      fleet: i < 170 ? 'mainline' : 'express',
      Aircraft: 'Boeing 737-824',
      OperatedBy: 'United Airlines',
      DateFound: '2020-01-01',
      WiFi: 'Starlink',
    });
  }
  return {
    starlinkPlanes,
    totalCount: 1781,
    fleetStats: {
      mainline: { starlink: 170, total: 1122 },
      express: { starlink: 343, total: 659 },
    },
    flightsByTail: {
      N37559: [
        { flight_number: 'UA1234', departure_airport: 'ORD', arrival_airport: 'LAX', departure_time: 1780270800, arrival_time: 1780280100, airline: 'UA' },
      ],
    },
    lastUpdated: new Date().toISOString(),
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

  // --- Degraded paths (must run before any successful fetch populates inMemoryCache) ---
  // With no in-memory or Supabase cache, the endpoint serves the committed static file rather
  // than erroring, so the board never goes blank when upstream is down.

  it('serves the static fallback when upstream fails and no cache exists', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('upstream down'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = createRes();
    await handler(makeReq(), res);

    expect(res.statusCode).toBe(200);
    expect(res.headers['X-Starlink-Source']).toBe('static');
    expect(Array.isArray(res.body.aircraft)).toBe(true);
    expect(res.body.aircraft.length).toBeGreaterThan(0);
    expect(res.body.totalCount).toBe(res.body.aircraft.length);
    spy.mockRestore();
  });

  it('serves the static fallback when upstream returns a non-ok status and no cache', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 503 });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = createRes();
    await handler(makeReq(), res);

    expect(res.statusCode).toBe(200);
    expect(res.headers['X-Starlink-Source']).toBe('static');
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
    expect(res.headers['X-Starlink-Source']).toBe('upstream');
    expect(res.body.aircraft).toHaveLength(513);
    expect(res.body.aircraft[0].tail).toBe('N37559');
    expect(res.body.aircraft[0].fleet).toBe('Mainline');
    expect(res.body.aircraft[1].fleet).toBe('Express');
    // Type + operator normalisation
    expect(res.body.aircraft[0].type).toBe('737-800');   // from "Boeing 737-824"
    expect(res.body.aircraft[1].type).toBe('CRJ-550');   // from "Bombardier CRJ-550"
    expect(res.body.aircraft[1].operator).toBe('SkyWest dba UAX'); // from "Skywest dba UAX"
    expect(res.body.fleetStats.mainline).toBe(170);
    expect(res.body.fleetStats.express).toBe(343);
    // The headline fix: serve the real Starlink count, NOT upstream.totalCount (1781 = whole fleet)
    expect(res.body.totalCount).toBe(513);
    expect(res.body.totalCount).not.toBe(1781);

    // Verify flight normalization: epoch → ISO string + numeric ts
    const flights = res.body.flightsByTail.N37559;
    expect(flights).toHaveLength(1);
    expect(flights[0].origin).toBe('ORD');
    expect(flights[0].destination).toBe('LAX');
    expect(flights[0].departure_ts).toBe(1780270800);
    expect(flights[0].departure_time).toBe(new Date(1780270800 * 1000).toISOString());
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

// The durable Supabase snapshot serving decision (fresh vs >6h stale) and the rate-limit degrade
// branches never run under the tests above — in that env loadStarlinkSnapshot always returns null.
// These tests mock the snapshot module and reset the handler's module-level state (inMemoryCache,
// the shared rate limiter) per test via resetModules, so each snapshot/rate-limit branch is exercised.
describe('starlink-data API — Supabase snapshot + rate-limit branches', () => {
  let handler;
  let loadStarlinkSnapshot;

  function snapshotPayload() {
    return {
      aircraft: [{ tail: 'N100', fleet: 'Mainline', type: '737-800', operator: 'United Airlines', dateFound: '', wifi: 'Starlink' }],
      totalCount: 1,
      fleetStats: null,
      flightsByTail: {},
      lastUpdated: '',
      syncedAt: '2026-05-31T00:00:00.000Z',
    };
  }

  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.resetModules();
    delete (globalThis).__starlinkCache;
    vi.doMock('../api/_starlink-snapshot.js', () => ({ loadStarlinkSnapshot: vi.fn() }));
    ({ default: handler } = await import('../api/starlink-data.js'));
    ({ loadStarlinkSnapshot } = await import('../api/_starlink-snapshot.js'));
  });

  afterEach(() => {
    vi.doUnmock('../api/_starlink-snapshot.js');
    vi.resetModules();
  });

  it('serves a fresh snapshot directly (source "supabase") without hitting upstream', async () => {
    loadStarlinkSnapshot.mockResolvedValue({ refreshedAt: Date.now(), data: snapshotPayload() });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => mockUpstreamResponse() });

    const res = createRes();
    await handler(makeReq(), res);

    expect(res.statusCode).toBe(200);
    expect(res.headers['X-Starlink-Source']).toBe('supabase');
    expect(res.body.aircraft).toHaveLength(2);
    expect(res.body.aircraft.some((a) => a.tail === 'N76265')).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('falls through to upstream when the snapshot is older than the 6h freshness window', async () => {
    loadStarlinkSnapshot.mockResolvedValue({ refreshedAt: Date.now() - 7 * 60 * 60 * 1000, data: snapshotPayload() });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => mockUpstreamResponse() });

    const res = createRes();
    await handler(makeReq(), res);

    expect(res.statusCode).toBe(200);
    expect(res.headers['X-Starlink-Source']).toBe('upstream');
    expect(res.body.aircraft).toHaveLength(513);
  });

  // §05 validators on the direct-fetch path: a structurally broken upstream 200 must not be
  // served just because it parsed. The stale snapshot is better data than a 10-aircraft board.
  it('rejects a structurally broken upstream 200 and degrades to the stale snapshot', async () => {
    loadStarlinkSnapshot.mockResolvedValue({ refreshedAt: Date.now() - 7 * 60 * 60 * 1000, data: snapshotPayload() });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const broken = mockUpstreamResponse();
    broken.starlinkPlanes = broken.starlinkPlanes.slice(0, 10);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => broken });

    const res = createRes();
    await handler(makeReq(), res);

    expect(res.statusCode).toBe(200);
    expect(res.headers['X-Starlink-Source']).toBe('supabase-stale');
    expect(res.body.aircraft).toHaveLength(2);
    expect(res.body.aircraft.some((a) => a.tail === 'N76265')).toBe(true);
    errSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('degrades to the stale snapshot ("supabase-stale") when the rate limiter trips', async () => {
    loadStarlinkSnapshot.mockResolvedValue({ refreshedAt: Date.now() - 7 * 60 * 60 * 1000, data: snapshotPayload() });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('upstream down'));

    // Exhaust the 30-request window. Each request reaches the limiter, tries upstream (which
    // throws), and degrades to the stale snapshot via the catch path.
    for (let i = 0; i < 30; i++) {
      const r = createRes();
      await handler(makeReq(), r);
      expect(r.headers['X-Starlink-Source']).toBe('supabase-stale');
    }
    expect(fetchSpy).toHaveBeenCalledTimes(30);

    // The 31st request is rate-limited: it must short-circuit to the stale snapshot BEFORE any
    // upstream fetch (proving the rate-limit branch, not the catch branch, served it).
    fetchSpy.mockClear();
    const res = createRes();
    await handler(makeReq(), res);
    expect(res.statusCode).toBe(200);
    expect(res.headers['X-Starlink-Source']).toBe('supabase-stale');
    expect(fetchSpy).not.toHaveBeenCalled();

    errSpy.mockRestore();
  });

  it('degrades to the static file ("static") under the rate limit when no snapshot exists', async () => {
    loadStarlinkSnapshot.mockResolvedValue(null);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('upstream down'));

    for (let i = 0; i < 30; i++) {
      const r = createRes();
      await handler(makeReq(), r);
      expect(r.headers['X-Starlink-Source']).toBe('static');
    }

    fetchSpy.mockClear();
    const res = createRes();
    await handler(makeReq(), res);
    expect(res.statusCode).toBe(200);
    expect(res.headers['X-Starlink-Source']).toBe('static');
    expect(fetchSpy).not.toHaveBeenCalled();

    errSpy.mockRestore();
  });
});
