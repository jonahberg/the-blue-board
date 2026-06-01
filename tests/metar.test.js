import { describe, it, expect, vi, beforeEach } from 'vitest';
import handler, { __resetMetarCacheForTests } from '../api/metar.js';

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

function ok(records) {
  return { ok: true, json: async () => ({ data: records }) };
}
function station(id, raw) {
  return { station_id: id, raw_text: raw || `METAR ${id} 182351Z 28005KT 10SM`, flight_category: 'vfr' };
}
const abortError = () => Object.assign(new Error('aborted'), { name: 'AbortError' });

describe('metar API', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    __resetMetarCacheForTests();
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

  it('rejects invalid airport IDs', async () => {
    const res = createRes();
    await handler({
      method: 'GET',
      headers: { origin: 'http://localhost:3000' },
      query: { ids: 'DROP TABLE' },
    }, res);
    expect(res.statusCode).toBe(400);
  });

  it('returns weather data on success', async () => {
    const mockData = {
      data: [{
        station_id: 'kord',
        raw_text: 'METAR KORD 182351Z 28005KT 10SM BKN250 06/M01 A3001',
        flight_category: 'vfr',
        visibility: '10+',
        wind_dir_degrees: '280',
        wind_speed_kt: '5',
        temperature_c: '6.1',
        sky_condition: [{ sky_cover: 'BKN', altitude_ft_agl: 25000 }],
      }],
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => mockData });

    const res = createRes();
    await handler({
      method: 'GET',
      headers: { origin: 'http://localhost:3000' },
      query: { ids: 'KORD' },
    }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject([{
      icaoId: 'KORD',
      stationId: 'KORD',
      id: 'KORD',
      rawOb: 'METAR KORD 182351Z 28005KT 10SM BKN250 06/M01 A3001',
      fltCat: 'VFR',
      visib: '10+',
      wdir: 280,
      wspd: 5,
      temp: 6.1,
      clouds: [{ cover: 'BKN', base: 25000 }],
    }]);
    expect(res.headers['Cache-Control']).toContain('s-maxage=300');
  });

  it('accepts comma-separated airport IDs', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const id = String(url).match(/ids=([A-Z]+)/)?.[1] || 'KORD';
      return ok([station(id)]);
    });

    const res = createRes();
    await handler({
      method: 'GET',
      headers: { origin: 'http://localhost:3000' },
      query: { ids: 'KORD,KDEN,KEWR' },
    }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.map((r) => r.icaoId).sort()).toEqual(['KDEN', 'KEWR', 'KORD']);
  });

  // ── Resilience: a slow/failed upstream must never blank the whole weather panel ──

  it('returns a partial 200 when one station times out but others succeed', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const id = String(url).match(/ids=([A-Z]+)/)?.[1] || '';
      if (id === 'KEWR') throw abortError(); // EWR upstream stalls past the per-station timeout
      return ok([station(id)]);
    });

    const res = createRes();
    await handler({
      method: 'GET',
      headers: { origin: 'http://localhost:3000' },
      query: { ids: 'KORD,KDEN,KEWR' },
    }, res);

    expect(res.statusCode).toBe(200); // NOT 504 — the panel stays up
    const ids = res.body.map((r) => r.icaoId);
    expect(ids).toContain('KORD');
    expect(ids).toContain('KDEN');
    expect(ids).not.toContain('KEWR'); // timed out, no prior obs -> omitted (hub shows placeholder)
    expect(res.body.length).toBe(2);
  });

  it('serves last-known-good for a station that fails after a prior success', async () => {
    // First request: KORD answers -> cached as last-known-good
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(ok([station('KORD', 'METAR KORD GOOD OBS')]));
    let res = createRes();
    await handler({ method: 'GET', headers: { origin: 'http://localhost:3000' }, query: { ids: 'KORD' } }, res);
    expect(res.body[0].rawOb).toBe('METAR KORD GOOD OBS');

    // Second request: KORD now times out -> served stale instead of vanishing
    vi.restoreAllMocks();
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(abortError());
    res = createRes();
    await handler({ method: 'GET', headers: { origin: 'http://localhost:3000' }, query: { ids: 'KORD' } }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].rawOb).toBe('METAR KORD GOOD OBS'); // stale, but present — no blackout
  });

  it('returns 200 with an empty array (not 502/504) when the only station fails with no cached obs', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 500 });
    const res = createRes();
    await handler({ method: 'GET', headers: { origin: 'http://localhost:3000' }, query: { ids: 'KORD' } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual([]); // dashboard degrades to its existing "weather unavailable" state
  });

  it('returns 200 (not 504) when a station times out with no cached obs', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(abortError());
    const res = createRes();
    await handler({ method: 'GET', headers: { origin: 'http://localhost:3000' }, query: { ids: 'KORD' } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual([]);
  });
});
