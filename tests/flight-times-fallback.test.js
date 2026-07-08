// Data-quality release (Jul 3 2026 audit) — #1 flight-times source chain:
// FlightAware's bot-wall serves a PARSEABLE trackpollBootstrap with zero flights; that must be
// treated as a source failure (→ FR24 → schedule-cache), never as "No active flight found".
// The FR24 tier is a paid official-API call and must respect the isOfficialFr24Enabled() kill
// switch (OFF in prod while credits are exhausted).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const snapshotMocks = vi.hoisted(() => ({
  loadScheduleSnapshot: vi.fn(async () => null),
  saveScheduleSnapshot: vi.fn(async () => {}),
  getSupabaseAdmin: vi.fn(async () => null),
}));

vi.mock(process.cwd() + '/api/_schedule-snapshots.ts', () => snapshotMocks);

import handler from '../api/flight-times.js';
import { getStartOfHubDay, getHubLocalDate } from '../src/lib/hubTz.js';
import { resetMirroredQuotaBlock } from '../api/_cost-state.js';

function createRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    end() { return this; },
    json(payload) { this.body = payload; return this; },
  };
}

// Distinct IPs keep each test clear of the 30 req/min per-IP limiter.
let reqCounter = 0;
function createReq(flight) {
  reqCounter++;
  return {
    method: 'GET',
    headers: { origin: 'http://localhost:3000', 'x-real-ip': `10.0.0.${reqCounter}` },
    query: { flight },
  };
}

function faHtml(bootstrap) {
  return `<html><script>var trackpollBootstrap = ${JSON.stringify(bootstrap)};var other = 1;</script></html>`;
}

const EMPTY_BOOTSTRAP = { flights: {} }; // the bot-wall shape: parses fine, zero flights

function populatedBootstrap(depEpoch) {
  return {
    flights: {
      'UAL111-1751500000-airline-0500': {
        activityLog: {
          flights: [{
            origin: { iata: 'ORD', friendlyName: "Chicago O'Hare Intl", TZ: ':America/Chicago', terminal: '1', gate: 'C18' },
            destination: { iata: 'SFO', friendlyName: 'San Francisco Intl', TZ: ':America/Los_Angeles', terminal: '3', gate: 'F11' },
            gateDepartureTimes: { scheduled: depEpoch, estimated: depEpoch + 300, actual: null },
            takeoffTimes: { scheduled: depEpoch + 900, estimated: depEpoch + 1200, actual: null },
            landingTimes: {}, gateArrivalTimes: {},
            aircraftTypeFriendly: 'Boeing 737 MAX 9', flightStatus: 'scheduled', cancelled: false, diverted: false,
          }],
        },
      },
    },
  };
}

const FR24_SUMMARY = {
  data: [{
    fr24_id: 'x', flight: 'UA9002', callsign: 'UAL9002', type: 'B39M', reg: 'N37502',
    orig_icao: 'KORD', dest_icao: 'KSFO', dest_icao_actual: 'KSFO',
    datetime_takeoff: '2026-07-03T02:10:00Z', datetime_landed: '', flight_ended: false,
  }],
};

function scheduleSnapshotRow(flightNum, schedDep, estDep, realDep, schedArr) {
  return {
    data: {
      flights: [{
        identification: { number: { default: flightNum }, callsign: `UAL${flightNum.slice(2)}` },
        airline: { code: { iata: 'UA' } },
        status: { generic: { status: { text: 'delayed', diverted: false }, type: '' }, text: 'delayed', icon: 'yellow', live: false },
        time: {
          scheduled: { departure: schedDep, arrival: schedArr },
          real: { departure: realDep, arrival: null },
          estimated: { departure: estDep, arrival: null },
        },
        airport: {
          origin: { code: { iata: 'ORD' }, name: "Chicago O'Hare", info: { gate: 'C18', terminal: '1' } },
          destination: { code: { iata: 'SFO' }, name: 'San Francisco', info: { gate: 'F11', terminal: '3' } },
        },
        aircraft: { model: { code: '', text: 'Boeing 737 MAX 9' }, registration: 'N37502' },
      }],
      total: 1,
    },
    refreshedAt: Date.now() - 60_000,
  };
}

