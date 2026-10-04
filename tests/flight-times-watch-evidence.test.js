// Oct 4 2026 audit, finding 1 — /api/flight-times, as the watch cron calls it (officialFallback=0,
// FlightAware bot-walled), must report the watched leg from the BEST evidence:
//   - UA1630-style: a hub departure that LANDED at a hub answered "departed" — the departures row
//     never advances, and the same leg's arrivals row only lent its gate;
//   - UA1351-style: a flight the live feed saw AIRBORNE answered "scheduled";
//   - a non-hub destination has no arrivals board at all, so only the live feed (airborne, then on
//     the ground at the destination) can say "landed".
// Plus the `dep` pin the cron uses once a watch is tied to one leg, and the through-flight leg pick
// (phone QA Oct 4: UA1872 MCO→IAH→MSP showed the IAH→MSP leg while MCO→IAH was in the air).
import { readFileSync } from 'node:fs';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const snapshotMocks = vi.hoisted(() => ({
  loadScheduleSnapshot: vi.fn(async () => null),
  saveScheduleSnapshot: vi.fn(async () => {}),
  getSupabaseAdmin: vi.fn(async () => null),
}));
vi.mock(process.cwd() + '/api/_schedule-snapshots.ts', () => snapshotMocks);
const sightingsMock = vi.hoisted(() => ({ map: new Map() }));
vi.mock(process.cwd() + '/api/_reg-sightings.ts', () => ({
  awaitRegSightings: vi.fn(async () => sightingsMock.map),
}));

import handler, { __resetFlightTimesCache } from '../api/flight-times.js';
import { getStartOfHubDay } from '../src/lib/hubTz.js';
import { resetMirroredQuotaBlock } from '../api/_cost-state.js';

const ROWS = JSON.parse(readFileSync(new URL('./fixtures/schedule-board-rows.json', import.meta.url), 'utf8'));
const BASE = ROWS.UA2278_SFO_departures; // SFO→ORD, sched 05:35Z / arr 09:44Z Sep 27 2026
const DEP = BASE.time.scheduled.departure;
const ARR = BASE.time.scheduled.arrival;
const iso = (sec) => new Date(sec * 1000).toISOString();

/** A copy of the fixture row with its status / times / route changed. */
function row({ status = 'scheduled', text = status, realDep = null, realArr = null, estDep, origin = 'SFO', dest = 'ORD', dep = DEP, arr = ARR, ident = 'UA2278' } = {}) {
  const r = structuredClone(BASE);
  r.identification.number.default = ident;
  r.time.scheduled = { departure: dep, arrival: arr };
  r.time.estimated = { departure: estDep ?? dep, arrival: arr };
  r.time.real = { departure: realDep, arrival: realArr };
  r.status = { icon: '', live: false, text, generic: { type: '', status: { text: status, diverted: false } } };
  r.airport.origin.code.iata = origin;
  r.airport.destination.code.iata = dest;
  return r;
}
const key = (hub, dir, off = 0) => `agg:${hub}:${dir}:${getStartOfHubDay(hub, off)}`;
function serveBoards(map) {
  snapshotMocks.loadScheduleSnapshot.mockImplementation(async (k) => (map[k] ? { data: { flights: map[k] } } : null));
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
async function cronLookup(flight = 'UA2278', extra = {}) {
  const res = createRes();
  await handler({ method: 'GET', headers: { origin: 'http://localhost:3000', 'x-real-ip': `10.7.0.${++n}` }, query: { flight, officialFallback: '0', ...extra } }, res);
  return res;
}
const at = (sec) => vi.setSystemTime(sec * 1000);

beforeEach(() => {
  vi.restoreAllMocks();
  vi.useFakeTimers({ toFake: ['Date'], now: (DEP + 3600) * 1000 });
  __resetFlightTimesCache();
  resetMirroredQuotaBlock();
  sightingsMock.map = new Map();
  snapshotMocks.loadScheduleSnapshot.mockReset();
  snapshotMocks.loadScheduleSnapshot.mockResolvedValue(null);
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
    if (String(url).includes('flightaware.com')) return { ok: false, status: 403, text: async () => 'blocked' };
    throw new Error(`unexpected fetch: ${url}`);
  });
});
afterEach(() => { vi.useRealTimers(); });

