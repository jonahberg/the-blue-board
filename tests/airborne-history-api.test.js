// GET /api/airborne-history and the sampler behind it (api/_airborne-samples.ts), with the
// service-role Supabase client mocked at its one seam (getSupabaseAdmin). The contract under test:
// gaps stay gaps (a failed read writes nothing, never a zero), every Supabase failure degrades to an
// honest 200 with `samples: []` + a note (never a 5xx, never cached for long), and garbage `?hours=`
// is a 400.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const supabaseMocks = vi.hoisted(() => ({ getSupabaseAdmin: vi.fn(async () => null) }));
vi.mock('../api/_schedule-snapshots.js', () => supabaseMocks);

import handler, { __resetAirborneHistoryForTests, UNAVAILABLE_NOTE } from '../api/airborne-history.js';
import {
  __resetAirborneSamplesForTests,
  buildAirborneSampleRow,
  isMissingSamplesTable,
  loadAirborneSamples,
  recordAirborneSample,
} from '../api/_airborne-samples.js';
import { __resetRateLimitersForTests } from '../api/_rate-limit.js';
import { parseFr24Feed } from '../src/lib/feed-health.js';

const NOW = Date.parse('2026-10-04T20:00:03.000Z');

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
const makeReq = (query = {}, overrides = {}) => ({ method: 'GET', headers: {}, query, ...overrides });

/** A chainable stand-in for the supabase-js query builder over one table's rows. */
function fakeSupabase({ rows = [], readError = null, writeError = null } = {}) {
  const calls = { upserts: [], ranges: [], gte: [] };
  const client = {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        gte: vi.fn((col, val) => {
          calls.gte.push({ col, val });
          return {
            order: vi.fn(() => ({
              range: vi.fn((from, to) => {
                calls.ranges.push([from, to]);
                if (readError) return Promise.resolve({ data: null, error: readError });
                return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
              }),
            })),
          };
        }),
      })),
      upsert: vi.fn((row, opts) => {
        calls.upserts.push({ row, opts });
        return Promise.resolve({ error: writeError });
      }),
    })),
  };
  return { client, calls };
}

