import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  __resetDelayPredictionsForTests,
  fetchPredictionBodies,
  isDelayPredictionsEnabled,
  logDelayPredictions,
} from '../api/_delay-predictions.js';
import { __resetFlightHistoryForTests, startFlightHistoryRun } from '../api/_flight-history.js';
import { PREDICTION_MODEL_VERSION } from '../src/lib/delay-prediction.js';

const NOW_MS = Date.parse('2026-11-10T19:00:00Z');
const NOW_MIN = NOW_MS / 60000;

/** A flight_history row departing EWR `inMin` minutes from NOW. */
const leg = (no, inMin, extra = {}) => ({
  flight_no: no, service_date: '2026-11-10', origin: 'EWR', dest: 'ORD',
  sched_dep: NOW_MIN + inMin, sched_arr: NOW_MIN + inMin + 150,
  dep_at: NOW_MIN + inMin + 20, dep_basis: 'estimate', arr_at: null, arr_basis: null, airborne_at: null,
  status: 'delayed', outcome: 'unknown', final: false, registration: null, aircraft_code: 'B39M', operator: 'UAL',
  on_dep_board: true, on_arr_board: false, last_seen: NOW_MIN - 15, ...extra,
});

/** flight_history + flight_delay_predictions behind the builder subset both writers use. */
function fakeSupabase({ history = [], fail = {} } = {}) {
  const predictions = new Map();
  const calls = { historySelect: [], predictionUpsert: [] };
  const filterBuilder = (rows, onRun) => {
    const filters = [];
    const b = {
      eq(c, v) { filters.push((r) => r[c] === v); return b; },
      in(c, vs) { filters.push((r) => vs.includes(r[c])); return b; },
      gte(c, v) { filters.push((r) => r[c] >= v); return b; },
      lte(c, v) { filters.push((r) => r[c] <= v); return b; },
      lt(c, v) { filters.push((r) => r[c] < v); return b; },
      limit() { return b; },
      abortSignal() { return b; },
      then(resolve) { onRun(); resolve(fail.select ? { data: null, error: fail.select } : { data: rows().filter((r) => filters.every((f) => f(r))), error: null }); },
    };
    return b;
  };
  return {
    predictions,
    calls,
    from(name) {
      if (name === 'flight_history') {
        return {
          select: () => filterBuilder(() => history, () => calls.historySelect.push(1)),
          upsert: () => ({ abortSignal() { return this; }, then(resolve) { resolve({ error: null }); } }),
        };
      }
      expect(name).toBe('flight_delay_predictions');
      return {
        upsert(rows, opts) {
          const b = {
            abortSignal() { return b; },
            then(resolve) {
              calls.predictionUpsert.push({ rows: rows.length, opts });
              if (fail.insert) return resolve({ error: fail.insert });
              for (const r of rows) {
                const key = `${r.service_date}|${r.flight_no}|${r.origin}|${r.dest}`;
                if (!predictions.has(key)) predictions.set(key, r); // ignoreDuplicates
              }
              resolve({ error: null });
            },
          };
          return b;
        },
      };
    },
  };
}

const bodies = () => ({ faa: [], metar: [], nas: { planned: [] }, irops: { hubMetrics: {} } });
const withSignal = (b) => b;

beforeEach(() => {
  __resetDelayPredictionsForTests();
  __resetFlightHistoryForTests();
  mocks.getSupabaseAdmin.mockReset();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  delete process.env.DELAY_PREDICTIONS_ENABLED;
  delete process.env.FLIGHT_HISTORY_ENABLED;
  vi.restoreAllMocks();
});

