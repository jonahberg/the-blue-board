import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The writer reaches Supabase only through getSupabaseAdmin (api/_schedule-snapshots.ts) and the
// sightings ledger only through awaitRegSightings (api/_reg-sightings.ts); both are stubbed here.
const mocks = vi.hoisted(() => ({
  getSupabaseAdmin: vi.fn(async () => null),
  awaitRegSightings: vi.fn(async () => new Map()),
}));
vi.mock(process.cwd() + '/api/_schedule-snapshots.ts', () => ({
  getSupabaseAdmin: mocks.getSupabaseAdmin,
  loadScheduleSnapshot: vi.fn(async () => null),
  saveScheduleSnapshot: vi.fn(async () => {}),
  cleanupExpiredSnapshots: vi.fn(async () => {}),
}));
vi.mock(process.cwd() + '/api/_reg-sightings.ts', () => ({ awaitRegSightings: mocks.awaitRegSightings }));

import {
  FLIGHT_HISTORY_BATCH_ROWS,
  __resetFlightHistoryForTests,
  isFlightHistoryEnabled,
  startFlightHistoryRun,
} from '../api/_flight-history.js';
import { getStartOfHubDay } from '../src/lib/hubTz.js';

const H = 3600;
const NOW = new Date('2026-11-09T18:00:00Z');
const ORD_DAY = getStartOfHubDay('ORD', -1, NOW);
const min = (sec) => Math.floor(sec / 60);
const KEY = ['flight_no', 'service_date', 'origin', 'dest'];
const keyOf = (r) => KEY.map((k) => r[k]).join('|');

/**
 * An in-memory flight_history behind the subset of the supabase-js builder the writer uses:
 * select().eq().in().in() and upsert(rows, {onConflict}), each awaitable and abortable. `fail`,
 * `hang` and `throwOn` inject the failure modes.
 */
function fakeSupabase({ fail = {}, hang = false, throwOn = null } = {}) {
  const table = new Map();
  const calls = { select: [], upsert: [] };
  const settle = (signal, result) => {
    if (!hang) return Promise.resolve(result);
    return new Promise((resolve) => {
      signal?.addEventListener('abort', () => resolve({ data: null, error: { message: 'AbortError: aborted', code: '' } }));
    });
  };
  const client = {
    table,
    calls,
    from(name) {
      if (throwOn === 'from') throw new Error('client exploded');
      expect(name).toBe('flight_history');
      return {
        select(columns) {
          const filters = [];
          let signal;
          const builder = {
            eq(col, val) { filters.push((r) => r[col] === val); return builder; },
            in(col, vals) { filters.push((r) => vals.includes(r[col])); return builder; },
            abortSignal(s) { signal = s; return builder; },
            then(resolve, reject) {
              calls.select.push({ columns, filters: filters.length });
              const result = fail.select
                ? { data: null, error: fail.select }
                : { data: [...table.values()].filter((r) => filters.every((f) => f(r))).map((r) => ({ ...r })), error: null };
              return settle(signal, result).then(resolve, reject);
            },
          };
          return builder;
        },
        upsert(rows, opts) {
          let signal;
          const builder = {
            abortSignal(s) { signal = s; return builder; },
            then(resolve, reject) {
              calls.upsert.push({ rows: rows.length, opts });
              if (fail.upsert) return settle(signal, { error: fail.upsert }).then(resolve, reject);
              expect(opts.onConflict).toBe('flight_no,service_date,origin,dest');
              for (const r of rows) table.set(keyOf(r), { ...r });
              return settle(signal, { error: null }).then(resolve, reject);
            },
          };
          return builder;
        },
      };
    },
  };
  return client;
}

const DEPARTED = { generic: { status: { text: 'departed', diverted: false }, type: '' }, text: 'departed', icon: 'green', live: true };
const ARRIVED = { generic: { status: { text: 'landed', diverted: false }, type: '' }, text: 'arrived', icon: 'green', live: false };
const LIKELY = { generic: { status: { text: 'canceled_uncertain', diverted: false }, type: 'canceled_uncertain' }, text: 'canceleduncertain', icon: 'yellow', live: false };

