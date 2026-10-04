// v1.12.0 — /api/flight-times' snapshot tier (the watch-alerts cron's path: officialFallback=0 and
// FlightAware bot-walled) reads schedule_snapshots directly, so /api/schedule's serve-time overlay
// never touched it: a "Likely Canceled" flight the live feed saw fly resolved as
// status "canceled_uncertain" and the cron pushed "UA2278: canceled_uncertain". It now resolves
// departed; an unseen one still reads canceled_uncertain (the push engine treats that as unknown).
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
import { evaluateWatch } from '../api/_watch-diff.js';

const ROWS = JSON.parse(readFileSync(new URL('./fixtures/schedule-board-rows.json', import.meta.url), 'utf8'));
const SCHED_DEP = ROWS.UA2278_SFO_departures.time.scheduled.departure; // 2026-09-27T05:35Z
const NOW_MS = (SCHED_DEP + 3 * 3600) * 1000; // three hours after it was due out

function likelyCanceledRow() {
  const row = structuredClone(ROWS.UA2278_SFO_departures);
  row.status = {
    icon: 'yellow', live: false, text: 'canceleduncertain',
    generic: { type: 'canceled_uncertain', status: { text: 'canceled_uncertain', diverted: false } },
  };
  return row;
}
// A watch pinned to this leg before it was due out (what the cron holds by now).
const watching = () => evaluateWatch(
  { flight: 'UA2278' },
  { success: true, status: 'expected', origin: { iata: 'SFO' }, destination: { iata: 'ORD' }, departure: { gate: { scheduled: new Date(SCHED_DEP * 1000).toISOString() } }, arrival: {} },
  (SCHED_DEP - 3600) * 1000,
).next;
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
let n = 0;
const cronReq = () => ({
  method: 'GET',
  headers: { origin: 'http://localhost:3000', 'x-real-ip': `10.8.0.${++n}` },
  query: { flight: 'UA2278', officialFallback: '0' },
});

describe('/api/flight-times snapshot tier — seen-airborne override', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers({ toFake: ['Date'], now: NOW_MS });
    __resetFlightTimesCache();
    resetMirroredQuotaBlock();
    snapshotMocks.loadScheduleSnapshot.mockReset();
    snapshotMocks.loadScheduleSnapshot.mockImplementation(async (k) =>
      k === key('SFO', 'departures') ? { data: { dir: 'departures', flights: [likelyCanceledRow()] } } : null);
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('flightaware.com')) return { ok: false, status: 403, text: async () => 'blocked' };
      throw new Error(`unexpected fetch: ${url}`);
    });
  });
  afterEach(() => { vi.useRealTimers(); });

  it('seen flying from SFO → departed, never a cancellation push', async () => {
    sightingsMock.map = new Map([['UA2278', { reg: 'N76265', origin: 'SFO', dest: 'ORD', seenAtMs: (SCHED_DEP + 2 * 3600) * 1000, airborneAtMs: (SCHED_DEP + 2 * 3600) * 1000 }]]);
    const res = createRes();
    await handler(cronReq(), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.source).toBe('schedule-cache');
    expect(res.body.status).toBe('departed');
    expect(res.body.cancelled).toBe(false);
    const d = evaluateWatch(watching(), res.body, NOW_MS);
    expect(d.kind).toBe('departed');
    expect(d.title).toBe('UA2278 departed SFO');
  });

  it('unseen → still canceled_uncertain, which the push engine does not announce', async () => {
    sightingsMock.map = new Map();
    const res = createRes();
    await handler(cronReq(), res);
    expect(res.body.status).toBe('canceled_uncertain');
    expect(res.body.cancelled).toBe(false);
    const d = evaluateWatch(watching(), res.body, NOW_MS);
    expect(d.notify).toBe(false);
    expect(d.next.lastStatus).toBe('expected');
  });

  it('held on the taxiway (ground sightings only) → still canceled_uncertain, no push', async () => {
    sightingsMock.map = new Map([['UA2278', { reg: 'N76265', origin: 'SFO', dest: 'ORD', seenAtMs: (SCHED_DEP + 2 * 3600) * 1000, airborneAtMs: null }]]);
    const res = createRes();
    await handler(cronReq(), res);
    expect(res.body.status).toBe('canceled_uncertain');
    expect(evaluateWatch(watching(), res.body, NOW_MS).notify).toBe(false);
  });

  it('a sighting from another origin does not un-cancel it', async () => {
    sightingsMock.map = new Map([['UA2278', { reg: 'N76265', origin: 'LAX', dest: 'ORD', seenAtMs: (SCHED_DEP + 2 * 3600) * 1000, airborneAtMs: (SCHED_DEP + 2 * 3600) * 1000 }]]);
    const res = createRes();
    await handler(cronReq(), res);
    expect(res.body.status).toBe('canceled_uncertain');
  });
});
