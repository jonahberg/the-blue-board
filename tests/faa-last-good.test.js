// /api/faa's last good answer, kept in the database as well as in memory (Nov 2026).
//
// Nov 14 2026, 19:00–19:22 UTC: FAA answered HTTP 403 on both sources and /api/faa logged
// "no last-known-good answer to serve" 25 times for 18 visitors. The last good answer lived only
// in the memory of the server that got it, and the servers that met the outage were new.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The Supabase client is a fake whose one table row the tests can see and set.
const db = vi.hoisted(() => ({ row: null, upserts: [], readError: null, readHangs: false }));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table) => ({
      select: () => ({
        eq: (_col, key) => ({
          limit: () => {
            if (db.readHangs) return new Promise(() => {});
            if (db.readError) return Promise.resolve({ data: null, error: { message: db.readError } });
            const hit = db.row && db.row.table === table && db.row.value.key === key ? [db.row.value] : [];
            return Promise.resolve({ data: hit, error: null });
          },
        }),
      }),
      upsert: (value) => {
        db.upserts.push({ table, value });
        db.row = { table, value };
        return Promise.resolve({ error: null });
      },
    }),
  }),
}));

import handler, { __resetFaaHandlerForTests } from '../api/faa.js';
import { __resetRateLimitersForTests } from '../api/_rate-limit.js';
import { FAA_LAST_GOOD_KEY, FAA_LAST_GOOD_TABLE } from '../api/_faa-last-good.js';
import {
  FAA_LAST_GOOD_MAX_AGE_MS,
  faaLastGoodFromRow,
  faaLastGoodPayload,
  pickFaaLastGood,
  shouldStoreFaaLastGood,
} from '../src/lib/faa-last-good.js';

describe('src/lib/faa-last-good.js', () => {
  it('reads back only a tagged FAA answer with a real time', () => {
    const at = '2026-11-14T18:58:00Z';
    expect(faaLastGoodFromRow({ payload: faaLastGoodPayload([{ airportCode: 'EWR' }]), refreshed_at: at }))
      .toEqual({ airports: [{ airportCode: 'EWR' }], at: Date.parse(at) });
    expect(faaLastGoodFromRow({ payload: { aircraft: [1] }, refreshed_at: at })).toBeNull();
    expect(faaLastGoodFromRow({ payload: { source: 'faa', airports: 'x' }, refreshed_at: at })).toBeNull();
    expect(faaLastGoodFromRow({ payload: faaLastGoodPayload([]), refreshed_at: 'soon' })).toBeNull();
    expect(faaLastGoodFromRow(null)).toBeNull();
  });

  it('"no programs" is a real answer and is kept as one', () => {
    expect(faaLastGoodFromRow({ payload: faaLastGoodPayload([]), refreshed_at: '2026-11-14T18:58:00Z' }).airports).toEqual([]);
  });

  it('picks the newest answer within the age limit, with its age', () => {
    const now = Date.parse('2026-11-14T19:10:00Z');
    const older = { airports: ['old'], at: now - 20 * 60_000 };
    const newer = { airports: ['new'], at: now - 5 * 60_000 };
    expect(pickFaaLastGood([older, newer], now)).toEqual({ airports: ['new'], at: newer.at, ageMs: 5 * 60_000 });
    expect(pickFaaLastGood([{ airports: [], at: now - FAA_LAST_GOOD_MAX_AGE_MS - 1 }], now)).toBeNull();
    expect(pickFaaLastGood([null, undefined], now)).toBeNull();
    // Another server's clock a little ahead: age 0, not negative.
    expect(pickFaaLastGood([{ airports: [], at: now + 2000 }], now).ageMs).toBe(0);
  });

  it('stores at most once a minute', () => {
    expect(shouldStoreFaaLastGood(Number.NEGATIVE_INFINITY, 0)).toBe(true);
    expect(shouldStoreFaaLastGood(1000, 30_000)).toBe(false);
    expect(shouldStoreFaaLastGood(1000, 61_000)).toBe(true);
  });
});

