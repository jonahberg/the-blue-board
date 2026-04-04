import { describe, it, expect, vi, beforeEach } from 'vitest';
import handler from '../api/nas.js';

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

describe('NAS API', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

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

  it('allows requests from theblueboard.co', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => [],
    });
    const res = createRes();
    await handler(makeReq({ headers: { origin: 'https://theblueboard.co' } }), res);
    expect(res.statusCode).toBe(200);
  });

  it('allows requests with no origin header', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => [],
    });
    const res = createRes();
    await handler(makeReq({ headers: {} }), res);
    expect(res.statusCode).toBe(200);
  });

  it('returns empty arrays when both FAA APIs fail', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));
    const res = createRes();
    await handler(makeReq(), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.active).toEqual([]);
    expect(res.body.planned).toEqual([]);
    expect(res.body.advisoryUrl).toBe(null);
  });

  it('parses enroute events with airspace flow programs', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('enroute-events')) {
        return {
          ok: true,
          json: async () => [{
            airspaceFlowProgram: {
              afpName: 'EWR-AFP',
              impactingCondition: 'Weather / Thunderstorms',
              avgDelay: 18.7,
              startTime: '2026-04-03T14:00:00Z',
              endTime: '2026-04-03T20:00:00Z',
            },
            departsAny: 'ORD,DEN',
            arrivesAny: ['EWR'],
          }],
        };
      }
      return {
        ok: true,
        json: async () => ({ terminalPlanned: [], enRoutePlanned: [] }),
      };
    });

    const res = createRes();
    await handler(makeReq(), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.active).toHaveLength(1);
    expect(res.body.active[0]).toEqual({
      name: 'EWR-AFP',
      reason: 'Weather / Thunderstorms',
      avgDelay: 19, // 18.7 rounded
      startTime: '2026-04-03T14:00:00Z',
      endTime: '2026-04-03T20:00:00Z',
      affectedFacilities: ['ORD', 'DEN', 'EWR'],
    });
  });

  it('handles missing/null avgDelay gracefully', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('enroute-events')) {
        return {
          ok: true,
          json: async () => [{
            airspaceFlowProgram: {
              afpName: 'TEST-AFP',
              impactingCondition: 'Volume',
              avgDelay: null,
              startTime: '',
              endTime: '',
            },
            departsAny: '',
            arrivesAny: '',
          }],
        };
      }
      return { ok: true, json: async () => ({}) };
    });

    const res = createRes();
    await handler(makeReq(), res);
    expect(res.body.active[0].avgDelay).toBe(null);
    expect(res.body.active[0].affectedFacilities).toEqual([]);
  });

  it('parses operations plan with terminal and enroute planned events', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('operations-plan')) {
        return {
          ok: true,
          json: async () => ({
            link: 'https://nasstatus.faa.gov/advisory',
            terminalPlanned: [
              { time: '1400Z', event: '- GDP EWR' },
            ],
            enRoutePlanned: [
              { time: '1500Z', event: '- MIT ZNY 20' },
            ],
          }),
        };
      }
      return { ok: true, json: async () => [] };
    });

    const res = createRes();
    await handler(makeReq(), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.advisoryUrl).toBe('https://nasstatus.faa.gov/advisory');
    expect(res.body.planned).toHaveLength(2);

    // Terminal event: GDP decoded
    expect(res.body.planned[0].type).toBe('terminal');
    expect(res.body.planned[0].decoded).toContain('Ground Delay Program');
    expect(res.body.planned[0].affectedAirports).toContain('EWR');

    // Enroute event: MIT decoded
    expect(res.body.planned[1].type).toBe('enroute');
    expect(res.body.planned[1].decoded).toContain('Miles-in-Trail');
  });

  it('filters common abbreviations from airport code extraction', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('operations-plan')) {
        return {
          ok: true,
          json: async () => ({
            terminalPlanned: [
              // "AND", "FOR", "ALL", "AFP" should be excluded; "ORD" and "LAX" kept
              { time: '1200Z', event: 'AFP FOR ALL ORD AND LAX' },
            ],
          }),
        };
      }
      return { ok: true, json: async () => [] };
    });

    const res = createRes();
    await handler(makeReq(), res);
    expect(res.body.planned[0].affectedAirports).toEqual(['ORD', 'LAX']);
  });

  it('rejects non-https advisory URLs', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('operations-plan')) {
        return {
          ok: true,
          json: async () => ({ link: 'javascript:alert(1)', terminalPlanned: [] }),
        };
      }
      return { ok: true, json: async () => [] };
    });

    const res = createRes();
    await handler(makeReq(), res);
    expect(res.body.advisoryUrl).toBe(null);
  });

  it('handles partial FAA API failure (enroute fails, plan succeeds)', async () => {
    let callCount = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('enroute-events')) {
        throw new Error('HTTP 500');
      }
      return {
        ok: true,
        json: async () => ({
          terminalPlanned: [{ time: '1300Z', event: 'GS SFO' }],
        }),
      };
    });

    const res = createRes();
    await handler(makeReq(), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.active).toEqual([]);
    expect(res.body.planned).toHaveLength(1);
    expect(res.body.planned[0].decoded).toContain('Ground Stop');
  });

  it('skips enroute items without airspaceFlowProgram', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('enroute-events')) {
        return {
          ok: true,
          json: async () => [
            { someOtherField: 'not an AFP' },
            { airspaceFlowProgram: { afpName: 'Valid-AFP', impactingCondition: 'Weather' } },
            { airspaceFlowProgram: { afpName: '', impactingCondition: 'Empty name' } },
          ],
        };
      }
      return { ok: true, json: async () => ({}) };
    });

    const res = createRes();
    await handler(makeReq(), res);
    // Only the one with valid name should be included
    expect(res.body.active).toHaveLength(1);
    expect(res.body.active[0].name).toBe('Valid-AFP');
  });

  it('sets correct cache headers', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => [],
    });
    const res = createRes();
    await handler(makeReq(), res);
    expect(res.headers['Cache-Control']).toBe('s-maxage=300, stale-while-revalidate=600');
    expect(res.headers['Content-Type']).toBe('application/json');
  });
});