function flight({ no = 'UA100', o = 'ORD', d = 'EWR', sd, sa, rd = null, ra = null, ed = null, ea = null, status, reg = '', ts } = {}) {
  return {
    identification: { number: { default: no }, callsign: `UAL${no.slice(2)}` },
    status: status ?? { generic: { status: { text: 'scheduled', diverted: false }, type: '' }, text: 'expected', icon: '', live: false },
    time: { scheduled: { departure: sd ?? null, arrival: sa ?? null }, real: { departure: rd, arrival: ra }, estimated: { departure: ed, arrival: ea } },
    airport: { origin: { code: { iata: o } }, destination: { code: { iata: d } } },
    aircraft: { model: { code: '', text: '' }, registration: reg },
    _source: { provider: 'aerodatabox', timeSource: ts ?? { hasRunwayDep: true, gateDistinctDep: false, hasRunwayArr: true, gateDistinctArr: false } },
  };
}
const board = (flights, generatedAt) => ({ flights, meta: { generatedAt }, total: flights.length });

const ordDepartures = (generatedAt = ORD_DAY + 9 * H) => board([
  flight({ sd: ORD_DAY + 8 * H, sa: ORD_DAY + 10 * H, rd: ORD_DAY + 8 * H + 900, ea: ORD_DAY + 10 * H + 600, status: DEPARTED, reg: 'N12345', ts: { hasRunwayDep: true, gateDistinctDep: true } }),
], generatedAt);
const ewrArrivals = (generatedAt = ORD_DAY + 11 * H) => board([
  flight({ sd: ORD_DAY + 8 * H, sa: ORD_DAY + 10 * H, rd: ORD_DAY + 8 * H + 960, ra: ORD_DAY + 10 * H + 1200, status: ARRIVED, reg: 'N12345', ts: { hasRunwayDep: true, gateDistinctDep: false, hasRunwayArr: true, gateDistinctArr: true } }),
], generatedAt);

const DEP = { hub: 'ORD', dir: 'departures' };
const ARR = { hub: 'EWR', dir: 'arrivals' };
const farDeadline = () => Date.now() + 60_000;

let logSpy;
let warnSpy;
let errorSpy;
beforeEach(() => {
  // The prediction step (api/_delay-predictions.ts) has its own suite; here only the archive runs.
  process.env.DELAY_PREDICTIONS_ENABLED = '0';
  __resetFlightHistoryForTests();
  mocks.getSupabaseAdmin.mockReset();
  mocks.awaitRegSightings.mockReset();
  mocks.awaitRegSightings.mockResolvedValue(new Map());
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  delete process.env.FLIGHT_HISTORY_ENABLED;
  delete process.env.DELAY_PREDICTIONS_ENABLED;
  vi.restoreAllMocks();
});