describe('logDelayPredictions', () => {
  it('logs each due leg once, from the cached endpoints, with its version and gaps', async () => {
    const db = fakeSupabase({ history: [leg('UA1', 130), leg('UA2', 60), leg('UA3', 300), leg('UA4', 140, { outcome: 'operated', dep_basis: 'gate' })] });
    const fetchBodies = vi.fn(async () => bodies());
    const summary = await logDelayPredictions({ supabase: db, nowMs: NOW_MS, withSignal, fetchBodies });

    // The select already narrows to the window and to not-yet-operated legs: UA1 only.
    expect(summary).toMatchObject({ status: 'ok', due: 1, logged: 1, ineligible: 0, statements: 2 });
    expect(fetchBodies).toHaveBeenCalledTimes(1);
    const [record] = [...db.predictions.values()];
    expect(record).toMatchObject({ flight_no: 'UA1', lead_min: 130, row_age_min: 15, model_version: PREDICTION_MODEL_VERSION, same_inputs_as_board: false });
    expect(record.inputs_missing).toBe('origin_weather,dest_weather'); // the empty METAR answer
    expect(db.calls.predictionUpsert[0].opts).toEqual({ onConflict: 'service_date,flight_no,origin,dest', ignoreDuplicates: true });
  });

  it('a second pass does not rewrite a logged prediction', async () => {
    const db = fakeSupabase({ history: [leg('UA1', 130)] });
    await logDelayPredictions({ supabase: db, nowMs: NOW_MS, withSignal, fetchBodies: async () => bodies() });
    const first = { ...[...db.predictions.values()][0] };
    await logDelayPredictions({ supabase: db, nowMs: NOW_MS + 30 * 60000, withSignal, fetchBodies: async () => bodies() });
    expect([...db.predictions.values()]).toEqual([first]);
  });

  it('nothing due → no endpoint request, no insert', async () => {
    const db = fakeSupabase({ history: [leg('UA2', 60)] });
    const fetchBodies = vi.fn(async () => bodies());
    const summary = await logDelayPredictions({ supabase: db, nowMs: NOW_MS, withSignal, fetchBodies });
    expect(summary).toMatchObject({ due: 0, logged: 0, statements: 1 });
    expect(fetchBodies).not.toHaveBeenCalled();
    expect(db.calls.predictionUpsert).toHaveLength(0);
  });

  it('kill switch: DELAY_PREDICTIONS_ENABLED=0 reads nothing', async () => {
    process.env.DELAY_PREDICTIONS_ENABLED = 'off';
    expect(isDelayPredictionsEnabled()).toBe(false);
    const db = fakeSupabase({ history: [leg('UA1', 130)] });
    const summary = await logDelayPredictions({ supabase: db, nowMs: NOW_MS, withSignal, fetchBodies: async () => bodies() });
    expect(summary.status).toBe('disabled');
    expect(db.calls.historySelect).toHaveLength(0);
  });

  it('errors are swallowed: select, insert, missing table, a throwing fetch', async () => {
    const selectFail = fakeSupabase({ history: [leg('UA1', 130)], fail: { select: { message: 'timeout' } } });
    await expect(logDelayPredictions({ supabase: selectFail, nowMs: NOW_MS, withSignal, fetchBodies: async () => bodies() }))
      .resolves.toMatchObject({ status: 'error' });

    const insertFail = fakeSupabase({ history: [leg('UA1', 130)], fail: { insert: { message: 'boom', code: '23514' } } });
    await expect(logDelayPredictions({ supabase: insertFail, nowMs: NOW_MS, withSignal, fetchBodies: async () => bodies() }))
      .resolves.toMatchObject({ status: 'error', logged: 0 });

    const missing = fakeSupabase({ history: [leg('UA1', 130)], fail: { insert: { message: 'relation "public.flight_delay_predictions" does not exist', code: '42P01' } } });
    await expect(logDelayPredictions({ supabase: missing, nowMs: NOW_MS, withSignal, fetchBodies: async () => bodies() }))
      .resolves.toMatchObject({ status: 'table_missing' });

    const db = fakeSupabase({ history: [leg('UA1', 130)] });
    await expect(logDelayPredictions({ supabase: db, nowMs: NOW_MS, withSignal, fetchBodies: async () => { throw new Error('dns'); } }))
      .resolves.toMatchObject({ status: 'error' });
  });
});

describe('fetchPredictionBodies — the dashboard\'s own URLs, every failure a null', () => {
  it('asks /api/faa, the nine-hub /api/metar, /api/nas and /api/irops with Accept: application/json', async () => {
    const seen = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      seen.push({ url: String(url), accept: init?.headers?.Accept });
      if (String(url).includes('/api/nas')) throw new Error('down');
      if (String(url).includes('/api/irops')) return { ok: false, status: 502, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => [] };
    });
    const out = await fetchPredictionBodies();
    expect(seen.map((s) => new URL(s.url).pathname + new URL(s.url).search).sort()).toEqual([
      '/api/faa', '/api/irops', '/api/metar?ids=KEWR,KIAH,KORD,KDEN,KSFO,KLAX,KIAD,RJAA,PGUM', '/api/nas',
    ]);
    expect(seen.every((s) => s.accept === 'application/json')).toBe(true);
    expect(out).toEqual({ faa: [], metar: [], nas: null, irops: null });
  });
});

describe('the archive run hands over to predictions last', () => {
  it('finish() logs the due predictions after the boards, inside the same summary line', async () => {
    const db = fakeSupabase({ history: [leg('UA1', 130)] });
    mocks.getSupabaseAdmin.mockResolvedValue(db);
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => ({ ok: true, status: 200, json: async () => [] }));
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const run = startFlightHistoryRun({ deadlineMs: Date.now() + 60_000, now: () => NOW_MS });
    const summary = await run.finish();
    expect(summary.predictions).toMatchObject({ status: 'ok', due: 1, logged: 1 });
    expect(db.predictions.size).toBe(1);
    const lines = log.mock.calls.map(([l]) => String(l)).filter((l) => l.startsWith('flight-history:'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('predictions=ok:1/1');
  });

  it('FLIGHT_HISTORY_ENABLED=0 stops predictions too (they read the archive)', async () => {
    process.env.FLIGHT_HISTORY_ENABLED = '0';
    const db = fakeSupabase({ history: [leg('UA1', 130)] });
    mocks.getSupabaseAdmin.mockResolvedValue(db);
    const summary = await startFlightHistoryRun({ deadlineMs: Date.now() + 60_000 }).finish();
    expect(summary.predictions).toBeUndefined();
    expect(db.calls.historySelect).toHaveLength(0);
  });

  it('a run past its deadline logs nothing', async () => {
    const db = fakeSupabase({ history: [leg('UA1', 130)] });
    mocks.getSupabaseAdmin.mockResolvedValue(db);
    const summary = await startFlightHistoryRun({ deadlineMs: Date.now() - 1 }).finish();
    expect(summary.predictions).toBeUndefined();
    expect(db.predictions.size).toBe(0);
  });
});
