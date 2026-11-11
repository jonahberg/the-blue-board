// GET /api/flight — the flight page's data. The contract under test is mostly what it must NOT do:
// it reads the flight_history archive, at most the leg's own schedule snapshots, the reg_sightings
// cache and the stored Starlink roster — and nothing else: no provider, no fetch, no write, no
// refresh. Supabase is faked at its one seam (@supabase/supabase-js createClient, as in
// tests/hub-board-api.test.js) so the real loadScheduleSnapshot() runs and every method the endpoint
// calls on the client is recorded.
import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const supa = vi.hoisted(() => ({ snapshots: new Map(), history: [], roster: null, calls: [], errors: {} }));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from(table) {
      const call = { table, methods: [], filters: {} };
      supa.calls.push(call);
      const builder = {
        select(cols) { call.methods.push('select'); call.cols = cols; return builder; },
        eq(col, val) { call.methods.push('eq'); call.filters[col] = val; return builder; },
        gt(col, val) { call.methods.push('gt'); call.filters[`>${col}`] = val; return builder; },
        gte(col, val) { call.methods.push('gte'); call.filters[`>=${col}`] = val; return builder; },
        order() { call.methods.push('order'); return builder; },
        limit(n) {
          call.methods.push('limit');
          call.limit = n;
          if (supa.errors[table]) return Promise.resolve({ data: null, error: supa.errors[table] });
          if (table === 'schedule_snapshots') {
            const row = supa.snapshots.get(call.filters.cache_key);
            return Promise.resolve({ data: row ? [row] : [], error: null });
          }
          if (table === 'starlink_snapshot') {
            return Promise.resolve({ data: supa.roster ? [{ aircraft: supa.roster }] : [], error: null });
          }
          if (table === 'flight_history') {
            const f = call.filters;
            const rows = supa.history.filter((r) =>
              (f.flight_no === undefined || r.flight_no === f.flight_no)
              && (f.registration === undefined || r.registration === f.registration)
              && (f['>=service_date'] === undefined || r.service_date >= f['>=service_date']));
            return Promise.resolve({ data: rows.slice(0, n), error: null });
          }
          return Promise.resolve({ data: [], error: null });
        },
      };
      for (const write of ['insert', 'upsert', 'update', 'delete', 'rpc']) {
        builder[write] = () => { call.methods.push(write); throw new Error(`/api/flight must never ${write}`); };
      }
      return builder;
    },
  }),
}));

const sightings = vi.hoisted(() => ({ map: new Map(), calls: 0 }));
vi.mock(process.cwd() + '/api/_reg-sightings.ts', () => ({
  awaitRegSightings: vi.fn(async () => { sightings.calls++; return sightings.map; }),
}));

import handler, {
  NOT_FOUND_CACHE_CONTROL,
  OK_CACHE_CONTROL,
  UNAVAILABLE_CACHE_CONTROL,
  __resetFlightForTests,
  loadFlightPayload,
} from '../api/flight.js';
import { __resetRateLimitersForTests } from '../api/_rate-limit.js';
import { D, ORD_DAY_START, historyRows, inAirCase, ua929Row } from './fixtures/flight-page-fixtures.js';
import { flightVerdict } from '../src/lib/flight-verdict.js';

function createRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
    end() { return this; },
  };
}
const makeReq = (query = { ident: 'UA929' }, overrides = {}) => ({ method: 'GET', headers: {}, query, ...overrides });
const call = async (req) => {
  const res = createRes();
  await handler(req, res);
  return res;
};
const ORD_DEP_KEY = `agg:ORD:departures:${ORD_DAY_START}`;
const snapshotRow = (flights, generatedAt = D - 3600) => ({ payload: { flights, meta: { generatedAt } }, refreshed_at: new Date((D - 3500) * 1000).toISOString() });
const reads = (table) => supa.calls.filter((c) => c.table === table);
const todayHistory = () => {
  const rows = historyRows(['2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11']);
  rows[3] = { ...rows[3], dep_at: null, dep_basis: null, status: 'expected', outcome: 'unknown', final: false };
  return rows;
};

