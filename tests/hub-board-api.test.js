// GET /api/hub-board — the hub pages' departures board. The contract under test is mostly what it
// must NOT do: it reads the schedule snapshot the warm cron wrote and the reg_sightings cache, and
// nothing else — no provider, no fetch, no write, no refresh. Supabase is faked at its one seam
// (@supabase/supabase-js createClient, as in schedule-snapshots.test.js) so the real
// loadScheduleSnapshot() runs and every method the endpoint calls on the client is recorded.
import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const supa = vi.hoisted(() => ({ rows: new Map(), calls: [], readError: null }));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from(table) {
      const call = { table, methods: [] };
      supa.calls.push(call);
      const filters = {};
      const builder = {
        select(cols) { call.methods.push('select'); call.cols = cols; return builder; },
        eq(col, val) { call.methods.push('eq'); filters[col] = val; return builder; },
        gt(col, val) { call.methods.push('gt'); filters[`>${col}`] = val; return builder; },
        limit() {
          call.methods.push('limit');
          call.key = filters.cache_key;
          if (supa.readError) return Promise.resolve({ data: null, error: supa.readError });
          const row = supa.rows.get(filters.cache_key);
          return Promise.resolve({ data: row ? [row] : [], error: null });
        },
      };
      for (const write of ['insert', 'upsert', 'update', 'delete', 'rpc']) {
        builder[write] = () => { call.methods.push(write); throw new Error(`hub-board must never ${write}`); };
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
  EMPTY_CACHE_CONTROL,
  OK_CACHE_CONTROL,
  __resetHubBoardForTests,
} from '../api/hub-board.js';
import { __resetRateLimitersForTests } from '../api/_rate-limit.js';
import {
  NOW_SEC,
  ORD_DAY_START,
  ORD_TOMORROW_START,
  cst,
  lateEveningBoard,
  ordBoard,
  tomorrowBoard,
} from './fixtures/hub-board-board.js';

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
const makeReq = (query = { hub: 'ORD' }, overrides = {}) => ({ method: 'GET', headers: {}, query, ...overrides });
const call = async (req) => {
  const res = createRes();
  await handler(req, res);
  return res;
};
const snapshotRow = (payload, refreshedIso = '2026-11-10T20:30:00Z') => ({ payload, refreshed_at: refreshedIso });
const snapshotReads = () => supa.calls.filter((c) => c.table === 'schedule_snapshots');

let fetchSpy;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: NOW_SEC * 1000 });
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key');
  supa.rows.clear();
  supa.calls.length = 0;
  supa.readError = null;
  sightings.map = new Map();
  sightings.calls = 0;
  __resetHubBoardForTests();
  __resetRateLimitersForTests();
  // Any network call at all is a failure of the zero-spend contract.
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    throw new Error('hub-board must never call fetch');
  });
});
afterEach(() => {
  expect(fetchSpy).not.toHaveBeenCalled();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('GET /api/hub-board — request validation', () => {
  it('rejects anything but GET, foreign origins and unknown hubs, never cacheably, before any read', async () => {
    const post = await call(makeReq({ hub: 'ORD' }, { method: 'POST' }));
    expect(post.statusCode).toBe(405);
    expect(post.headers['Cache-Control']).toBe('no-store');

    const foreign = await call(makeReq({ hub: 'ORD' }, { headers: { origin: 'https://evil.example' } }));
    expect(foreign.statusCode).toBe(403);
    expect(foreign.headers['Cache-Control']).toBe('no-store');

    for (const query of [{ hub: 'JFK' }, { hub: '' }, {}, { hub: ['XYZ'] }, { hub: '../ORD' }]) {
      const res = await call(makeReq(query));
      expect(res.statusCode).toBe(400);
      expect(res.headers['Cache-Control']).toBe('no-store');
    }
    expect(supa.calls).toEqual([]);
  });

  it('accepts the site origin, localhost and a lower-case or repeated hub param', async () => {
    supa.rows.set(`agg:ORD:departures:${ORD_DAY_START}`, snapshotRow(ordBoard()));
    expect((await call(makeReq({ hub: 'ord' }, { headers: { origin: 'https://theblueboard.co' } }))).statusCode).toBe(200);
    expect((await call(makeReq({ hub: ['ord', 'den'] }, { headers: { origin: 'http://localhost:4321' } }))).body.hub).toBe('ORD');
  });

  it('429s past 30 requests a minute from one IP, without caching the 429', async () => {
    supa.rows.set(`agg:ORD:departures:${ORD_DAY_START}`, snapshotRow(ordBoard()));
    for (let i = 0; i < 30; i++) expect((await call(makeReq())).statusCode).toBe(200);
    const limited = await call(makeReq());
    expect(limited.statusCode).toBe(429);
    expect(limited.headers['Cache-Control']).toBe('no-store');
  });
});

describe('GET /api/hub-board — reads only the stored snapshot', () => {
  it('serves the next departures and the day totals from the snapshot row, CDN-cached', async () => {
    supa.rows.set(`agg:ORD:departures:${ORD_DAY_START}`, snapshotRow(ordBoard()));
    const res = await call(makeReq());
    expect(res.statusCode).toBe(200);
    expect(res.headers['Cache-Control']).toBe(OK_CACHE_CONTROL);
    expect(res.body).toMatchObject({
      v: 1,
      hub: 'ORD',
      dir: 'departures',
      timeZone: 'America/Chicago',
      status: 'ok',
      dayStart: ORD_DAY_START,
      generatedAt: NOW_SEC - 42 * 60,
      completeness: 1,
    });
    expect(res.body.flights[0].identification.number.default).toBe('UA104');
    expect(res.body.flights).toHaveLength(12);
    expect(res.body.totals).toMatchObject({ scheduled: 16, departed: 3, canceled: 1, likelyCanceled: 1 });

    // Exactly one read, of exactly today's key, and nothing but select/eq/gt/limit on the client.
    expect(snapshotReads().map((c) => c.key)).toEqual([`agg:ORD:departures:${ORD_DAY_START}`]);
    for (const c of supa.calls) expect(c.methods.every((m) => ['select', 'eq', 'gt', 'limit'].includes(m))).toBe(true);
  });

  it('answers an honest, briefly-cached empty state when there is no snapshot for today', async () => {
    const res = await call(makeReq({ hub: 'GUM' }));
    expect(res.statusCode).toBe(200);
    expect(res.headers['Cache-Control']).toBe(EMPTY_CACHE_CONTROL);
    expect(res.body).toMatchObject({ hub: 'GUM', status: 'empty', reason: 'no-snapshot', flights: [], totals: null, generatedAt: null });
    expect(res.body.timeZone).toBe('Pacific/Guam');
    expect(sightings.calls).toBe(0); // nothing to overlay, nothing waited for
  });

  it('degrades to the empty state when Supabase is unconfigured or the read fails — never a 5xx', async () => {
    supa.readError = { message: 'boom' };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const failed = await call(makeReq({ hub: 'DEN' }));
    expect(failed.statusCode).toBe(200);
    expect(failed.body.status).toBe('empty');
    expect(failed.headers['Cache-Control']).toBe(EMPTY_CACHE_CONTROL);
  });

  it('answers the empty state with no Supabase configured at all, without reading anything', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await call(makeReq({ hub: 'IAH' }));
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ status: 'empty', reason: 'no-snapshot', flights: [] });
    expect(res.headers['Cache-Control']).toBe(EMPTY_CACHE_CONTROL);
    expect(snapshotReads()).toEqual([]);
  });

  it('applies the read-only sightings overlay: a Likely Canceled the feed saw fly is not counted', async () => {
    supa.rows.set(`agg:ORD:departures:${ORD_DAY_START}`, snapshotRow(ordBoard()));
    const airborne = (cst('12:00') + 20 * 60) * 1000;
    sightings.map = new Map([
      ['UA5103', { reg: 'N123SY', origin: 'ORD', dest: 'GRR', seenAtMs: airborne, airborneAtMs: airborne }],
    ]);
    const res = await call(makeReq());
    expect(sightings.calls).toBe(1);
    expect(res.body.totals).toMatchObject({ likelyCanceled: 0, canceled: 1 });
  });

  it('tops up from tomorrow’s stored board late in the evening, and reads it only then', async () => {
    vi.setSystemTime(cst('22:30') * 1000);
    supa.rows.set(`agg:ORD:departures:${ORD_DAY_START}`, snapshotRow(lateEveningBoard()));
    supa.rows.set(`agg:ORD:departures:${ORD_TOMORROW_START}`, snapshotRow(tomorrowBoard()));
    const res = await call(makeReq());
    expect(snapshotReads().map((c) => c.key)).toEqual([
      `agg:ORD:departures:${ORD_DAY_START}`,
      `agg:ORD:departures:${ORD_TOMORROW_START}`,
    ]);
    expect(res.body.flights.filter((f) => f.nextDay)).toHaveLength(10);
    expect(res.body.nextDay.dayStart).toBe(ORD_TOMORROW_START);
  });

  it('memoizes: junk query strings that bust the CDN do not multiply Supabase reads', async () => {
    supa.rows.set(`agg:ORD:departures:${ORD_DAY_START}`, snapshotRow(ordBoard()));
    await call(makeReq({ hub: 'ORD' }));
    await call(makeReq({ hub: 'ord', z: '1' }));
    await call(makeReq({ hub: 'ORD', z: String(Math.random()) }));
    expect(snapshotReads()).toHaveLength(1);

    // Past the 60 s payload memo the rows are recomputed for the new clock, but the ~1 MB snapshot
    // is not re-read until its own 5-minute memo lapses.
    vi.setSystemTime((NOW_SEC + 61) * 1000);
    await call(makeReq());
    expect(snapshotReads()).toHaveLength(1);
    vi.setSystemTime((NOW_SEC + 5 * 60 + 2) * 1000);
    await call(makeReq());
    expect(snapshotReads()).toHaveLength(2);
  });
});

