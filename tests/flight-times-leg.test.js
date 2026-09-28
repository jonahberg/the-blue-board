// F0 / F1 / F138 (Sep 2026 audit) — /api/flight-times must answer about the RIGHT leg, with
// gate times.
//
// Prod, Sep 27 2026 04:33Z: UA2278 departs SFO tonight at 05:35Z. The FR24 tier asked
// flight-summary/light for now±24h, got back only YESTERDAY's completed leg (FR24 lists legs
// that have operated), fell back to flights[0] and answered "landed, N24542" — so My Flights,
// the flight sheet and the watch cron all showed yesterday's flight. Because that answer was
// non-null, the schedule-snapshot tier (which has tonight's scheduled/estimated gate times)
// was never reached, and every FR24-resolved payload carried EMPTY gate times — the connection
// checker's only input — so every connection read NO DATA.
//
// Fixtures are real production shapes: tests/fixtures/schedule-board-rows.json (board rows
// captured from /api/schedule) and tests/fixtures/fr24-summary-light.json.
import { readFileSync } from 'node:fs';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const snapshotMocks = vi.hoisted(() => ({
  loadScheduleSnapshot: vi.fn(async () => null),
  saveScheduleSnapshot: vi.fn(async () => {}),
  getSupabaseAdmin: vi.fn(async () => null),
}));
vi.mock(process.cwd() + '/api/_schedule-snapshots.ts', () => snapshotMocks);

import handler, { __resetFlightTimesCache } from '../api/flight-times.js';
import { getStartOfHubDay } from '../src/lib/hubTz.js';
import { resetMirroredQuotaBlock } from '../api/_cost-state.js';
import { computeConnectionRisk } from '../src/lib/connection-pairing.js';
import { pickFr24SummaryLeg } from '../api/_official-fr24.js';

const ROWS = JSON.parse(readFileSync(new URL('./fixtures/schedule-board-rows.json', import.meta.url), 'utf8'));
const FR24_LIGHT = JSON.parse(readFileSync(new URL('./fixtures/fr24-summary-light.json', import.meta.url), 'utf8'));
const CAPTURED_MS = ROWS.capturedAt * 1000; // 2026-09-27T04:33:39Z
const TONIGHT_DEP_ISO = '2026-09-27T05:35:00.000Z';

/** A board row with every epoch moved by `deltaSec` — the same flight, another day. */
function shiftRow(row, deltaSec) {
  const copy = structuredClone(row);
  for (const kind of ['scheduled', 'estimated', 'real']) {
    for (const end of ['departure', 'arrival']) {
      if (copy.time[kind][end]) copy.time[kind][end] += deltaSec;
    }
  }
  return copy;
}

/** The persisted snapshot shape: `saveScheduleSnapshot` stores the board as `data`. */
function board(...flights) {
  return { data: { flights, total: flights.length }, refreshedAt: Date.now() };
}

/** Snapshot keys → boards, as seen at the (faked) current time. */
function serveBoards(map) {
  snapshotMocks.loadScheduleSnapshot.mockImplementation(async (key) => map[key] ?? null);
}
const key = (hub, dir, off = 0) => `agg:${hub}:${dir}:${getStartOfHubDay(hub, off)}`;

function createRes() {
  return {
    statusCode: 200, headers: {}, body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    end() { return this; },
    json(payload) { this.body = payload; return this; },
  };
}
let reqCounter = 0;
function createReq(flight, extra = {}) {
  reqCounter++;
  return {
    method: 'GET',
    headers: { origin: 'http://localhost:3000', 'x-real-ip': `10.9.0.${reqCounter}` },
    query: { flight, ...extra },
  };
}

