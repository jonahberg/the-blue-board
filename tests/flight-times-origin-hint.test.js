// D2 (live audit Sep 28 2026, v1.9.1): the connection checker was asked UA1215 (→ORD) + UA786
// and answered "doesn't connect … UA786 departs from ICT" — UA786 is a multi-leg flight number
// (ICT→ORD, then ORD→LGA on the ORD departures board), and /api/flight-times resolved the leg
// in the air instead of the one leaving the connection hub. `?from=ORD` pins the leg DEPARTING
// FROM a given airport, resolved against the hub boards.
//
// D1 (same audit): a leg with a recorded takeoff is never served as 'expected'/'scheduled'.
//
// Rows are the production board-row shape (tests/fixtures/schedule-board-rows.json).
import { readFileSync } from 'node:fs';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const snapshotMocks = vi.hoisted(() => ({
  loadScheduleSnapshot: vi.fn(async () => null),
  saveScheduleSnapshot: vi.fn(async () => {}),
  getSupabaseAdmin: vi.fn(async () => null),
}));
vi.mock(process.cwd() + '/api/_schedule-snapshots.ts', () => snapshotMocks);

import handler, { __resetFlightTimesCache, normalizeLegStatus } from '../api/flight-times.js';
import { getStartOfHubDay } from '../src/lib/hubTz.js';
import { resetMirroredQuotaBlock } from '../api/_cost-state.js';
import { manualConnectionOutcome, outboundNeedsOriginHint } from '../src/lib/connection-pairing.js';

const ROWS = JSON.parse(readFileSync(new URL('./fixtures/schedule-board-rows.json', import.meta.url), 'utf8'));
const NOW = Date.parse('2026-09-28T16:05:00Z');
const sec = (iso) => Date.parse(iso) / 1000;

function row({ flight, from, to, schedDep, schedArr, realDep = null, estArr = null, text = 'expected', generic = 'scheduled' }) {
  const r = structuredClone(ROWS.UA2278_SFO_departures);
  r.identification = { number: { default: flight }, callsign: flight.replace('UA', 'UAL') };
  r.airport.origin.code.iata = from;
  r.airport.origin.name = from;
  r.airport.destination.code.iata = to;
  r.airport.destination.name = to;
  r.time = {
    real: { departure: realDep ? sec(realDep) : null, arrival: null },
    estimated: { departure: null, arrival: estArr ? sec(estArr) : null },
    scheduled: { departure: sec(schedDep), arrival: sec(schedArr) },
  };
  r.status = { icon: '', live: false, text, generic: { type: '', status: { text: generic, diverted: false } } };
  return r;
}

// UA786 leg 1 — Wichita to O'Hare, in the air right now.
const UA786_ICT_ORD = row({ flight: 'UA786', from: 'ICT', to: 'ORD', schedDep: '2026-09-28T14:30:00Z', schedArr: '2026-09-28T16:20:00Z', realDep: '2026-09-28T14:36:00Z', text: 'departed', generic: 'departed' });
// UA786 leg 2 — O'Hare to LaGuardia, the leg a UA1215 passenger connects to.
const UA786_ORD_LGA = row({ flight: 'UA786', from: 'ORD', to: 'LGA', schedDep: '2026-09-28T17:20:00Z', schedArr: '2026-09-28T19:25:00Z' });

const board = (...flights) => ({ data: { flights, total: flights.length }, refreshedAt: Date.now() });
const key = (hub, dir, off = 0) => `agg:${hub}:${dir}:${getStartOfHubDay(hub, off)}`;
function serveBoards(map) {
  snapshotMocks.loadScheduleSnapshot.mockImplementation(async (k) => map[k] ?? null);
}
function createRes() {
  return {
    statusCode: 200, headers: {}, body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    end() { return this; },
    json(payload) { this.body = payload; return this; },
  };
}
let n = 0;
const createReq = (flight, extra = {}) => ({
  method: 'GET',
  headers: { origin: 'http://localhost:3000', 'x-real-ip': `10.8.0.${++n}` },
  query: { flight, officialFallback: '0', ...extra },
});

