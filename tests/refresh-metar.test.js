import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import handler from '../api/cron/refresh-metar.js';
import { collectMetarStations } from '../src/lib/weather-cards.js';

const HUB_ICAOS = 'KEWR,KIAH,KORD,KDEN,KSFO,KLAX,KIAD,RJAA,PGUM';

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

describe('refresh-metar cron', () => {
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

  it('calls /api/metar and returns the station count on success', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => [{ icaoId: 'KORD' }, { icaoId: 'KDEN' }, { icaoId: 'KEWR' }],
    });

    const res = createRes();
    await handler(makeReq(), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.stations).toBe(3);
  });

  it('returns 502 when /api/metar responds with an error', async () => {
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

  it('returns 500 on a generic error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('DNS failure'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = createRes();
    await handler(makeReq(), res);

    expect(res.statusCode).toBe(500);
    spy.mockRestore();
  });

  it('warms exactly the hub request the client makes on page load (same ids, same order)', async () => {
    // With no watched flights and no boards loaded, the client's first /api/metar chunk is
    // the nine hubs in collectMetarStations order — the only request the CDN warm can match.
    const pageLoad = collectMetarStations({ getStation: () => '' }).stations.join(',');
    expect(pageLoad).toBe(HUB_ICAOS);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => [] });
    await handler(makeReq(), createRes());
    expect(String(globalThis.fetch.mock.calls[0][0])).toMatch(new RegExp(`ids=${pageLoad}$`));
  });

  it('names the stations the warm did not get back', async () => {
    const all = HUB_ICAOS.split(',');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => all.filter((id) => id !== 'RJAA').map((icaoId) => ({ icaoId })),
    });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = createRes();
    await handler(makeReq(), res);
    expect(res.body).toEqual({ ok: true, stations: 8, missing: ['RJAA'] });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('missing RJAA'));
    log.mockRestore();
  });

  it('requests the full hub ICAO list with the production origin header', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => [],
    });

    const res = createRes();
    await handler(makeReq(), res);

    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining(`ids=${HUB_ICAOS}`),
      // Accept: application/json — the client's variant under /api/metar's Vary: Accept.
      expect.objectContaining({ headers: { origin: 'https://theblueboard.co', Accept: 'application/json' } })
    );
  });

  it('uses production URL when VERCEL_PROJECT_PRODUCTION_URL is set', async () => {
    vi.stubEnv('VERCEL_PROJECT_PRODUCTION_URL', 'theblueboard.co');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => [],
    });

    const res = createRes();
    await handler(makeReq(), res);

    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('https://theblueboard.co/api/metar'),
      expect.anything()
    );
  });
});