/** FlightAware bot-walls (403, as prod sees) and FR24 answers `fr24Body`. */
function mockUpstream(fr24Body) {
  const calls = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
    calls.push(String(url));
    if (String(url).includes('flightaware.com')) return { ok: false, status: 403, text: async () => 'blocked' };
    if (String(url).includes('fr24api.flightradar24.com')) {
      return { ok: true, status: 200, json: async () => fr24Body };
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  return calls;
}
const fr24Called = (calls) => calls.some((u) => u.includes('fr24api.flightradar24.com'));

/** FR24's answer once tonight's leg is airborne: takeoff 05:52Z, the tail the board did not know. */
const TONIGHT_AIRBORNE = {
  data: [
    FR24_LIGHT.data[0],
    {
      ...FR24_LIGHT.data[0],
      fr24_id: '3c9b0a11', reg: 'N76265',
      datetime_takeoff: '2026-09-27T05:52:40Z', datetime_landed: null, flight_ended: false,
      first_seen: '2026-09-27T05:31:02Z', last_seen: '2026-09-27T06:29:58Z',
    },
  ],
};

describe('flight-times resolves the right leg (F0) with gate times (F1)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers({ toFake: ['Date'], now: CAPTURED_MS });
    __resetFlightTimesCache();
    resetMirroredQuotaBlock();
    snapshotMocks.loadScheduleSnapshot.mockReset();
    snapshotMocks.loadScheduleSnapshot.mockResolvedValue(null);
    process.env.FR24_API_TOKEN = 'test-token';
  });
  afterEach(() => {
    vi.useRealTimers();
    delete process.env.FR24_API_TOKEN;
  });

  it('prod repro: FR24 has only yesterday\'s landed leg, the SFO board has tonight\'s → tonight\'s scheduled leg', async () => {
    serveBoards({ [key('SFO', 'departures')]: board(ROWS.UA2278_SFO_departures) });
    const calls = mockUpstream(FR24_LIGHT);
    const res = createRes();
    await handler(createReq('UA2278'), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.source).toBe('schedule-cache');
    expect(res.body.status).not.toMatch(/land/);
    expect(res.body.arrival.landing.actual).toBe('');
    // Yesterday's tail must not leak onto tonight's flight.
    expect(res.body.registration).not.toBe('N24542');
    expect(res.body.departure.gate.scheduled).toBe(TONIGHT_DEP_ISO);
    expect(res.body.origin.gate).toBe('D5');
    expect(res.body.origin.tz).toBe('America/Los_Angeles');
    expect(res.body.destination.tz).toBe('America/Chicago');
    // An hour out, FR24 cannot know tonight's leg yet — the paid call is skipped.
    expect(fr24Called(calls)).toBe(false);
  });

  it('with no board match, a leg that ended yesterday is not served as today\'s answer', async () => {
    const calls = mockUpstream(FR24_LIGHT);
    const res = createRes();
    await handler(createReq('UA2278'), res);
    expect(fr24Called(calls)).toBe(true);
    expect(res.statusCode).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it('once airborne, FR24 live actuals and tail overlay the board\'s gate times (F1)', async () => {
    vi.setSystemTime(Date.parse('2026-09-27T06:30:00Z'));
    serveBoards({ [key('SFO', 'departures')]: board(ROWS.UA2278_SFO_departures) });
    const calls = mockUpstream(TONIGHT_AIRBORNE);
    const res = createRes();
    await handler(createReq('UA2278'), res);

    expect(fr24Called(calls)).toBe(true);
    expect(res.body.source).toBe('schedule-cache+fr24');
    expect(res.body.status).toBe('en-route');
    expect(res.body.registration).toBe('N76265');
    expect(res.body.departure.takeoff.actual).toBe('2026-09-27T05:52:40Z');
    // Gate times still come from the board — the fields My Flights and the connection
    // checker read.
    expect(res.body.departure.gate.scheduled).toBe(TONIGHT_DEP_ISO);
    expect(res.body.arrival.gate.estimated).not.toBe('');
  });

  it('FR24-only answer (no board) is still served for an airborne leg, flagged timesUnavailable', async () => {
    vi.setSystemTime(Date.parse('2026-09-27T06:30:00Z'));
    mockUpstream(TONIGHT_AIRBORNE);
    const res = createRes();
    await handler(createReq('UA2278'), res);
    expect(res.body.source).toBe('fr24');
    expect(res.body.status).toBe('en-route');
    expect(res.body.registration).toBe('N76265');
    expect(res.body.timesUnavailable).toBe(true);
    expect(res.body.origin.tz).toBe('America/Los_Angeles');
  });

  it('red-eye past hub midnight: the airborne leg on the arrivals board beats tomorrow night\'s departure', async () => {
    // 00:40 PDT Sep 27. SFO's Sep 27 departures board now lists TOMORROW night's UA2278; the
    // leg in the air is on ORD's Sep 27 arrivals board.
    vi.setSystemTime(Date.parse('2026-09-27T07:40:00Z'));
    const inAir = structuredClone(ROWS.UA2278_SFO_departures);
    inAir.time.real.departure = inAir.time.scheduled.departure + 1060;
    serveBoards({
      [key('SFO', 'departures')]: board(shiftRow(ROWS.UA2278_SFO_departures, 86400)),
      [key('ORD', 'arrivals')]: board(inAir),
    });
    mockUpstream({ data: [] });
    const res = createRes();
    await handler(createReq('UA2278', { officialFallback: '0' }), res);
    expect(res.body.departure.gate.scheduled).toBe(TONIGHT_DEP_ISO);
  });

  it('connection check has gate times on both legs → a real verdict, not NO DATA (F1 repro)', async () => {
    vi.setSystemTime(Date.parse('2026-09-27T04:35:00Z'));
    serveBoards({
      [key('SFO', 'departures')]: board(ROWS.UA2278_SFO_departures),
      [key('ORD', 'departures')]: board(ROWS.UA2106_ORD_departures),
    });
    mockUpstream({ data: [] });
    const inbound = createRes();
    await handler(createReq('UA2106'), inbound);
    const outbound = createRes();
    await handler(createReq('UA2278'), outbound);

    const risk = computeConnectionRisk({
      hub: 'SFO',
      inbound: { w: { flight: 'UA2106' }, td: inbound.body },
      outbound: { w: { flight: 'UA2278' }, td: outbound.body },
    });
    expect(risk.state).toBe('scored');
    // The audit's own pair: UA2106 is estimated at the SFO gate at 07:29Z, but UA2278 pushes
    // at 05:35Z — the honest answer is MISSED, which NO DATA was hiding.
    expect(risk.connectionMin).toBe(-114);
    expect(risk.risk).toBe('MISSED');
  });
});