describe('/api/faa — the stored last good answer', () => {
  const GOOD = [{ airportId: 'EWR', groundStop: { impactingCondition: 'Thunderstorms' } }];
  const T0 = new Date('2026-11-14T18:58:00Z');

  function createRes() {
    return {
      statusCode: 200, headers: {}, body: null,
      setHeader(name, value) { this.headers[name] = value; },
      status(code) { this.statusCode = code; return this; },
      json(payload) { this.body = payload; return this; },
    };
  }
  async function serveOnce(fetchImpl) {
    vi.spyOn(globalThis, 'fetch').mockImplementation(fetchImpl);
    const res = createRes();
    await handler({ method: 'GET', headers: { origin: 'http://localhost:3000' } }, res);
    // The store is written after the answer (waitUntil): let it land.
    await new Promise((resolve) => setTimeout(resolve, 0));
    return res;
  }
  const good = async () => ({ ok: true, json: async () => GOOD });
  const bothForbidden = async () => ({ ok: false, status: 403 });
  const later = (ms) => vi.setSystemTime(new Date(T0.getTime() + ms));
  /** A server that has never answered /api/faa: nothing in memory, nothing stored by it yet. */
  const newServer = () => __resetFaaHandlerForTests();

  beforeEach(() => {
    vi.restoreAllMocks();
    Object.assign(db, { row: null, upserts: [], readError: null, readHangs: false });
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test';
    __resetFaaHandlerForTests();
    __resetRateLimitersForTests();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  it('stores a good answer, tagged, with the moment FAA gave it', async () => {
    const res = await serveOnce(good);
    expect(res.statusCode).toBe(200);
    expect(db.upserts).toHaveLength(1);
    expect(db.upserts[0].table).toBe(FAA_LAST_GOOD_TABLE);
    expect(db.upserts[0].value.key).toBe(FAA_LAST_GOOD_KEY);
    expect(db.upserts[0].value.payload).toEqual({ source: 'faa', airports: res.body });
    expect(db.upserts[0].value.refreshed_at).toBe(T0.toISOString());
  });

  it('replays Nov 14: a new server meets the 403s 20 minutes later and serves the stored answer, flagged', async () => {
    const first = await serveOnce(good);
    newServer();
    later(20 * 60_000);
    const res = await serveOnce(bothForbidden);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(first.body);
    expect(res.headers['X-BB-FAA-Stale']).toBe(String(20 * 60));
    expect(res.headers['Cache-Control']).toBe('s-maxage=60');
    expect(console.error).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('stored copy'));
  });

  it('the stored answer obeys the same 30-minute limit: past it the error stands', async () => {
    await serveOnce(good);
    newServer();
    later(31 * 60_000);
    const res = await serveOnce(bothForbidden);
    expect(res.statusCode).toBe(502);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('no last-known-good answer to serve'));
  });

  it('a stored "no programs" answer is served as the real answer it was', async () => {
    await serveOnce(async () => ({ ok: true, json: async () => [] }));
    newServer();
    later(60_000);
    const res = await serveOnce(bothForbidden);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual([]);
    expect(res.headers['X-BB-FAA-Stale']).toBe('60');
  });

  it('never stores an empty or unreadable body', async () => {
    const xmlOnly = (xml) => async (url) => (
      String(url).endsWith('/api/airport-events') ? { ok: false, status: 403 } : { ok: true, text: async () => xml }
    );
    await serveOnce(xmlOnly(''));
    await serveOnce(xmlOnly('<html><body>Access Denied</body></html>'));
    expect(db.upserts).toHaveLength(0);
  });

  it('stores at most once a minute per server', async () => {
    await serveOnce(good);
    later(20_000);
    await serveOnce(good);
    expect(db.upserts).toHaveLength(1);
    later(61_000);
    await serveOnce(good);
    expect(db.upserts).toHaveLength(2);
  });

  it('a failed or slow read of the stored answer leaves the error as it was', async () => {
    await serveOnce(good);
    newServer();
    later(60_000);
    db.readError = 'relation does not exist';
    expect((await serveOnce(bothForbidden)).statusCode).toBe(502);

    newServer();
    db.readError = null;
    db.readHangs = true;
    const started = performance.now();
    const res = await serveOnce(bothForbidden);
    expect(res.statusCode).toBe(502);
    // Bounded (1.5 s), not held open.
    expect(performance.now() - started).toBeLessThan(5000);
  });

  it("this server's own answer is used without reading the store", async () => {
    await serveOnce(good);
    db.readError = 'should not be read';
    later(60_000);
    const res = await serveOnce(bothForbidden);
    expect(res.statusCode).toBe(200);
    expect(res.headers['X-BB-FAA-Stale']).toBe('60');
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('this server'));
  });
});
