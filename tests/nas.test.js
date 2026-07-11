import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import handler from '../api/nas.js';

// Captured upstream shapes (nasstatus.faa.gov) — richer than the inline mocks, so an upstream
// field rename that silently zeroes an enroute program or advisory fails a test instead of shipping green.
function loadFixture(name) {
  return JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
}
const enrouteEventsFixture = loadFixture('faa-enroute-events.json');
const operationsPlanFixture = loadFixture('faa-operations-plan.json');

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

  it('parses the captured enroute-events fixture: six airspace flow programs', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('enroute-events')) {
        return { ok: true, json: async () => enrouteEventsFixture };
      }
      return { ok: true, json: async () => ({ terminalPlanned: [], enRoutePlanned: [] }) };
    });

    const res = createRes();
    await handler(makeReq(), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.active).toHaveLength(6);
    expect(res.body.active.map((p) => p.name)).toEqual([
      'FCAMUN', 'FCAPV2', 'FCAPV3', 'FCASD1', 'FCAMA5', 'FCAJX1',
    ]);

    const byName = Object.fromEntries(res.body.active.map((p) => [p.name, p]));

    // avgDelay rounded from the float upstream fields
    expect(byName.FCAMUN.avgDelay).toBe(99); // 99.30
    expect(byName.FCAPV3.avgDelay).toBe(224); // 224.10
    expect(byName.FCAMA5.avgDelay).toBe(122); // 121.90

    // Only departsAny/arrivesAny feed affectedFacilities; arrivesNone is ignored
    expect(byName.FCAMUN.affectedFacilities).toEqual(['MMUN']);
    expect(byName.FCASD1.affectedFacilities).toEqual(['MMSD']);
    expect(byName.FCAMA5.affectedFacilities).toEqual([]); // arrivesNone MBPV not counted

    // reason + scope carried verbatim
    expect(byName.FCAMUN.reason).toBe('airport volume');
    expect(byName.FCAJX1.reason).toBe('airspace volume');
    expect(byName.FCASD1.startTime).toBe('2026-03-28T17:00:00Z');
    expect(byName.FCASD1.endTime).toBe('2026-03-28T21:59:00Z');
  });

  it('parses the captured operations-plan fixture: enroute CDRS/SWAP advisory', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('operations-plan')) {
        return { ok: true, json: async () => operationsPlanFixture };
      }
      return { ok: true, json: async () => [] };
    });

    const res = createRes();
    await handler(makeReq(), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.advisoryUrl).toBe(operationsPlanFixture.link);
    expect(res.body.advisoryUrl.startsWith('https://')).toBe(true);
    expect(res.body.planned).toHaveLength(1);

    const [tmi] = res.body.planned;
    expect(tmi.type).toBe('enroute');
    expect(tmi.time).toBe('AFTER 1800');
    expect(tmi.event).toBe('SOUTH FLORIDA CDRS/SWAP POSSIBLE'); // leading dash stripped
    expect(tmi.decoded).toContain('Coded Departure Routes');
    expect(tmi.decoded).toContain('Severe Weather Avoidance');
    expect(tmi.affectedAirports).toEqual([]); // spelled-out region, no bare 3-letter codes
  });
});