describe('UA1630-style: a hub-to-hub leg that landed reads landed', () => {
  it('the arrivals row lends its arrival and its landed status to the departures row', async () => {
    at(ARR + 1200);
    serveBoards({
      [key('SFO', 'departures')]: [row({ status: 'departed', realDep: DEP + 420 })],
      [key('ORD', 'arrivals')]: [row({ status: 'landed', text: 'arrived', realDep: DEP + 420, realArr: ARR - 300 })],
    });
    const res = await cronLookup();
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('landed');
    expect(res.body.arrival.gate.actual).toBe(iso(ARR - 300));
    // The departure side still comes from the origin's board.
    expect(res.body.departure.gate.actual).toBe(iso(DEP + 420));
    expect(res.body.origin.gate).toBe('D5');
  });
});

describe('UA1351-style: a flight the live feed saw airborne reads departed', () => {
  it('scheduled on the board + airborne out of the origin after its departure → departed', async () => {
    at(DEP + 1800);
    serveBoards({ [key('SFO', 'departures')]: [row({ status: 'scheduled', text: 'expected' })] });
    sightingsMock.map = new Map([['UA2278', { reg: 'N76265', origin: 'SFO', dest: 'ORD', seenAtMs: (DEP + 1680) * 1000, airborneAtMs: (DEP + 1680) * 1000 }]]);
    const res = await cronLookup();
    expect(res.body.status).toBe('departed');
    expect(res.body.evidence).toEqual({ kind: 'airborne', airborneAt: iso(DEP + 1680), seenAt: iso(DEP + 1680) });
  });

  it('an airborne sighting from BEFORE the departure window (the inbound leg) is not a departure', async () => {
    at(DEP + 600);
    serveBoards({ [key('SFO', 'departures')]: [row({ status: 'scheduled', text: 'expected' })] });
    sightingsMock.map = new Map([['UA2278', { reg: 'N76265', origin: 'SFO', dest: 'ORD', seenAtMs: (DEP - 3600) * 1000, airborneAtMs: (DEP - 3600) * 1000 }]]);
    const res = await cronLookup();
    expect(res.body.status).toBe('scheduled');
    expect(res.body.evidence).toBeUndefined();
  });
});

describe('non-hub destination: landed from the live feed', () => {
  const MSN = { dest: 'MSN' };
  it('airborne late in the block, then seen on the ground on this route → landed', async () => {
    at(ARR + 900);
    serveBoards({ [key('SFO', 'departures')]: [row({ status: 'departed', realDep: DEP + 300, ...MSN })] });
    sightingsMock.map = new Map([['UA2278', { reg: 'N76265', origin: 'SFO', dest: 'MSN', airborneAtMs: (ARR - 600) * 1000, seenAtMs: (ARR - 120) * 1000 }]]);
    const res = await cronLookup();
    expect(res.body.status).toBe('landed');
    expect(res.body.evidence.kind).toBe('ground-at-destination');
    expect(res.body.arrival.gate.actual).toBe(''); // a sighting is not an arrival time
  });

  it('still airborne (latest sighting IS the airborne one) → departed, not landed', async () => {
    at(ARR - 900);
    serveBoards({ [key('SFO', 'departures')]: [row({ status: 'departed', realDep: DEP + 300, ...MSN })] });
    sightingsMock.map = new Map([['UA2278', { reg: 'N76265', origin: 'SFO', dest: 'MSN', airborneAtMs: (ARR - 960) * 1000, seenAtMs: (ARR - 960) * 1000 }]]);
    expect((await cronLookup()).body.status).toBe('departed');
  });

  it('back on the ground early in the block (an air return) is not a landing', async () => {
    at(DEP + 3600);
    serveBoards({ [key('SFO', 'departures')]: [row({ status: 'departed', realDep: DEP + 300, ...MSN })] });
    sightingsMock.map = new Map([['UA2278', { reg: 'N76265', origin: 'SFO', dest: 'MSN', airborneAtMs: (DEP + 1500) * 1000, seenAtMs: (DEP + 2400) * 1000 }]]);
    expect((await cronLookup()).body.status).toBe('departed');
  });
});

