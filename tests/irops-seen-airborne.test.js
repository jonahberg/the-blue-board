// v1.12.0 — /api/irops scores boards with the seen-airborne override applied, using sightings it
// WAITS for (a cold lambda must not count every seen-flying Likely Canceled as a cancellation).
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sightingsMock = vi.hoisted(() => ({ map: new Map(), calls: 0 }));
vi.mock(process.cwd() + '/api/_reg-sightings.ts', () => ({
  awaitRegSightings: vi.fn(async () => { sightingsMock.calls++; return sightingsMock.map; }),
}));

import handler, { __resetIropsForTests } from '../api/irops.js';
import { __resetRateLimitersForTests } from '../api/_rate-limit.js';

function createRes() {
  return {
    statusCode: 200, headers: {}, body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

describe('/api/irops — seen-airborne override', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    __resetRateLimitersForTests();
    __resetIropsForTests();
    sightingsMock.calls = 0;
  });

  it('a Likely Canceled ORD departure the feed saw fly is not a cancellation; the unseen one is, and is reported as likely', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const schedDep = nowSec - 5 * 3600;
    const row = (ident, origin) => ({
      identification: { number: { default: ident } },
      airport: { origin: { code: { iata: origin } }, destination: { code: { iata: 'SFO' } } },
      status: { generic: { status: { text: 'canceled_uncertain' }, type: 'canceled_uncertain' }, text: 'canceleduncertain' },
      time: { scheduled: { departure: schedDep, arrival: schedDep + 4 * 3600 }, real: {}, estimated: {} },
    });
    sightingsMock.map = new Map([
      ['UA1094', { reg: 'N12345', origin: 'ORD', dest: 'SFO', seenAtMs: (schedDep + 3 * 3600) * 1000, airborneAtMs: (schedDep + 3 * 3600) * 1000 }],
      // Seen at ORD after its departure time, but only ever on the ground: still a likely cancellation.
      ['UA2000', { reg: 'N54321', origin: 'ORD', dest: 'SFO', seenAtMs: (schedDep + 1 * 3600) * 1000, airborneAtMs: null }],
    ]);
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const hub = new URL(String(url)).searchParams.get('hub');
      const flights = hub === 'ORD' ? [row('UA1094', 'ORD'), row('UA2000', 'ORD')] : [];
      return { ok: true, json: async () => ({ dir: 'departures', hub, flights, meta: { generatedAt: nowSec - 60 } }) };
    });
    const res = createRes();
    await handler({ method: 'GET', headers: {}, query: {} }, res);
    expect(res.statusCode).toBe(200);
    expect(sightingsMock.calls).toBe(1);
    expect(res.body.totalFlights).toBe(2);
    expect(res.body.cancellations).toBe(1);
    expect(res.body.cancellationsLikely).toBe(1);
    expect(res.body.likelyCanceledSeenFlying).toBe(1);
    expect(res.body.hubMetrics.ORD).toMatchObject({ cancellations: 1, cancellationsLikely: 1, likelyCanceledSeenFlying: 1 });
    expect(res.body.score).toBe(150); // (1×3)/2 — before v1.12.0: (2×3)/2 = 300
  });
});
