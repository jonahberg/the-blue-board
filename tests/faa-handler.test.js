import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import handler from '../api/faa.js';

// Captured upstream shapes (nasstatus.faa.gov) — these fixtures model the rich JSON and the XML
// degradation payloads the inline mocks above omit, so an upstream field rename (incident #5 class)
// that silently zeroes a signal fails a test instead of shipping green.
function loadFixture(name) {
  return JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
}
function loadFixtureText(name) {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
}
const airportEventsRich = loadFixture('faa-airport-events.json');
const airportEventsMinimal = loadFixture('faa-airport-events-minimal.json');
const airportEventsPrograms = loadFixture('faa-airport-events-programs.json');
const airportStatusXml = loadFixtureText('faa-airport-status.xml');

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
    ...overrides,
  };
}

// Minimal valid JSON API response (nasstatus.faa.gov/api/airport-events)
function mockJsonResponse(airports = []) {
  return {
    ok: true,
    json: async () => airports,
  };
}

// Minimal valid XML API response (nasstatus.faa.gov/api/airport-status-information)
function mockXmlResponse(xml = '<AIRPORT_STATUS_INFORMATION></AIRPORT_STATUS_INFORMATION>') {
  return {
    ok: true,
    text: async () => xml,
  };
}

describe('FAA handler', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects non-GET methods', async () => {
    const res = createRes();
    await handler(makeReq({ method: 'POST' }), res);
    expect(res.statusCode).toBe(405);
  });

  it('rejects forbidden origins', async () => {
    const res = createRes();
    await handler(makeReq({ headers: { origin: 'https://evil.com' } }), res);
    expect(res.statusCode).toBe(403);
  });

  it('allows theblueboard.co origin', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockJsonResponse([]));
    const res = createRes();
    await handler(makeReq({ headers: { origin: 'https://theblueboard.co' } }), res);
    expect(res.statusCode).toBe(200);
  });

  it('returns parsed airports from JSON primary', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockJsonResponse([
      {
        airportId: 'EWR',
        groundDelay: {
          impactingCondition: 'Wind',
          avgDelay: 30,
          maxDelay: 45,
        },
      },
    ]));

    const res = createRes();
    await handler(makeReq(), res);

    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(1);
    expect(res.body[0].airportCode).toBe('EWR');
    expect(res.body[0].groundDelay).toBe(true);
    expect(res.body[0].programs[0].type).toBe('ground_delay');
    expect(res.body[0].programs[0].avgDelay).toBe(30);
  });

  it('returns empty array when no airports have events', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockJsonResponse([]));

    const res = createRes();
    await handler(makeReq(), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('parses ground stop programs correctly', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockJsonResponse([
      {
        airportId: 'SFO',
        groundStop: {
          impactingCondition: 'Low Ceilings',
          endTime: '2026-04-04T15:00:00Z',
          probabilityOfExtension: 'Low',
        },
      },
    ]));

    const res = createRes();
    await handler(makeReq(), res);

    expect(res.statusCode).toBe(200);
    expect(res.body[0].groundStop).toBe(true);
    expect(res.body[0].programs[0].type).toBe('ground_stop');
    expect(res.body[0].programs[0].reason).toBe('Low Ceilings');
  });

  it('sets appropriate cache headers', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockJsonResponse([]));

    const res = createRes();
    await handler(makeReq(), res);

    expect(res.headers['Cache-Control']).toMatch(/s-maxage=300/);
  });

  it('parses the rich airport-events fixture: ground/departure delays, config, notam', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockJsonResponse(airportEventsRich));

    const res = createRes();
    await handler(makeReq(), res);

    expect(res.statusCode).toBe(200);
    const byCode = Object.fromEntries(res.body.map((a) => [a.airportCode, a]));
    expect(res.body.length).toBe(6);

    // Ground Delay Program (LGA): worst avg/max aggregated from the numeric JSON fields
    const lga = byCode.LGA;
    expect(lga.groundDelay).toBe(true);
    expect(lga.programs[0].type).toBe('ground_delay');
    expect(lga.avgDelay).toBe(18);
    expect(lga.maxDelay).toBe(54);
    expect(lga.runwayConfig.arrivalRate).toBe(25);

    // Departure Delay (RSW): "31 minutes"/"45 minutes"/"30" strings decoded to minutes
    const rsw = byCode.RSW;
    expect(rsw.departureDelay).toBe(true);
    expect(rsw.programs[0].type).toBe('departure_delay');
    expect(rsw.avgDelay).toBe(30);
    expect(rsw.minDelay).toBe(31);
    expect(rsw.maxDelay).toBe(45);
    expect(rsw.programs[0].trend).toBe('Increasing');

    // Config + NOTAM only, no active program (LAS): freeForm decoded, arrivalRate carried
    const las = byCode.LAS;
    expect(las.programs.length).toBe(0);
    expect(las.groundDelay).toBe(false);
    expect(las.runwayConfig.arrivalRate).toBe(56);
    expect(las.notam).toContain('NON SKED');
  });

  it('parses the minimal airport-events fixture: ground stop, config, de-icing', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockJsonResponse(airportEventsMinimal));

    const res = createRes();
    await handler(makeReq(), res);

    expect(res.statusCode).toBe(200);
    const byCode = Object.fromEntries(res.body.map((a) => [a.airportCode, a]));

    const ewr = byCode.EWR;
    expect(ewr.groundStop).toBe(true);
    expect(ewr.programs[0].type).toBe('ground_stop');
    expect(ewr.programs[0].reason).toBe('weather');
    expect(ewr.programs[0].probabilityOfExtension).toBe('HIGH');

    const ord = byCode.ORD;
    expect(ord.deicing).toBe(true);
    expect(ord.runwayConfig.arrivalRate).toBe(76);
    expect(ord.runwayConfig.arrivalRunways).toBe('10L/10C');
    expect(ord.groundStop).toBe(false);
  });

  it('parses the closure and arrival-delay branches (the disruption-floor signals)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockJsonResponse(airportEventsPrograms));

    const res = createRes();
    await handler(makeReq(), res);

    expect(res.statusCode).toBe(200);
    const byCode = Object.fromEntries(res.body.map((a) => [a.airportCode, a]));

    // Airport Closure (DCA): drives computeHubDisruptionMinutes' floor-60 — must not silently die
    const dca = byCode.DCA;
    expect(dca.closure).toBe(true);
    expect(dca.programs[0].type).toBe('closure');
    expect(dca.programs[0].reason).toBe('snow and ice removal');

    // Arrival Delay (BOS): min/max from arrivalDeparture, trend carried
    const bos = byCode.BOS;
    expect(bos.arrivalDelay).toBe(true);
    expect(bos.programs[0].type).toBe('arrival_delay');
    expect(bos.minDelay).toBe(16);
    expect(bos.maxDelay).toBe(30);
    expect(bos.programs[0].trend).toBe('Increasing');
  });

  // --- Tests below mutate module-level jsonFailCount backoff state ---

  it('falls back to XML when JSON primary fails', async () => {
    let callCount = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      callCount++;
      if (String(url).includes('airport-events')) {
        // JSON primary fails
        return { ok: false, status: 503 };
      }
      // XML fallback succeeds with empty data
      return mockXmlResponse('<AIRPORT_STATUS_INFORMATION></AIRPORT_STATUS_INFORMATION>');
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const res = createRes();
    await handler(makeReq(), res);

    expect(res.statusCode).toBe(200);
    expect(callCount).toBe(2); // JSON + XML
    warnSpy.mockRestore();
  });

  it('returns 502 when both JSON and XML fail', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 500 });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const res = createRes();
    await handler(makeReq(), res);

    expect(res.statusCode).toBe(502);
    warnSpy.mockRestore();
  });

  it('returns 504 on timeout', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      Object.assign(new Error('aborted'), { name: 'AbortError' })
    );
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = createRes();
    await handler(makeReq(), res);

    expect(res.statusCode).toBe(504);
    errSpy.mockRestore();
  });

  it('parses a populated XML fallback document (JSON primary down)', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('airport-events')) return { ok: false, status: 503 };
      return mockXmlResponse(airportStatusXml);
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const res = createRes();
    await handler(makeReq(), res);

    expect(res.statusCode).toBe(200);
    const byCode = Object.fromEntries(res.body.map((a) => [a.airportCode, a]));

    // Ground Delay: "5 hours and 45 minutes" / "6 hours" decoded via the XML root path
    const ord = byCode.ORD;
    expect(ord.groundDelay).toBe(true);
    expect(ord.avgDelay).toBe(345);
    expect(ord.maxDelay).toBe(360);

    // Ground Stop (single Delay element → toArray object-wrapping branch)
    const sfo = byCode.SFO;
    expect(sfo.groundStop).toBe(true);
    expect(sfo.programs[0].reason).toBe('LOW CEILINGS');

    // Arrival_Departure_Delay whose Reason contains 'depart' → departure_delay
    const ewr = byCode.EWR;
    expect(ewr.departureDelay).toBe(true);
    expect(ewr.minDelay).toBe(16);
    expect(ewr.maxDelay).toBe(30);

    // Airport Closure: reason truncated to first 8 words
    const dca = byCode.DCA;
    expect(dca.closure).toBe(true);
    expect(dca.programs[0].reason).toBe('Runway closed for snow and ice removal operations');

    warnSpy.mockRestore();
  });
});