describe('api/hub-board.ts — cannot reach a provider', () => {
  const ROOT = resolve(__dirname, '..');
  const IMPORT_RE = /(?:^|\n)\s*(?:import|export)\s+(?:([^'"]*?)\s+from\s+)?['"]([^'"]+)['"]/g;
  const DYNAMIC_RE = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;
  const resolveSpec = (from, spec) => {
    const base = resolve(dirname(from), spec);
    const candidates = [base, base.replace(/\.js$/, '.ts')];
    return candidates.find((c) => existsSync(c) && statSync(c).isFile()) ?? null;
  };
  const graph = () => {
    const seen = new Set();
    const stack = [join(ROOT, 'api', 'hub-board.ts')];
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

  it('imports none of the modules that call AeroDataBox, FR24, the FAA or trigger a refresh', () => {
    const reachable = graph();
    expect(reachable).toContain('api/_schedule-snapshots.ts');
    for (const forbidden of [
      'api/schedule.ts',
      'api/_schedule-aerodatabox.ts',
      'api/_cost-state.ts',
      'api/irops.ts',
      'api/faa.ts',
      'api/fr24-feed.ts',
      'api/_official-fr24.ts',
      'api/_fr24-scraper-transport.ts',
      'api/_united-feed.ts',
      'api/cron/warm-schedules.ts',
    ]) {
      expect(reachable, `${forbidden} must be unreachable from api/hub-board.ts`).not.toContain(forbidden);
    }
  });

  it('never fetches, writes a snapshot, or asks for a refresh in its own source', () => {
    const src = readFileSync(join(ROOT, 'api', 'hub-board.ts'), 'utf8').replace(/\/\/.*$/gm, '');
    expect(src).not.toMatch(/\bfetch\(/);
    expect(src).not.toMatch(/saveScheduleSnapshot|upsert|forceRefresh|waitUntil|kickRegSightingsRefresh/);
  });
});