describe('flight-history writer — merge across boards', () => {
  it('a hub-to-hub leg from the departures board and the arrivals board lands as ONE row with both actuals', async () => {
    const db = fakeSupabase();
    mocks.getSupabaseAdmin.mockResolvedValue(db);
    const run = startFlightHistoryRun({ deadlineMs: farDeadline() });
    run.ingest(ordDepartures(), DEP);
    run.ingest(ewrArrivals(), ARR);
    const summary = await run.finish();

    expect(summary).toMatchObject({ status: 'ok', boards: 2, rows: 2, inserted: 1, updated: 1, errors: 0 });
    expect(db.table.size).toBe(1);
    const [row] = [...db.table.values()];
    expect(row).toMatchObject({
      flight_no: 'UA100', service_date: '2026-11-08', origin: 'ORD', dest: 'EWR',
      dep_at: min(ORD_DAY + 8 * H + 900), dep_basis: 'gate',
      arr_at: min(ORD_DAY + 10 * H + 1200), arr_basis: 'gate',
      outcome: 'operated', status: 'arrived', final: true, on_dep_board: true, on_arr_board: true,
    });
    // Every upserted row carries every column (PostgREST sends one column list per call).
    expect(Object.keys(row)).toHaveLength(20);
    // The select is narrowed to the board's hub + the batch's flight numbers + days.
    expect(db.calls.select.every((c) => c.filters === 3)).toBe(true);
    expect(logSpy.mock.calls.filter(([l]) => String(l).startsWith('flight-history:'))).toHaveLength(1);
  });

  it('never regresses: an older, thinner board after the facts are in rewrites nothing', async () => {
    const db = fakeSupabase();
    mocks.getSupabaseAdmin.mockResolvedValue(db);
    const first = startFlightHistoryRun({ deadlineMs: farDeadline() });
    first.ingest(ordDepartures(), DEP);
    first.ingest(ewrArrivals(), ARR);
    await first.finish();
    const settled = { ...[...db.table.values()][0] };

    // A degraded fallback copy of an EARLIER board: estimates only, no tail, still en route.
    const stale = board([flight({ sd: ORD_DAY + 8 * H, sa: ORD_DAY + 10 * H, ed: ORD_DAY + 8 * H + 300, ea: ORD_DAY + 10 * H + 300 })], ORD_DAY + 7 * H);
    const second = startFlightHistoryRun({ deadlineMs: farDeadline() });
    second.ingest(stale, ARR);
    const summary = await second.finish();

    expect(summary).toMatchObject({ unchanged: 1, updated: 0, inserted: 0 });
    expect(db.calls.upsert).toHaveLength(2); // the first run's two; none from the stale board
    expect([...db.table.values()][0]).toEqual(settled);
  });
});

describe('flight-history writer — canceled_uncertain and the seen-airborne evidence', () => {
  const likelyBoard = () => board([flight({ no: 'UA5300', d: 'GRR', sd: ORD_DAY + 14 * H, sa: ORD_DAY + 15 * H, status: LIKELY })], ORD_DAY + 16 * H);
  const sightings = (airborneSec) => new Map([['UA5300', {
    reg: 'N101SY', origin: 'ORD', dest: 'GRR', seenAtMs: (ORD_DAY + 14.6 * H) * 1000, airborneAtMs: airborneSec ? airborneSec * 1000 : null,
  }]]);

  it('with airborne evidence in the ledger the leg is stored as operated (provider word kept)', async () => {
    const db = fakeSupabase();
    mocks.getSupabaseAdmin.mockResolvedValue(db);
    mocks.awaitRegSightings.mockResolvedValue(sightings(ORD_DAY + 14.3 * H));
    const run = startFlightHistoryRun({ deadlineMs: farDeadline() });
    run.ingest(likelyBoard(), DEP);
    await run.finish();
    expect([...db.table.values()][0]).toMatchObject({ outcome: 'operated', status: 'canceleduncertain', airborne_at: min(ORD_DAY + 14.3 * H) });
    expect(mocks.awaitRegSightings).toHaveBeenCalledTimes(1);
  });

  it('without it (ground-only sighting) the leg stays canceled_unconfirmed', async () => {
    const db = fakeSupabase();
    mocks.getSupabaseAdmin.mockResolvedValue(db);
    mocks.awaitRegSightings.mockResolvedValue(sightings(null));
    const run = startFlightHistoryRun({ deadlineMs: farDeadline() });
    run.ingest(likelyBoard(), DEP);
    await run.finish();
    expect([...db.table.values()][0]).toMatchObject({ outcome: 'canceled_unconfirmed', airborne_at: null, final: false });
  });

  it('a sightings lookup that throws only costs the evidence, not the write', async () => {
    const db = fakeSupabase();
    mocks.getSupabaseAdmin.mockResolvedValue(db);
    mocks.awaitRegSightings.mockRejectedValue(new Error('ledger down'));
    const run = startFlightHistoryRun({ deadlineMs: farDeadline() });
    run.ingest(likelyBoard(), DEP);
    const summary = await run.finish();
    expect(summary).toMatchObject({ status: 'ok', inserted: 1 });
  });
});