let fetchSpy;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: (D + 2 * 3600) * 1000 });
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key');
  supa.snapshots.clear();
  supa.history = [];
  supa.roster = null;
  supa.calls.length = 0;
  supa.errors = {};
  sightings.map = new Map();
  sightings.calls = 0;
  __resetFlightForTests();
  __resetRateLimitersForTests();
  // Any network call at all is a failure of the zero-cost contract.
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    throw new Error('/api/flight must never call fetch');
  });
});
afterEach(() => {
  expect(fetchSpy).not.toHaveBeenCalled();
  for (const c of supa.calls) {
    expect(c.methods.every((m) => ['select', 'eq', 'gt', 'gte', 'order', 'limit'].includes(m)), `${c.table}: ${c.methods}`).toBe(true);
  }
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('GET /api/flight — request validation', () => {
  it('rejects anything but GET, foreign origins and malformed idents, never cacheably, before any read', async () => {
    const post = await call(makeReq({ ident: 'UA929' }, { method: 'POST' }));
    expect(post.statusCode).toBe(405);
    expect(post.headers['Cache-Control']).toBe('no-store');
    const foreign = await call(makeReq({ ident: 'UA929' }, { headers: { origin: 'https://evil.example' } }));
    expect(foreign.statusCode).toBe(403);
    for (const query of [{ ident: 'AA100' }, { ident: '' }, {}, { ident: 'UA12345' }, { ident: 'UA526H' }, { ident: "UA1' or 1=1" }]) {
      const res = await call(makeReq(query));
      expect(res.statusCode, JSON.stringify(query)).toBe(400);
      expect(res.headers['Cache-Control']).toBe('no-store');
    }
    expect(supa.calls).toEqual([]);
  });

  it('normalises ua929, UA 929 and UAL929 to UA929', async () => {
    for (const ident of ['ua929', 'UA 929', 'UAL929', '929']) {
      const res = await call(makeReq({ ident }));
      expect(res.statusCode).toBe(200);
      expect(res.body.ident).toBe('UA929');
    }
    // One archive read for all four: they are one flight, memoized.
    expect(reads('flight_history')).toHaveLength(1);
    expect(reads('flight_history')[0].filters.flight_no).toBe('UA929');
  });

  it('429s past 30 requests a minute from one IP, without caching the 429', async () => {
    for (let i = 0; i < 30; i++) expect((await call(makeReq())).statusCode).toBe(200);
    const limited = await call(makeReq());
    expect(limited.statusCode).toBe(429);
    expect(limited.headers['Cache-Control']).toBe('no-store');
  });
});

describe('GET /api/flight — stored data only', () => {
  it('a number the archive has never seen is not-found: one archive read, no snapshot read, 200', async () => {
    const res = await call(makeReq({ ident: 'UA9999' }));
    expect(res.statusCode).toBe(200);
    expect(res.headers['Cache-Control']).toBe(NOT_FOUND_CACHE_CONTROL);
    expect(res.body).toMatchObject({ v: 1, ident: 'UA9999', status: 'not-found', leg: null });
    expect(reads('flight_history')).toHaveLength(1);
    expect(reads('schedule_snapshots')).toEqual([]);
    expect(sightings.calls).toBe(0);
  });

  it('serves the leg from its own board: the archive names it, only its board is read', async () => {
    const { row } = inAirCase();
    supa.history = todayHistory();
    const tomorrows = ua929Row();
    tomorrows.time.scheduled = { departure: D + 86400, arrival: D + 86400 + 29400 };
    supa.snapshots.set(ORD_DEP_KEY, snapshotRow([tomorrows, row]));
    supa.roster = [{ tail: 'N686UA', fleet: 'Mainline', type: '767-300ER' }];
    supa.history.push({ flight_no: 'UA930', service_date: '2026-11-11', origin: 'LHR', dest: 'ORD', sched_dep: (D - 20 * 3600) / 60, sched_arr: (D - 11 * 3600) / 60, dep_at: (D - 20 * 3600) / 60 + 12, dep_basis: 'runway', arr_at: (D - 11 * 3600) / 60, arr_basis: 'gate', outcome: 'operated', final: true, registration: 'N686UA' });

    const res = await call(makeReq());
    expect(res.statusCode).toBe(200);
    expect(res.headers['Cache-Control']).toBe(OK_CACHE_CONTROL);
    expect(res.body.status).toBe('ok');
    expect(res.body.leg).toMatchObject({ source: 'board', dir: 'departures', hub: 'ORD', serviceDate: '2026-11-11', boardAt: D - 3600 });
    expect(res.body.leg.row.time.real.departure).toBe(row.time.real.departure);
    expect(flightVerdict(res.body.leg.row, D + 2 * 3600).state).toBe('in-air');

    // Exactly the leg's own board, once.
    expect(reads('schedule_snapshots').map((c) => c.filters.cache_key)).toEqual([ORD_DEP_KEY]);
    // The archive: the number (PK range), then the tail (date-bounded), both reads.
    expect(reads('flight_history').map((c) => c.filters.flight_no || c.filters.registration)).toEqual(['UA929', 'N686UA']);
    expect(res.body.history).toMatchObject({ origin: 'ORD', dest: 'LHR', today: '2026-11-11' });
    expect(res.body.history.rows.map((r) => r.service_date)).toEqual(['2026-11-11', '2026-11-10', '2026-11-09', '2026-11-08']);
    expect(res.body.tail.reg).toBe('N686UA');
    expect(res.body.tail.rows.map((r) => r.flight_no)).toContain('UA930');
    // Fleet file + stored Starlink roster.
    expect(res.body.aircraft).toMatchObject({ reg: 'N686UA', starlink: true, wifi: 'Starlink', source: 'fleet' });
    expect(reads('starlink_snapshot')).toHaveLength(1);
  });

  it('falls back to the archive row when the board snapshot is gone (never a 5xx, never an invention)', async () => {
    supa.history = todayHistory();
    const res = await call(makeReq());
    expect(res.body.status).toBe('ok');
    expect(res.body.leg.source).toBe('history');
    expect(res.body.leg.row.airport.origin.code.iata).toBe('ORD');
    expect(res.body.leg.row.time.scheduled.departure).toBe(D);
  });

  it('a number with only old archive rows is not-found, with when and where it last flew', async () => {
    supa.history = historyRows(['2026-11-06', '2026-11-07']);
    const res = await call(makeReq());
    expect(res.body.status).toBe('not-found');
    expect(res.body.lastSeen).toEqual({ date: '2026-11-07', origin: 'ORD', dest: 'LHR' });
    expect(res.body.history.rows).toHaveLength(2);
    // It looked once at today's board for that route, in case the archive lags the board.
    expect(reads('schedule_snapshots').map((c) => c.filters.cache_key)).toEqual([ORD_DEP_KEY]);
  });

  it('degrades to "unavailable" when Supabase is unconfigured or the archive read fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    supa.errors.flight_history = { message: 'boom' };
    const failed = await call(makeReq());
    expect(failed.statusCode).toBe(200);
    expect(failed.body.status).toBe('unavailable');
    expect(failed.headers['Cache-Control']).toBe(UNAVAILABLE_CACHE_CONTROL);

    __resetFlightForTests();
    supa.calls.length = 0;
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
    const res = await call(makeReq({ ident: 'UA1' }));
    expect(res.body.status).toBe('unavailable');
  });

  it('memoizes: junk query strings that bust the CDN do not multiply reads; the board is re-read only after 5 minutes', async () => {
    supa.history = todayHistory();
    supa.snapshots.set(ORD_DEP_KEY, snapshotRow([inAirCase().row]));
    await call(makeReq({ ident: 'UA929' }));
    await call(makeReq({ ident: 'UA929', z: '1' }));
    await call(makeReq({ ident: 'ua929', z: String(Math.random()) }));
    expect(reads('flight_history').filter((c) => c.filters.flight_no)).toHaveLength(1);
    expect(reads('schedule_snapshots')).toHaveLength(1);

    vi.setSystemTime((D + 2 * 3600 + 61) * 1000);
    await call(makeReq());
    expect(reads('flight_history').filter((c) => c.filters.flight_no)).toHaveLength(2);
    expect(reads('schedule_snapshots')).toHaveLength(1);
    vi.setSystemTime((D + 2 * 3600 + 5 * 60 + 2) * 1000);
    await call(makeReq());
    expect(reads('schedule_snapshots')).toHaveLength(2);
  });

  it('loadFlightPayload is the same payload the handler serves (the share card reuses it)', async () => {
    supa.history = todayHistory();
    const body = await loadFlightPayload('UA929', (D + 2 * 3600) * 1000);
    expect(body.status).toBe('ok');
    const res = await call(makeReq());
    expect(res.body).toBe(body);
  });
});

describe('the flight functions cannot reach a provider', () => {
  const ROOT = resolve(__dirname, '..');
  const IMPORT_RE = /(?:^|\n)\s*(?:import|export)\s+(?:([^'"]*?)\s+from\s+)?['"]([^'"]+)['"]/g;
  const DYNAMIC_RE = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;
  const resolveSpec = (from, spec) => {
    const base = resolve(dirname(from), spec);
    const candidates = [base, base.replace(/\.js$/, '.ts')];
    return candidates.find((c) => existsSync(c) && statSync(c).isFile()) ?? null;
  };
  const graph = (entry) => {
    const seen = new Set();
    const stack = [join(ROOT, entry)];
    while (stack.length) {
      const file = stack.pop();
      if (seen.has(file)) continue;
      seen.add(file);
      const src = readFileSync(file, 'utf8');
      const specs = [...src.matchAll(IMPORT_RE)]
        .filter((m) => !/^\s*type\b/.test(m[1] || '') && !/^import\s+type\b/.test(m[0].trim()))
        .map((m) => m[2]);
      specs.push(...[...src.matchAll(DYNAMIC_RE)].map((m) => m[1]));
      for (const spec of specs) {
        if (!spec.startsWith('.')) continue;
        const next = resolveSpec(file, spec);
        if (next) stack.push(next);
      }
    }
    return [...seen].map((f) => relative(ROOT, f));
  };
  const FORBIDDEN = [
    'api/schedule.ts',
    'api/_schedule-aerodatabox.ts',
    'api/_cost-state.ts',
    'api/flight-times.ts',
    'api/irops.ts',
    'api/faa.ts',
    'api/fr24-feed.ts',
    'api/fr24-flight.ts',
    'api/_official-fr24.ts',
    'api/_fr24-scraper-transport.ts',
    'api/_united-feed.ts',
    'api/delay-explain.ts',
    'api/cron/warm-schedules.ts',
  ];

  it.each(['api/flight.ts', 'api/flight-page.ts', 'api/flight-card.ts'])('%s imports none of the metered or refreshing modules', (entry) => {
    const reachable = graph(entry);
    for (const forbidden of FORBIDDEN) {
      expect(reachable, `${forbidden} must be unreachable from ${entry}`).not.toContain(forbidden);
    }
  });

  it('api/flight.ts never fetches, writes or asks for a refresh in its own source', () => {
    const src = readFileSync(join(ROOT, 'api', 'flight.ts'), 'utf8').replace(/\/\/.*$/gm, '');
    expect(src).not.toMatch(/\bfetch\(/);
    expect(src).not.toMatch(/saveScheduleSnapshot|upsert|\.insert\(|\.update\(|forceRefresh|waitUntil|kickRegSightingsRefresh|recordFeedSightings/);
  });
});
