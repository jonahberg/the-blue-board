import { describe, it, expect, vi, beforeEach } from 'vitest';
import handler, { _resetCacheForTest } from '../api/starlink-mismatches.js';

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

// Mirrors a plausible live upstream: a `summary` block + a `disputed` array with mixed casing on
// operator/type and an epoch-seconds verifiedAt. verified_as is sometimes Thales, not only Viasat.
function mockUpstreamResponse() {
  return {
    summary: { verifiedStarlink: 397, disputed: 2, unverified: 5, totalPlanes: 1781, generatedAt: '2026-06-14T00:00:00Z' },
    disputed: [
      { tail: 'n127sy', aircraft: 'Bombardier CRJ-550', operator: 'Skywest dba UAX', verifiedAs: 'Viasat', verifiedAt: 1780270800, dateFound: '2026-01-15' },
      { tail: 'N830UA', aircraft: 'Boeing 737-824', operator: 'United Airlines', verifiedAs: 'Thales', verifiedAt: '2026-03-02T12:00:00Z', dateFound: '2026-02-01' },
    ],
  };
}

describe('starlink-mismatches API', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    _resetCacheForTest();
  });

  it('rejects non-GET requests', async () => {
    const res = createRes();
    await handler(makeReq({ method: 'POST' }), res);
    expect(res.statusCode).toBe(405);
  });

  it('rejects a disallowed origin', async () => {
    const res = createRes();
    await handler(makeReq({ headers: { origin: 'https://evil.example' } }), res);
    expect(res.statusCode).toBe(403);
  });

  it('returns 502 on upstream connection failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
    const res = createRes();
    await handler(makeReq(), res);
    expect(res.statusCode).toBe(502);
    expect(res.body.error).toMatch(/unavailable/);
  });

  it('forwards upstream non-2xx status', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 503 });
    const res = createRes();
    await handler(makeReq(), res);
    expect(res.statusCode).toBe(503);
  });

  it('adapts the upstream ledger into summary + normalized disputed rows', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => mockUpstreamResponse(),
    });
    const res = createRes();
    await handler(makeReq(), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.summary.verifiedStarlink).toBe(397);
    expect(res.body.summary.disputed).toBe(2);
    expect(res.body.summary.unverified).toBe(5);
    expect(res.body.summary.totalPlanes).toBe(1781);

    expect(res.body.disputed).toHaveLength(2);
    const [a, b] = res.body.disputed;
    // tail upper-cased so it can be set-compared against the served STARLINK_TAILS
    expect(a.tail).toBe('N127SY');
    // type + operator normalized via the shared starlink normalizer
    expect(a.aircraft).toBe('CRJ-550');
    expect(a.operator).toBe('SkyWest dba UAX');
    // epoch-seconds verifiedAt promoted to ISO
    expect(a.verifiedAt).toBe(new Date(1780270800 * 1000).toISOString());
    // verified_as carries Thales, not only Viasat
    expect(b.verifiedAs).toBe('Thales');
    expect(b.aircraft).toBe('737-800');
  });

  it('degrades to an empty ledger when fields are missing rather than throwing', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
    const res = createRes();
    await handler(makeReq(), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.disputed).toEqual([]);
    expect(res.body.summary.verifiedStarlink).toBe(0);
    expect(res.body.summary.disputed).toBe(0);
    expect(typeof res.body.summary.generatedAt).toBe('string');
  });

  it('tolerates an alternate `mismatches` array key and partial rows', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ mismatches: [{ TailNumber: 'N999XY' }, { tail: '' }] }),
    });
    const res = createRes();
    await handler(makeReq(), res);

    expect(res.statusCode).toBe(200);
    // blank tail is dropped; the partial row defaults its other fields
    expect(res.body.disputed).toHaveLength(1);
    expect(res.body.disputed[0].tail).toBe('N999XY');
    expect(res.body.disputed[0].verifiedAs).toBe('Not Starlink');
    expect(res.body.summary.disputed).toBe(1);
  });

  it('serves a cached result without a second upstream fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => mockUpstreamResponse(),
    });

    await handler(makeReq(), createRes());
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const res2 = createRes();
    await handler(makeReq(), res2);
    expect(res2.statusCode).toBe(200);
    expect(res2.body.disputed).toHaveLength(2);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(res2.headers['Cache-Control']).toMatch(/s-maxage=2700/);
  });

  it('short-circuits to 502 inside the negative-cache window', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));

    await handler(makeReq(), createRes());
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const res2 = createRes();
    await handler(makeReq(), res2);
    expect(res2.statusCode).toBe(502);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('sends the correct User-Agent header to upstream', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => mockUpstreamResponse(),
    });
    await handler(makeReq(), createRes());
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/api/mismatches'),
      expect.objectContaining({
        headers: { 'User-Agent': 'BlueBoard-StarlinkMismatches/1.0' },
      })
    );
  });
});