describe('flight-history writer — duplicates and batching', () => {
  it('duplicate copies of one leg on a board are written once', async () => {
    const db = fakeSupabase();
    mocks.getSupabaseAdmin.mockResolvedValue(db);
    const real = flight({ sd: ORD_DAY + 8 * H, sa: ORD_DAY + 10 * H, rd: ORD_DAY + 12 * H, status: DEPARTED, ts: { hasRunwayDep: true, gateDistinctDep: true } });
    const retimed = flight({ sd: ORD_DAY + 12.5 * H, sa: ORD_DAY + 14.5 * H, rd: ORD_DAY + 12.5 * H, status: DEPARTED });
    const run = startFlightHistoryRun({ deadlineMs: farDeadline() });
    run.ingest(board([retimed, real], ORD_DAY + 13 * H), DEP);
    const summary = await run.finish();
    expect(summary).toMatchObject({ rows: 1, duplicates: 1, inserted: 1 });
    expect([...db.table.values()][0]).toMatchObject({ sched_dep: min(ORD_DAY + 8 * H), dep_basis: 'gate' });
  });

  it('a big board is written in bounded batches', async () => {
    const db = fakeSupabase();
    mocks.getSupabaseAdmin.mockResolvedValue(db);
    const flights = Array.from({ length: 450 }, (_, i) => flight({ no: `UA${1000 + i}`, d: 'LGA', sd: ORD_DAY + 6 * H + i * 60, sa: ORD_DAY + 8 * H + i * 60 }));
    const run = startFlightHistoryRun({ deadlineMs: farDeadline() });
    run.ingest(board(flights, ORD_DAY + 5 * H), DEP);
    const summary = await run.finish();
    expect(summary).toMatchObject({ rows: 450, inserted: 450, statements: 6 });
    expect(db.calls.upsert.map((c) => c.rows)).toEqual([FLIGHT_HISTORY_BATCH_ROWS, FLIGHT_HISTORY_BATCH_ROWS, 50]);
    expect(db.table.size).toBe(450);
  });

  it('an unchanged board is not rewritten', async () => {
    const db = fakeSupabase();
    mocks.getSupabaseAdmin.mockResolvedValue(db);
    const run = startFlightHistoryRun({ deadlineMs: farDeadline() });
    run.ingest(ordDepartures(), DEP);
    run.ingest(ordDepartures(), DEP);
    const summary = await run.finish();
    expect(summary).toMatchObject({ inserted: 1, unchanged: 1 });
    expect(db.calls.upsert).toHaveLength(1);
  });
});

