import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The cron's flight-history hook (api/_flight-history.ts): every board the warm fetched is handed to
// the archive, and the archive can neither fail the run nor change what the run reports.
const db = vi.hoisted(() => ({ rows: new Map(), upserts: 0, throwOnArchive: false }));

/** flight_history behaves like a table; every other table (spend state, …) answers empty. */
function client() {
  const empty = () => {
    const p = new Proxy(() => {}, {
      get: (_t, prop) => (prop === 'then' ? (resolve) => resolve({ data: [], error: null }) : () => p),
      apply: () => p,
    });
    return p;
  };
  return {
    from(name) {
      if (name !== 'flight_history') return empty();
      if (db.throwOnArchive) throw new Error('archive client exploded');
      return {
        select() {
          const filters = [];
          const b = {
            eq(c, v) { filters.push((r) => r[c] === v); return b; },
            in(c, vs) { filters.push((r) => vs.includes(r[c])); return b; },
            gte(c, v) { filters.push((r) => r[c] >= v); return b; },
            lte(c, v) { filters.push((r) => r[c] <= v); return b; },
            lt(c, v) { filters.push((r) => r[c] < v); return b; },
            limit() { return b; },
            abortSignal() { return b; },
            then(resolve) { resolve({ data: [...db.rows.values()].filter((r) => filters.every((f) => f(r))), error: null }); },
          };
          return b;
        },
        upsert(rows) {
          const b = {
            abortSignal() { return b; },
            then(resolve) {
              db.upserts++;
              for (const r of rows) db.rows.set(`${r.flight_no}|${r.service_date}|${r.origin}|${r.dest}`, r);
              resolve({ error: null });
            },
          };
          return b;
        },
      };
    },
  };
}

vi.mock(process.cwd() + '/api/_schedule-snapshots.ts', () => ({
  getSupabaseAdmin: vi.fn(async () => client()),
  loadScheduleSnapshot: vi.fn(async () => null),
  saveScheduleSnapshot: vi.fn(async () => {}),
  cleanupExpiredSnapshots: vi.fn(async () => {}),
}));

import handler from '../api/cron/warm-schedules.js';
import { __resetAlertThrottleForTests } from '../api/_alert.js';
import { __resetAdbSpendForTests } from '../api/_cost-state.js';
import { __resetFlightHistoryForTests } from '../api/_flight-history.js';

const SECRET = 'test-cron-secret-1234';
const createReq = () => ({ method: 'GET', headers: { authorization: `Bearer ${SECRET}` } });
const createRes = () => ({
  statusCode: 200,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(payload) { this.body = payload; return this; },
});

/** /api/schedule answers each warm with a one-flight board belonging to the requested hub/dir. */
function mockFetch() {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
    const u = new URL(String(url));
    if (!u.pathname.includes('/api/schedule')) {
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ ok: true }) };
    }
    const hub = u.searchParams.get('hub');
    const dir = u.searchParams.get('dir');
    const ts = Number(u.searchParams.get('timestamp'));
    const other = hub === 'DEN' ? 'MSP' : 'DEN';
    const flight = {
      identification: { number: { default: 'UA777' }, callsign: 'UAL777' },
      status: { generic: { status: { text: 'scheduled', diverted: false }, type: '' }, text: 'expected', icon: '', live: false },
      time: { scheduled: { departure: ts + 10 * 3600, arrival: ts + 12 * 3600 }, real: { departure: null, arrival: null }, estimated: { departure: null, arrival: null } },
      airport: dir === 'departures'
        ? { origin: { code: { iata: hub } }, destination: { code: { iata: other } } }
        : { origin: { code: { iata: other } }, destination: { code: { iata: hub } } },
      aircraft: { model: { code: '', text: '' }, registration: '' },
      _source: { provider: 'aerodatabox', timeSource: {} },
    };
    const body = { cached: false, stale: false, partial: false, total: 1, flights: [flight], meta: { generatedAt: Math.floor(Date.now() / 1000) } };
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => body };
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  // Pin the clock (Date only; timers stay real). The fixture's one flight per board leaves at
  // 10:00 hub-local, and the prediction step picks up flights 90–155 minutes out, so on the real
  // clock this file failed for about an hour a day per hub ("due: 2", Nov 11 2026 22:30Z, when
  // 10:00 in Guam and Tokyo was two hours away). At 08:00Z no hub's 10:00 is inside that window.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-10T08:00:00Z'));
  db.rows.clear();
  db.upserts = 0;
  db.throwOnArchive = false;
  process.env.CRON_SECRET = SECRET;
  process.env.SCHEDULE_WARM_DELAY_MS = '0';
  process.env.SCHEDULE_WARM_TASKS_PER_RUN = '3';
  process.env.SCHEDULE_WARM_EXTRA_ARRIVALS = '0';
  __resetAlertThrottleForTests();
  __resetAdbSpendForTests();
  __resetFlightHistoryForTests();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  delete process.env.CRON_SECRET;
  delete process.env.SCHEDULE_WARM_DELAY_MS;
  delete process.env.SCHEDULE_WARM_TASKS_PER_RUN;
  delete process.env.SCHEDULE_WARM_EXTRA_ARRIVALS;
  delete process.env.FLIGHT_HISTORY_ENABLED;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('warm-schedules → flight history', () => {
  it('every board the run fetched is archived, with no fetch of its own', async () => {
    const fetchSpy = mockFetch();
    const res = createRes();
    await handler(createReq(), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.scheduleWarmed).toBe(3);
    expect(res.body.flightHistory).toMatchObject({ status: 'ok', boards: 3, inserted: 3, errors: 0 });
    expect(db.rows.size).toBe(3);
    // The archive adds no HTTP request: only the warms and the run's existing fetches.
    const scheduleCalls = fetchSpy.mock.calls.filter(([u]) => String(u).includes('/api/schedule'));
    expect(scheduleCalls).toHaveLength(3);
    for (const [u] of fetchSpy.mock.calls) expect(String(u)).not.toMatch(/flight[-_]history/);
    // The archive summary stays out of the per-board results the alerting reads.
    expect(Object.keys(res.body.results)).not.toContain('flightHistory');
    // Nothing departs 90–155 min from now in these boards, so the prediction step asked no endpoint.
    expect(res.body.flightHistory.predictions).toMatchObject({ status: 'ok', due: 0 });
    for (const [u] of fetchSpy.mock.calls) expect(String(u)).not.toMatch(/\/api\/(faa|metar|nas|irops)/);
  });

  it('an archive that throws changes nothing the run reports', async () => {
    mockFetch();
    const baseline = createRes();
    await handler(createReq(), baseline);

    db.throwOnArchive = true;
    db.rows.clear();
    const res = createRes();
    await handler(createReq(), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.scheduleWarmed).toBe(baseline.body.scheduleWarmed);
    expect(res.body.results).toEqual(baseline.body.results);
    expect(res.body.flightHistory).toMatchObject({ status: 'error' });
    expect(db.rows.size).toBe(0);
  });

  it('FLIGHT_HISTORY_ENABLED=0 leaves the table alone', async () => {
    process.env.FLIGHT_HISTORY_ENABLED = '0';
    mockFetch();
    const res = createRes();
    await handler(createReq(), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.flightHistory.status).toBe('disabled');
    expect(db.upserts).toBe(0);
  });
});
