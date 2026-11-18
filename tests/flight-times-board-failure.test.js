// /api/flight-times when the stored hub boards cannot be read (Nov 16 2026, 23:20:40Z: a dozen
// lookups at once, every board read ran out of its 3-second limit together).
//
// Before: a board read that timed out answered "no snapshot", exactly like a board without the
// flight. The lookup then walked on to yesterday's and tomorrow's boards, so a flight in the air
// could be answered with TOMORROW's leg, the "no snapshot" was memoised for a minute, and the
// answer was cached for the next visitor. A failed read is now "not known": no walking on, no
// memo, no cache, and a 503 rather than a 404 when nothing else can answer.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const snapshotMocks = vi.hoisted(() => ({
  loadScheduleSnapshot: vi.fn(async () => null),
  saveScheduleSnapshot: vi.fn(async () => {}),
  getSupabaseAdmin: vi.fn(async () => null),
  loadBoardsListingFlight: vi.fn(async () => ({ boards: new Map(), failed: false })),
}));
vi.mock(process.cwd() + '/api/_schedule-snapshots.ts', () => snapshotMocks);

import handler, { __resetFlightTimesCache } from '../api/flight-times.js';
import { getStartOfHubDay } from '../src/lib/hubTz.js';
import { resetMirroredQuotaBlock } from '../api/_cost-state.js';
import { isHost } from './helpers/url-host.js';

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
function createReq(query) {
  reqCounter++;
  return { method: 'GET', headers: { 'x-real-ip': `10.9.0.${reqCounter}` }, query };
}

const key = (hub, dir, off = 0) => `agg:${hub}:${dir}:${getStartOfHubDay(hub, off)}`;
const nowSec = () => Math.floor(Date.now() / 1000);

/** One ORD→SFO row for UA9100, scheduled to leave `depInSec` from now. */
function boardWith(depInSec) {
  const dep = nowSec() + depInSec;
  return {
    data: {
      flights: [{
        identification: { number: { default: 'UA9100' } },
        status: { generic: { status: { text: 'scheduled' }, type: '' } },
        time: {
          scheduled: { departure: dep, arrival: dep + 4 * 3600 },
          estimated: { departure: null, arrival: null },
          real: { departure: null, arrival: null },
        },
        airport: {
          origin: { code: { iata: 'ORD' }, name: "Chicago O'Hare", info: { gate: 'C18', terminal: '1' } },
          destination: { code: { iata: 'SFO' }, name: 'San Francisco', info: { gate: 'F11', terminal: '3' } },
        },
        aircraft: { model: { text: 'Boeing 737 MAX 9' }, registration: '' },
      }],
    },
    refreshedAt: Date.now(),
  };
}

/** Answer each batch: `failToday` makes the batch holding today's ORD departures board fail. */
function serveBatches({ failToday = false, boards = {} } = {}) {
  snapshotMocks.loadBoardsListingFlight.mockImplementation(async (keys) => {
    if (failToday && keys.includes(key('ORD', 'departures', 0))) return { boards: new Map(), failed: true };
    const found = new Map();
    for (const k of keys) if (boards[k]) found.set(k, boards[k]);
    return { boards: found, failed: false };
  });
}

describe('flight-times when the boards cannot be read', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    __resetFlightTimesCache();
    resetMirroredQuotaBlock();
    snapshotMocks.loadBoardsListingFlight.mockReset();
  });
  afterEach(() => {
    delete process.env.FR24_API_TOKEN;
  });

  it("does not answer with tomorrow's leg when today's boards did not answer", async () => {
    serveBatches({ failToday: true, boards: { [key('ORD', 'departures', 1)]: boardWith(20 * 3600) } });
    const res = createRes();
    await handler(createReq({ flight: 'UA9100', officialFallback: '0' }), res);
    expect(res.statusCode).toBe(503);
    expect(res.body.success).toBe(false);
    expect(res.headers['Cache-Control']).toBe('no-store');
    // One batch (today's), never yesterday's or tomorrow's.
    expect(snapshotMocks.loadBoardsListingFlight).toHaveBeenCalledTimes(1);
  });

  it('asks again on the next lookup: a failed read is not remembered as "no flight"', async () => {
    serveBatches({ failToday: true });
    const first = createRes();
    await handler(createReq({ flight: 'UA9100', officialFallback: '0' }), first);
    expect(first.statusCode).toBe(503);

    serveBatches({ boards: { [key('ORD', 'departures', 0)]: boardWith(2 * 3600) } });
    const second = createRes();
    await handler(createReq({ flight: 'UA9100', officialFallback: '0' }), second);
    expect(second.statusCode).toBe(200);
    expect(second.body.source).toBe('schedule-cache');
    expect(second.body.departure.gate.scheduled).not.toBe('');
  });

  it('one read for a burst of lookups of the same flight', async () => {
    serveBatches({ boards: { [key('ORD', 'departures', 0)]: boardWith(2 * 3600) } });
    const results = await Promise.all([1, 2, 3, 4].map(async () => {
      const res = createRes();
      // All four pass the response cache before any answers: the shared in-flight read is what
      // keeps this to one query.
      await handler(createReq({ flight: 'UA9100', officialFallback: '0' }), res);
      return res;
    }));
    expect(results.every((r) => r.statusCode === 200)).toBe(true);
    // An upcoming leg also looks at yesterday's boards (a red-eye may still be in the air): one
    // batch per day, shared by all four lookups, instead of 4 × 36 board reads.
    expect(snapshotMocks.loadBoardsListingFlight).toHaveBeenCalledTimes(2);
    const [today, yesterday] = snapshotMocks.loadBoardsListingFlight.mock.calls.map(([keys]) => keys);
    expect(today).toHaveLength(18);
    expect(today).toContain(key('ORD', 'departures', 0));
    expect(yesterday).toContain(key('ORD', 'departures', -1));
  });

  it("serves FR24's answer when the boards failed, but neither caches nor memoises it", async () => {
    process.env.FR24_API_TOKEN = 'test-token';
    const isoAgo = (ms) => new Date(Date.now() - ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (isHost(url, 'fr24api.flightradar24.com')) {
        return {
          ok: true, status: 200,
          json: async () => ({
            data: [{
              fr24_id: 'x', flight: 'UA9100', callsign: 'UAL9100', type: 'B39M', reg: 'N37502',
              orig_icao: 'KORD', dest_icao: 'KSFO', dest_icao_actual: 'KSFO',
              datetime_takeoff: isoAgo(3_600_000), datetime_landed: null, flight_ended: false,
              first_seen: isoAgo(4_200_000), last_seen: isoAgo(60_000),
            }],
          }),
        };
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    serveBatches({ failToday: true });
    const first = createRes();
    await handler(createReq({ flight: 'UA9100' }), first);
    expect(first.statusCode).toBe(200);
    expect(first.body.source).toBe('fr24');
    expect(first.headers['Cache-Control']).toBe('no-store');

    // Not held in the response cache: the next lookup reads the boards again.
    serveBatches({ boards: { [key('ORD', 'departures', 0)]: boardWith(2 * 3600) } });
    const second = createRes();
    await handler(createReq({ flight: 'UA9100' }), second);
    expect(second.body.source).toBe('schedule-cache');
    // The failed batch, then today's and yesterday's again.
    expect(snapshotMocks.loadBoardsListingFlight).toHaveBeenCalledTimes(3);
  });
});