describe('response cache (F138)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers({ toFake: ['Date'], now: Date.parse('2026-09-27T06:30:00Z') });
    __resetFlightTimesCache();
    resetMirroredQuotaBlock();
    snapshotMocks.loadScheduleSnapshot.mockReset();
    snapshotMocks.loadScheduleSnapshot.mockResolvedValue(null);
    process.env.FR24_API_TOKEN = 'test-token';
  });
  afterEach(() => {
    vi.useRealTimers();
    delete process.env.FR24_API_TOKEN;
  });

  it('an officialFallback=0 caller is never served a cached paid-tier answer', async () => {
    const calls = mockUpstream(TONIGHT_AIRBORNE);
    const first = createRes();
    await handler(createReq('UA2278'), first);
    expect(first.body.source).toBe('fr24');

    calls.length = 0;
    const cron = createRes();
    await handler(createReq('UA2278', { officialFallback: '0' }), cron);
    expect(cron.body.cached).not.toBe(true);
    expect(fr24Called(calls)).toBe(false);
    expect(cron.statusCode).toBe(404);
  });
});

describe('pickFr24SummaryLeg — which FR24 leg is "the" flight', () => {
  const yesterday = FR24_LIGHT.data[0];
  const tonight = TONIGHT_AIRBORNE.data[1];
  const at = (iso) => Date.parse(iso);

  it('never falls back to a leg that ended a day ago', () => {
    expect(pickFr24SummaryLeg([yesterday], { nowMs: CAPTURED_MS })).toBeNull();
  });

  it('allowPrevious hands it back, flagged as not current', () => {
    expect(pickFr24SummaryLeg([yesterday], { nowMs: CAPTURED_MS, allowPrevious: true }))
      .toEqual({ leg: yesterday, current: false });
  });

  it('prefers the live leg whatever the array order', () => {
    const nowMs = at('2026-09-27T06:30:00Z');
    expect(pickFr24SummaryLeg([tonight, yesterday], { nowMs })?.leg).toBe(tonight);
    expect(pickFr24SummaryLeg([yesterday, tonight], { nowMs })?.leg).toBe(tonight);
  });

  it('keeps a leg that landed within the last three hours', () => {
    const landed = { ...tonight, datetime_landed: '2026-09-27T09:31:00Z', flight_ended: true };
    expect(pickFr24SummaryLeg([landed], { nowMs: at('2026-09-27T11:00:00Z') })?.current).toBe(true);
    expect(pickFr24SummaryLeg([landed], { nowMs: at('2026-09-27T13:00:00Z') })).toBeNull();
  });

  it('a not-ended leg FR24 stopped hearing from is lost tracking, not airborne', () => {
    expect(pickFr24SummaryLeg([tonight], { nowMs: at('2026-09-27T08:00:00Z') })).toBeNull();
  });

  it('with the board\'s scheduled departure, only a leg starting within an hour of it matches', () => {
    const schedDepMs = Date.parse(TONIGHT_DEP_ISO);
    expect(pickFr24SummaryLeg([yesterday], { nowMs: at('2026-09-27T06:30:00Z'), schedDepMs })).toBeNull();
    expect(pickFr24SummaryLeg([yesterday, tonight], { nowMs: at('2026-09-27T06:30:00Z'), schedDepMs })?.leg).toBe(tonight);
  });
});