describe('flight-times fallback chain (#1)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    snapshotMocks.loadScheduleSnapshot.mockReset();
    snapshotMocks.loadScheduleSnapshot.mockResolvedValue(null);
    // F038: this endpoint now checks the shared cross-instance FR24 quota block before its FR24
    // tier; reset it so a 402 recorded elsewhere never leaks into these fallback-chain tests.
    resetMirroredQuotaBlock();
  });

  afterEach(() => {
    delete process.env.FR24_API_TOKEN;
    delete process.env.SCHEDULE_OFFICIAL_FALLBACK_ENABLED;
  });

  it('still serves FlightAware when the bootstrap has flights (source: flightaware)', async () => {
    const dep = Math.floor(Date.now() / 1000) + 3600;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('flightaware.com')) {
        return { ok: true, status: 200, text: async () => faHtml(populatedBootstrap(dep)) };
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    const res = createRes();
    await handler(createReq('UA9001'), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.source).toBe('flightaware');
    expect(res.body.origin.iata).toBe('ORD');
  });

  it('empty bootstrap (bot-wall) → falls through to FR24 instead of "No active flight found"', async () => {
    process.env.FR24_API_TOKEN = 'test-token';
    const calls = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      calls.push(String(url));
      if (String(url).includes('flightaware.com')) {
        return { ok: true, status: 200, text: async () => faHtml(EMPTY_BOOTSTRAP) };
      }
      if (String(url).includes('fr24api.flightradar24.com')) {
        return { ok: true, status: 200, json: async () => FR24_SUMMARY };
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    const res = createRes();
    await handler(createReq('UA9002'), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.source).toBe('fr24');
    expect(res.body.origin.iata).toBe('ORD');
    expect(calls.some((u) => u.includes('fr24api.flightradar24.com'))).toBe(true);
  });

  it('kill switch on (SCHEDULE_OFFICIAL_FALLBACK_ENABLED=false) → FR24 is NEVER called', async () => {
    process.env.FR24_API_TOKEN = 'test-token';
    process.env.SCHEDULE_OFFICIAL_FALLBACK_ENABLED = 'false';
    const calls = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      calls.push(String(url));
      if (String(url).includes('flightaware.com')) {
        return { ok: true, status: 200, text: async () => faHtml(EMPTY_BOOTSTRAP) };
      }
      return { ok: true, status: 200, json: async () => FR24_SUMMARY };
    });
    const res = createRes();
    await handler(createReq('UA9003'), res);
    // No snapshots either → honest all-sources-failed, but the paid API was never touched.
    expect(calls.some((u) => u.includes('fr24api.flightradar24.com'))).toBe(false);
    expect(res.statusCode).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it('schedule-cache tier: serves sched/est/real times from a persisted hub board snapshot', async () => {
    // No FR24 token → chain skips straight to the snapshot layer.
    const schedDep = 1_751_500_000;
    const estDep = schedDep + 10_000;
    const realDep = schedDep + 10_060;
    const schedArr = schedDep + 15_000;
    const ordKey = `agg:ORD:departures:${getStartOfHubDay('ORD', 0)}`;
    snapshotMocks.loadScheduleSnapshot.mockImplementation(async (key) =>
      key === ordKey ? scheduleSnapshotRow('UA9004', schedDep, estDep, realDep, schedArr) : null
    );
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('flightaware.com')) {
        return { ok: true, status: 200, text: async () => faHtml(EMPTY_BOOTSTRAP) };
      }
      throw new Error(`paid/upstream fetch must not happen: ${url}`);
    });
    const res = createRes();
    await handler(createReq('UA9004'), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.source).toBe('schedule-cache');
    expect(res.body.flight).toBe('UA9004');
    expect(res.body.origin.iata).toBe('ORD');
    expect(res.body.destination.iata).toBe('SFO');
    expect(res.body.departure.gate.scheduled).toBe(new Date(schedDep * 1000).toISOString());
    expect(res.body.departure.gate.estimated).toBe(new Date(estDep * 1000).toISOString());
    expect(res.body.departure.gate.actual).toBe(new Date(realDep * 1000).toISOString());
    expect(res.body.arrival.gate.scheduled).toBe(new Date(schedArr * 1000).toISOString());
    expect(res.body.aircraft).toBe('Boeing 737 MAX 9');
  });

  it('all sources failed → success:false with a clear reason (and only then)', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('flightaware.com')) {
        return { ok: true, status: 200, text: async () => faHtml(EMPTY_BOOTSTRAP) };
      }
      return { ok: false, status: 500, json: async () => ({}), text: async () => '' };
    });
    const res = createRes();
    await handler(createReq('UA9005'), res);
    expect(res.statusCode).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.reason).toMatch(/bot-wall/);
    expect(res.body.reason).toMatch(/schedule-cache/);
  });

  it('FlightAware HTTP failure also runs the chain (FR24 disabled → schedule-cache)', async () => {
    process.env.FR24_API_TOKEN = 'test-token';
    process.env.SCHEDULE_OFFICIAL_FALLBACK_ENABLED = '0';
    const schedDep = 1_751_500_000;
    const ordKey = `agg:ORD:departures:${getStartOfHubDay('ORD', 0)}`;
    snapshotMocks.loadScheduleSnapshot.mockImplementation(async (key) =>
      key === ordKey ? scheduleSnapshotRow('UA9006', schedDep, null, null, schedDep + 14400) : null
    );
    const calls = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      calls.push(String(url));
      if (String(url).includes('flightaware.com')) {
        return { ok: false, status: 403, text: async () => 'blocked' };
      }
      return { ok: true, status: 200, json: async () => FR24_SUMMARY };
    });
    const res = createRes();
    await handler(createReq('UA9006'), res);
    expect(calls.some((u) => u.includes('fr24api.flightradar24.com'))).toBe(false);
    expect(res.statusCode).toBe(200);
    expect(res.body.source).toBe('schedule-cache');
  });

  // ── F001: every tier must expose a real `registration` field (separate from the
  // human-readable aircraft TYPE string) so the client stops mis-treating the type
  // as a tail number. ──
  it('FR24 tier returns registration (tail) distinct from the aircraft type', async () => {
    process.env.FR24_API_TOKEN = 'test-token';
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('flightaware.com')) {
        return { ok: true, status: 200, text: async () => faHtml(EMPTY_BOOTSTRAP) };
      }
      if (String(url).includes('fr24api.flightradar24.com')) {
        return { ok: true, status: 200, json: async () => FR24_SUMMARY };
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    const res = createRes();
    await handler(createReq('UA9002'), res);
    expect(res.body.source).toBe('fr24');
    expect(res.body.registration).toBe('N37502'); // the tail
    expect(res.body.aircraft).toBe('B39M');       // the type, unchanged
  });

  it('schedule-cache tier returns registration from aircraft.registration', async () => {
    const schedDep = 1_751_500_000;
    const ordKey = `agg:ORD:departures:${getStartOfHubDay('ORD', 0)}`;
    snapshotMocks.loadScheduleSnapshot.mockImplementation(async (key) =>
      key === ordKey ? scheduleSnapshotRow('UA9007', schedDep, null, null, schedDep + 14400) : null
    );
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('flightaware.com')) {
        return { ok: true, status: 200, text: async () => faHtml(EMPTY_BOOTSTRAP) };
      }
      throw new Error(`paid/upstream fetch must not happen: ${url}`);
    });
    const res = createRes();
    await handler(createReq('UA9007'), res);
    expect(res.body.source).toBe('schedule-cache');
    expect(res.body.registration).toBe('N37502');
    expect(res.body.aircraft).toBe('Boeing 737 MAX 9'); // type, unchanged
  });

  // ── F005/F013: optional date param drives WHICH day's board the schedule-cache
  // tier reads. Without it, today wins; with a tomorrow date, tomorrow's board wins. ──
  it('date param selects tomorrow\'s board over today\'s for the same flight number', async () => {
    const todayDep = 1_751_500_000;
    const tomorrowDep = todayDep + 200_000;
    const todayKey = `agg:ORD:departures:${getStartOfHubDay('ORD', 0)}`;
    const tomorrowKey = `agg:ORD:departures:${getStartOfHubDay('ORD', 1)}`;
    snapshotMocks.loadScheduleSnapshot.mockImplementation(async (key) => {
      if (key === todayKey) return scheduleSnapshotRow('UA9008', todayDep, null, null, todayDep + 14400);
      if (key === tomorrowKey) return scheduleSnapshotRow('UA9008', tomorrowDep, null, null, tomorrowDep + 14400);
      return null;
    });
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('flightaware.com')) {
        return { ok: true, status: 200, text: async () => faHtml(EMPTY_BOOTSTRAP) };
      }
      throw new Error(`paid/upstream fetch must not happen: ${url}`);
    });

    // No date → today's leg.
    const resToday = createRes();
    await handler(createReq('UA9008'), resToday);
    expect(resToday.body.source).toBe('schedule-cache');
    expect(resToday.body.departure.gate.scheduled).toBe(new Date(todayDep * 1000).toISOString());

    // date = ORD-local tomorrow → tomorrow's leg.
    const d = getHubLocalDate('ORD', getStartOfHubDay('ORD', 1) * 1000);
    const tomorrowDate = `${d.year}-${d.month}-${d.day}`;
    const reqTomorrow = createReq('UA9008');
    reqTomorrow.query.date = tomorrowDate;
    const resTomorrow = createRes();
    await handler(reqTomorrow, resTomorrow);
    expect(resTomorrow.body.source).toBe('schedule-cache');
    expect(resTomorrow.body.departure.gate.scheduled).toBe(new Date(tomorrowDep * 1000).toISOString());
  });
});