describe('/api/flight-times ?from= origin hint (D2)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    __resetFlightTimesCache();
    resetMirroredQuotaBlock();
    snapshotMocks.loadScheduleSnapshot.mockReset();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('flightaware.com')) return { ok: false, status: 403, text: async () => 'blocked' };
      throw new Error(`unexpected fetch: ${url}`);
    });
    serveBoards({
      [key('ORD', 'arrivals')]: board(UA786_ICT_ORD),
      [key('ORD', 'departures')]: board(UA786_ORD_LGA),
    });
  });
  afterEach(() => vi.useRealTimers());

  it('without a hint, the airborne ICT→ORD leg is "the" UA786 (unchanged behaviour)', async () => {
    const res = createRes();
    await handler(createReq('UA786'), res);
    expect(res.body.origin.iata).toBe('ICT');
  });

  it('from=ORD resolves the leg departing O\'Hare', async () => {
    const res = createRes();
    await handler(createReq('UA786', { from: 'ORD' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.origin.iata).toBe('ORD');
    expect(res.body.destination.iata).toBe('LGA');
    expect(res.body.departure.gate.scheduled).toBe('2026-09-28T17:20:00.000Z');
  });

  it('the hint is part of the cache key — a hinted answer never leaks to an unhinted caller', async () => {
    const hinted = createRes();
    await handler(createReq('UA786', { from: 'ord' }), hinted);
    const plain = createRes();
    await handler(createReq('UA786'), plain);
    expect(hinted.body.origin.iata).toBe('ORD');
    expect(plain.body.origin.iata).toBe('ICT');
  });

  it('a hint no leg matches is a 404, never another leg', async () => {
    const res = createRes();
    await handler(createReq('UA786', { from: 'DEN' }), res);
    expect(res.statusCode).toBe(404);
  });

  it('a malformed hint is rejected', async () => {
    const res = createRes();
    await handler(createReq('UA786', { from: 'OR D;' }), res);
    expect(res.statusCode).toBe(400);
  });

  it('the checker, re-asking with the inbound hub, sees a connection instead of "departs from ICT"', async () => {
    const UA1215 = row({ flight: 'UA1215', from: 'ALB', to: 'ORD', schedDep: '2026-09-28T13:55:00Z', schedArr: '2026-09-28T16:29:00Z', realDep: '2026-09-28T14:05:00Z', text: 'departed', generic: 'departed' });
    serveBoards({
      [key('ORD', 'arrivals')]: board(UA786_ICT_ORD, UA1215),
      [key('ORD', 'departures')]: board(UA786_ORD_LGA),
    });
    const r1 = createRes();
    await handler(createReq('UA1215'), r1);
    const r2 = createRes();
    await handler(createReq('UA786'), r2);
    expect(manualConnectionOutcome(r1.body, r2.body, 'UA1215', 'UA786').kind).toBe('not-connecting');
    expect(outboundNeedsOriginHint(r1.body, r2.body)).toBe('ORD');
    const hinted = createRes();
    await handler(createReq('UA786', { from: outboundNeedsOriginHint(r1.body, r2.body) }), hinted);
    const outcome = manualConnectionOutcome(r1.body, hinted.body, 'UA1215', 'UA786');
    expect(outcome.kind).toBe('ok');
    expect(outcome.conn.outbound.td.destination.iata).toBe('LGA');
  });
});

describe('normalizeLegStatus (D1)', () => {
  const base = {
    status: 'expected',
    departure: { gate: { scheduled: 'x', estimated: '', actual: '' }, takeoff: { scheduled: '', estimated: '', actual: '' } },
    arrival: { landing: { scheduled: '', estimated: '', actual: '' }, gate: { scheduled: '', estimated: '', actual: '' } },
  };
  const withTakeoff = { ...base, departure: { ...base.departure, takeoff: { ...base.departure.takeoff, actual: '2026-09-28T14:17:40Z' } } };

  it("a leg with takeoff.actual is en-route, not 'expected'/'scheduled'", () => {
    expect(normalizeLegStatus(withTakeoff).status).toBe('en-route');
    expect(normalizeLegStatus({ ...withTakeoff, status: 'scheduled' }).status).toBe('en-route');
    expect(normalizeLegStatus({ ...withTakeoff, status: '' }).status).toBe('en-route');
  });

  it('a pushed-back leg without a takeoff reads departed', () => {
    const out = { ...base, departure: { ...base.departure, gate: { ...base.departure.gate, actual: '2026-09-28T14:05:00Z' } } };
    expect(normalizeLegStatus(out).status).toBe('departed');
  });

  it('leaves real status words, landed legs and cancellations alone', () => {
    expect(normalizeLegStatus({ ...withTakeoff, status: 'landed' }).status).toBe('landed');
    expect(normalizeLegStatus({ ...withTakeoff, cancelled: true }).status).toBe('expected');
    const landed = { ...withTakeoff, arrival: { ...withTakeoff.arrival, landing: { ...withTakeoff.arrival.landing, actual: '2026-09-28T16:20:00Z' } } };
    expect(normalizeLegStatus(landed).status).toBe('expected');
    expect(normalizeLegStatus(base)).toBe(base);
  });
});