describe('flight-history writer — bounded and best-effort', () => {
  it('kill switch: FLIGHT_HISTORY_ENABLED=0 touches nothing', async () => {
    process.env.FLIGHT_HISTORY_ENABLED = '0';
    expect(isFlightHistoryEnabled()).toBe(false);
    const db = fakeSupabase();
    mocks.getSupabaseAdmin.mockResolvedValue(db);
    const run = startFlightHistoryRun({ deadlineMs: farDeadline() });
    run.ingest(ordDepartures(), DEP);
    const summary = await run.finish();
    expect(summary.status).toBe('disabled');
    expect(mocks.getSupabaseAdmin).not.toHaveBeenCalled();
    expect(mocks.awaitRegSightings).not.toHaveBeenCalled();
    expect(db.calls.select).toHaveLength(0);
  });

  it('the switch is on unless set off, and accepts off/false/no', () => {
    for (const on of [undefined, '', '1', 'true', 'yes']) {
      if (on === undefined) delete process.env.FLIGHT_HISTORY_ENABLED; else process.env.FLIGHT_HISTORY_ENABLED = on;
      expect(isFlightHistoryEnabled()).toBe(true);
    }
    for (const off of ['0', 'off', 'FALSE', ' no ']) {
      process.env.FLIGHT_HISTORY_ENABLED = off;
      expect(isFlightHistoryEnabled()).toBe(false);
    }
  });

  it('time budget exhausted before a board: nothing is started', async () => {
    const db = fakeSupabase();
    mocks.getSupabaseAdmin.mockResolvedValue(db);
    const run = startFlightHistoryRun({ deadlineMs: Date.now() - 1 });
    run.ingest(ordDepartures(), DEP);
    const summary = await run.finish();
    expect(summary).toMatchObject({ status: 'budget', boardsSkipped: 1, statements: 0 });
    expect(db.calls.select).toHaveLength(0);
  });

  it('time budget exhausted mid-write: finish() stops waiting at the settle cap and aborts the statement', async () => {
    const db = fakeSupabase({ hang: true });
    mocks.getSupabaseAdmin.mockResolvedValue(db);
    const run = startFlightHistoryRun({ deadlineMs: farDeadline(), settleMs: 50 });
    run.ingest(ordDepartures(), DEP);
    run.ingest(ewrArrivals(), ARR);
    const started = Date.now();
    const summary = await run.finish();
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(summary.status).toBe('budget');
    expect(summary.waitedMs).toBeGreaterThanOrEqual(40);
    expect(db.calls.upsert).toHaveLength(0);
    // The aborted chain winds down without ever writing the second board.
    await new Promise((r) => setTimeout(r, 20));
    expect(db.calls.upsert).toHaveLength(0);
  });

  it('a select error is swallowed and its batch is NOT written blind', async () => {
    const db = fakeSupabase({ fail: { select: { message: 'canceling statement due to statement timeout', code: '57014' } } });
    mocks.getSupabaseAdmin.mockResolvedValue(db);
    const run = startFlightHistoryRun({ deadlineMs: farDeadline() });
    run.ingest(ordDepartures(), DEP);
    const summary = await run.finish();
    expect(summary).toMatchObject({ status: 'error', errors: 1, inserted: 0 });
    expect(summary.firstError).toMatch(/statement timeout/);
    expect(db.calls.upsert).toHaveLength(0);
  });

  it('an upsert error is swallowed and counted', async () => {
    const db = fakeSupabase({ fail: { upsert: { message: 'new row violates check constraint', code: '23514' } } });
    mocks.getSupabaseAdmin.mockResolvedValue(db);
    const run = startFlightHistoryRun({ deadlineMs: farDeadline() });
    run.ingest(ordDepartures(), DEP);
    await expect(run.finish()).resolves.toMatchObject({ status: 'error', errors: 1, inserted: 0 });
  });

  it('a client that throws is swallowed; ingest() itself never throws', async () => {
    mocks.getSupabaseAdmin.mockResolvedValue(fakeSupabase({ throwOn: 'from' }));
    const run = startFlightHistoryRun({ deadlineMs: farDeadline() });
    expect(() => run.ingest(ordDepartures(), DEP)).not.toThrow();
    expect(() => run.ingest(null, DEP)).not.toThrow();
    expect(() => run.ingest({ flights: 'nope' }, DEP)).not.toThrow();
    await expect(run.finish()).resolves.toMatchObject({ status: 'error', errors: 1 });
  });

  it('a missing table (sql/021 not applied) logs once and stops the run', async () => {
    const db = fakeSupabase({ fail: { select: { message: 'Could not find the table public.flight_history in the schema cache', code: 'PGRST205' } } });
    mocks.getSupabaseAdmin.mockResolvedValue(db);
    for (let i = 0; i < 2; i++) {
      const run = startFlightHistoryRun({ deadlineMs: farDeadline() });
      run.ingest(ordDepartures(), DEP);
      run.ingest(ewrArrivals(), ARR);
      const summary = await run.finish();
      expect(summary).toMatchObject({ status: 'table_missing', boardsSkipped: 1 });
    }
    expect(errorSpy.mock.calls.filter(([m]) => /sql\/021/.test(String(m)))).toHaveLength(1);
    expect(db.calls.select).toHaveLength(2); // one per run, then the run stops
  });

  it('no service-role env → a quiet no-op', async () => {
    mocks.getSupabaseAdmin.mockResolvedValue(null);
    const run = startFlightHistoryRun({ deadlineMs: farDeadline() });
    run.ingest(ordDepartures(), DEP);
    await expect(run.finish()).resolves.toMatchObject({ status: 'unconfigured', boards: 0 });
    expect(mocks.awaitRegSightings).not.toHaveBeenCalled();
  });
});
