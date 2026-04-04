import { describe, it, expect, vi, beforeEach } from 'vitest';
import handler from '../api/faa.js';

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
});