describe('`dep` pins one dated leg (finding 2)', () => {
  it('answers with the pinned leg even when another day\'s leg is the "current" one', async () => {
    // 00:40 PDT Sep 27: SFO's Sep 27 board lists tomorrow night's leg; tonight's is in the air on
    // ORD's arrivals board.
    at(DEP + 7500);
    const tomorrow = row({ dep: DEP + 86400, arr: ARR + 86400 });
    serveBoards({
      [key('SFO', 'departures')]: [tomorrow],
      [key('ORD', 'arrivals')]: [row({ status: 'departed', realDep: DEP + 600 })],
    });
    const tonight = await cronLookup('UA2278', { dep: String(DEP), from: 'SFO' });
    expect(tonight.body.departure.gate.scheduled).toBe(iso(DEP));
    const next = await cronLookup('UA2278', { dep: String(DEP + 86400) });
    expect(next.body.departure.gate.scheduled).toBe(iso(DEP + 86400));
  });

  it('a pinned leg no board holds is a 404, never some other leg', async () => {
    at(DEP + 7500);
    serveBoards({ [key('SFO', 'departures')]: [row({ dep: DEP + 86400, arr: ARR + 86400 })] });
    const res = await cronLookup('UA2278', { dep: String(DEP - 86400) });
    expect(res.statusCode).toBe(404);
  });
});

describe('through flights: the leg in the air wins over the overdue next leg (phone QA, UA1872)', () => {
  // UA1872 MCO→IAH→MSP. MCO→IAH left late and is in the air; IAH→MSP's scheduled time has passed
  // while it waits for that aircraft. Both look "active" by the clock.
  const MCO_DEP = DEP;
  const IAH_ARR = DEP + 2 * 3600 + 1800;
  const IAH_DEP = DEP + 2 * 3600;
  const first = () => row({ ident: 'UA1872', origin: 'MCO', dest: 'IAH', dep: MCO_DEP, arr: IAH_ARR, estDep: MCO_DEP + 1800, status: 'scheduled', text: 'expected' });
  const second = () => row({ ident: 'UA1872', origin: 'IAH', dest: 'MSP', dep: IAH_DEP, arr: IAH_DEP + 9000, status: 'scheduled', text: 'expected' });

  it('picks the earlier active leg, and the one the live feed saw leave', async () => {
    at(IAH_DEP + 600);
    serveBoards({ [key('IAH', 'arrivals')]: [first()], [key('IAH', 'departures')]: [second()] });
    const plain = await cronLookup('UA1872');
    expect(plain.body.origin.iata).toBe('MCO');
    __resetFlightTimesCache();
    sightingsMock.map = new Map([['UA1872', { reg: 'N37500', origin: 'MCO', dest: 'IAH', airborneAtMs: (IAH_DEP + 420) * 1000, seenAtMs: (IAH_DEP + 420) * 1000 }]]);
    const seen = await cronLookup('UA1872');
    expect(seen.body.origin.iata).toBe('MCO');
    expect(seen.body.status).toBe('departed');
  });

  it('a real departure on the second leg makes it the one in the air', async () => {
    at(IAH_DEP + 3600);
    const flown = row({ ident: 'UA1872', origin: 'IAH', dest: 'MSP', dep: IAH_DEP, arr: IAH_DEP + 9000, status: 'departed', realDep: IAH_DEP + 1200 });
    serveBoards({ [key('IAH', 'arrivals')]: [first()], [key('IAH', 'departures')]: [flown] });
    expect((await cronLookup('UA1872')).body.origin.iata).toBe('IAH');
  });
});