const row = (iso, airborne, express = 100) => ({ sampled_at: iso, airborne, express });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
  supabaseMocks.getSupabaseAdmin.mockReset();
  supabaseMocks.getSupabaseAdmin.mockResolvedValue(null);
  __resetAirborneHistoryForTests();
  __resetAirborneSamplesForTests();
  __resetRateLimitersForTests();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('GET /api/airborne-history', () => {
  it('returns the window oldest-first with the 5-minute CDN cache', async () => {
    const { client, calls } = fakeSupabase({
      rows: [row('2026-10-04T19:50:00+00:00', 702, 110), row('2026-10-04T19:55:00+00:00', 705, null)],
    });
    supabaseMocks.getSupabaseAdmin.mockResolvedValue(client);
    const res = createRes();
    await handler(makeReq(), res);
    expect(res.statusCode).toBe(200);
    expect(res.headers['Cache-Control']).toBe('public, s-maxage=300, stale-while-revalidate=600');
    expect(res.body.samples).toEqual([
      { t: '2026-10-04T19:50:00.000Z', airborne: 702, express: 110 },
      { t: '2026-10-04T19:55:00.000Z', airborne: 705 },
    ]);
    expect(res.body.hours).toBe(24);
    expect(res.body.since).toBe(new Date(NOW - 24 * 3600_000).toISOString());
    expect(res.body.generatedAt).toBe(new Date(NOW).toISOString());
    expect(res.body.note).toBeUndefined();
    expect(calls.gte[0]).toEqual({ col: 'sampled_at', val: new Date(NOW - 24 * 3600_000).toISOString() });
  });

  it('clamps hours and pages past the 1,000-row PostgREST cap for a week', async () => {
    const rows = Array.from({ length: 2016 }, (_, i) => row(new Date(NOW - (2016 - i) * 300_000).toISOString(), 500));
    const { client, calls } = fakeSupabase({ rows });
    supabaseMocks.getSupabaseAdmin.mockResolvedValue(client);
    const res = createRes();
    await handler(makeReq({ hours: '9999' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.hours).toBe(168);
    expect(res.body.samples).toHaveLength(2016);
    expect(calls.ranges).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it('rejects garbage hours with a 400 that is never cached', async () => {
    for (const hours of ['abc', '24h', ['x']]) {
      const res = createRes();
      await handler(makeReq({ hours }), res);
      expect(res.statusCode).toBe(400);
      expect(res.headers['Cache-Control']).toBe('no-store');
    }
    expect(supabaseMocks.getSupabaseAdmin).not.toHaveBeenCalled();
  });

  it('answers 200 + samples:[] + a note (briefly cached) when Supabase is not configured', async () => {
    const res = createRes();
    await handler(makeReq(), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.samples).toEqual([]);
    expect(res.body.note).toBe(UNAVAILABLE_NOTE);
    expect(res.headers['Cache-Control']).toBe('public, s-maxage=30');
  });

  it('answers 200 + a note when sql/017 is not applied, logging it once', async () => {
    const error = { code: 'PGRST205', message: "Could not find the table 'public.airborne_samples' in the schema cache" };
    const { client } = fakeSupabase({ readError: error });
    supabaseMocks.getSupabaseAdmin.mockResolvedValue(client);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    for (let i = 0; i < 3; i++) {
      const res = createRes();
      await handler(makeReq(), res);
      expect(res.statusCode).toBe(200);
      expect(res.body.samples).toEqual([]);
      expect(res.body.note).toBe(UNAVAILABLE_NOTE);
    }
    expect(log.mock.calls.filter(([m]) => String(m).includes('017'))).toHaveLength(1);
  });

  it('never 5xxes when the client itself throws', async () => {
    supabaseMocks.getSupabaseAdmin.mockRejectedValue(new Error('boom'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = createRes();
    await handler(makeReq(), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.note).toBe(UNAVAILABLE_NOTE);
  });

  it('memoizes a good read for a minute so cache-busting query strings cannot hammer Supabase', async () => {
    const { client } = fakeSupabase({ rows: [row('2026-10-04T19:55:00Z', 700)] });
    supabaseMocks.getSupabaseAdmin.mockResolvedValue(client);
    await handler(makeReq({ z: '1' }), createRes());
    await handler(makeReq({ z: '2' }), createRes());
    expect(client.from).toHaveBeenCalledTimes(1);
  });

  it('405s a POST and 403s a foreign origin; 429s past the rate limit without caching it', async () => {
    let res = createRes();
    await handler(makeReq({}, { method: 'POST' }), res);
    expect(res.statusCode).toBe(405);
    res = createRes();
    await handler(makeReq({}, { headers: { origin: 'https://evil.example' } }), res);
    expect(res.statusCode).toBe(403);
    res = createRes();
    await handler(makeReq({}, { headers: { origin: 'https://theblueboard.co' } }), res);
    expect(res.statusCode).toBe(200);
    for (let i = 0; i < 40; i++) {
      res = createRes();
      await handler(makeReq(), res);
    }
    expect(res.statusCode).toBe(429);
    expect(res.headers['Cache-Control']).toBe('no-store');
  });
});

// [icao24, lat, lon, hdg, alt ft, spd kt, squawk, radar, type, reg, ts, origin, dest, flight, onGround, vr fpm, callsign, ?, airline]
const FEED = {
  full_count: 3,
  version: 4,
  a: ['A1', 41.9, -88.5, 270, 35000, 450, '', '', 'B739', 'N1', 0, 'ORD', 'SFO', 'UA1', 0, 0, 'UAL1', 0, 'UAL'],
  b: ['A2', 39.9, -95.5, 270, 31000, 430, '', '', 'E75L', 'N2', 0, 'DEN', 'MCI', 'UA5001', 0, 0, 'SKW5001', 0, 'UAL'],
  c: ['A3', 41.97, -87.9, 0, 0, 0, '', '', 'B772', 'N3', 0, 'ORD', 'LHR', 'UA930', 1, 0, 'UAL930', 0, 'UAL'],
};

describe('recordAirborneSample — the cron-side writer', () => {
  it('writes one row floored to the minute, on conflict do nothing', async () => {
    const { client, calls } = fakeSupabase();
    supabaseMocks.getSupabaseAdmin.mockResolvedValue(client);
    const result = await recordAirborneSample(parseFr24Feed(FEED), NOW);
    expect(result).toEqual({ recorded: true, airborne: 2 });
    expect(calls.upserts).toEqual([
      {
        row: { sampled_at: '2026-10-04T20:00:00.000Z', airborne: 2, ground: 1, total: 3, mainline: 1, express: 1 },
        opts: { onConflict: 'sampled_at', ignoreDuplicates: true },
      },
    ]);
  });

  it('writes NOTHING for a failed (empty) read — a gap, never a zero', async () => {
    const { client, calls } = fakeSupabase();
    supabaseMocks.getSupabaseAdmin.mockResolvedValue(client);
    expect((await recordAirborneSample([], NOW)).recorded).toBe(false);
    expect((await recordAirborneSample(parseFr24Feed({ full_count: 0, version: 4 }), NOW)).recorded).toBe(false);
    expect((await recordAirborneSample(undefined, NOW)).recorded).toBe(false);
    expect(calls.upserts).toEqual([]);
  });

  it('refuses a feed with aircraft but zero airborne (not a United sky)', () => {
    const allGround = parseFr24Feed({ c: FEED.c });
    expect(buildAirborneSampleRow(allGround, NOW)).toBeNull();
  });

  it('no-ops quietly when unconfigured, and never throws on a write error', async () => {
    expect(await recordAirborneSample(parseFr24Feed(FEED), NOW)).toEqual({ recorded: false, reason: 'unconfigured' });
    const { client } = fakeSupabase({ writeError: { code: '42P01', message: 'relation "airborne_samples" does not exist' } });
    supabaseMocks.getSupabaseAdmin.mockResolvedValue(client);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await recordAirborneSample(parseFr24Feed(FEED), NOW)).toEqual({ recorded: false, reason: 'table missing' });
    expect(await recordAirborneSample(parseFr24Feed(FEED), NOW)).toEqual({ recorded: false, reason: 'table missing' });
    expect(log).toHaveBeenCalledTimes(1);
    supabaseMocks.getSupabaseAdmin.mockRejectedValue(new Error('network down'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(recordAirborneSample(parseFr24Feed(FEED), NOW)).resolves.toEqual({ recorded: false, reason: 'write threw' });
  });

  it('reads back only well-formed rows', async () => {
    const { client } = fakeSupabase({
      rows: [row('2026-10-04T19:50:00Z', 702), { sampled_at: 'garbage', airborne: 1 }, { sampled_at: '2026-10-04T19:55:00Z', airborne: null }],
    });
    supabaseMocks.getSupabaseAdmin.mockResolvedValue(client);
    const result = await loadAirborneSamples(NOW - 3600_000);
    expect(result).toEqual({ ok: true, samples: [{ t: '2026-10-04T19:50:00.000Z', airborne: 702, express: 100 }] });
  });
});

describe('isMissingSamplesTable', () => {
  it('recognises both the Postgres and the PostgREST shapes', () => {
    expect(isMissingSamplesTable({ code: '42P01' })).toBe(true);
    expect(isMissingSamplesTable({ code: 'PGRST205' })).toBe(true);
    expect(isMissingSamplesTable({ message: 'relation "public.airborne_samples" does not exist' })).toBe(true);
    expect(isMissingSamplesTable({ code: '57014', message: 'canceling statement due to statement timeout' })).toBe(false);
    expect(isMissingSamplesTable(null)).toBe(false);
  });
});
