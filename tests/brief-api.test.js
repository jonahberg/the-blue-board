// GET /api/brief (api/brief.ts) and the source collector (api/_brief-collect.ts).
//   - The endpoint serves the latest brief, ONLY the facts it cites (public fields only), the fact
//     count, generatedAt / checkedAt / nextUpdateAt and a `stale` flag from checked_at; it is
//     CDN-cached; it never 5xxes (no brief yet, unconfigured, table missing → 200 + note).
//   - The collector asks only the site's own endpoints, with the cache-key-exact requests the
//     dashboard and the warm cron send, and turns the live feed into airborne + Starlink counts.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fakeSupabase } from './fixtures/fake-supabase.js';

const supabaseMocks = vi.hoisted(() => ({ getSupabaseAdmin: vi.fn(async () => null) }));
vi.mock('../api/_schedule-snapshots.js', () => supabaseMocks);

import handler, { __resetBriefEndpointForTests, briefResponseBody, nextCronRunMs } from '../api/brief.js';
import { BRIEF_METAR_IDS, __resetBriefCollectForTests, collectBriefSources } from '../api/_brief-collect.js';
import { __resetBriefStoreForTests } from '../api/_brief-store.js';
import { __resetRateLimitersForTests } from '../api/_rate-limit.js';
import { buildBriefFacts } from '../src/lib/brief-facts.js';
import { buildTemplateBrief } from '../src/lib/brief-template.js';

const CALM = JSON.parse(readFileSync(new URL('./fixtures/brief/calm-afternoon.json', import.meta.url), 'utf8'));
const NOW = Date.parse(CALM.nowIso);
const FACTS = buildBriefFacts(CALM.sources, { nowMs: NOW }).facts;

function storedRow(minutesSinceCheck = 5) {
  const t = buildTemplateBrief(FACTS);
  return {
    id: 42,
    generated_at: new Date(NOW - 50 * 60_000).toISOString(),
    checked_at: new Date(NOW - minutesSinceCheck * 60_000).toISOString(),
    source: 'model', template_reason: null, tone: t.tone, headline: 'United is running smoothly this afternoon.',
    items: t.items, traveler_note: null, headline_fact_ids: [], facts: FACTS, facts_hash: 'a'.repeat(64),
    verifier: { itemsIn: 4, itemsKept: 3 },
  };
}

function createRes() {
  return {
    statusCode: 200, headers: {}, body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}
const get = async (overrides = {}) => {
  const res = createRes();
  await handler({ method: 'GET', headers: {}, query: {}, ...overrides }, res);
  return res;
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
  __resetBriefEndpointForTests();
  __resetBriefStoreForTests();
  __resetBriefCollectForTests();
  __resetRateLimitersForTests();
  supabaseMocks.getSupabaseAdmin.mockReset();
  supabaseMocks.getSupabaseAdmin.mockResolvedValue(null);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('GET /api/brief', () => {
  it('serves the latest brief with only the facts it cites, CDN-cached', async () => {
    supabaseMocks.getSupabaseAdmin.mockResolvedValue(fakeSupabase({ tables: { ops_briefs: [storedRow()] } }).client);
    const res = await get();
    expect(res.statusCode).toBe(200);
    expect(res.headers['Cache-Control']).toBe('public, s-maxage=60, stale-while-revalidate=300');
    const body = res.body;
    expect(body.brief).toEqual(expect.objectContaining({ headline: 'United is running smoothly this afternoon.', tone: 'calm', source: 'model', traveler_note: null }));
    const cited = new Set(body.brief.items.flatMap((i) => i.fact_ids));
    expect(body.facts.map((f) => f.id).sort()).toEqual([...cited].sort());
    expect(body.facts.length).toBeLessThan(FACTS.length);
    for (const f of body.facts) expect(Object.keys(f).every((k) => ['id', 'kind', 'hub', 'statement', 'values', 'at', 'link'].includes(k))).toBe(true);
    expect(body).toEqual(expect.objectContaining({
      factCount: FACTS.length,
      generatedAt: new Date(NOW - 50 * 60_000).toISOString(),
      checkedAt: new Date(NOW - 5 * 60_000).toISOString(),
      nextUpdateAt: '2026-11-10T21:50:00.000Z',
      stale: false,
      verified: { itemsIn: 4, itemsKept: 3 },
    }));
  });

  it('marks a brief stale when no run has re-confirmed it for 30 minutes', () => {
    expect(briefResponseBody(storedRow(29), NOW).stale).toBe(false);
    expect(briefResponseBody(storedRow(31), NOW).stale).toBe(true);
  });

  it('a template brief carries no "verified" counts', () => {
    expect(briefResponseBody({ ...storedRow(), source: 'template' }, NOW).verified).toBeNull();
  });

  it('serves the facts a replaced headline rests on', () => {
    const row = { ...storedRow(), headline_fact_ids: ['faa.planned.BOS'] };
    expect(briefResponseBody(row, NOW).facts.map((f) => f.id)).toContain('faa.planned.BOS');
  });

  it('no brief yet: a clean 200 with brief null, briefly cached', async () => {
    supabaseMocks.getSupabaseAdmin.mockResolvedValue(fakeSupabase({ tables: { ops_briefs: [] } }).client);
    const res = await get();
    expect(res.statusCode).toBe(200);
    expect(res.headers['Cache-Control']).toBe('public, s-maxage=30');
    expect(res.body).toEqual({
      brief: null, facts: [], factCount: 0, generatedAt: null, checkedAt: null,
      nextUpdateAt: '2026-11-10T21:50:00.000Z', stale: true, verified: null, note: 'No brief yet.',
    });
  });

  it('unconfigured Supabase or a missing table: 200 with a note, never a 5xx', async () => {
    let res = await get();
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({ brief: null, note: 'The brief is unavailable right now.' }));
    __resetBriefEndpointForTests();
    supabaseMocks.getSupabaseAdmin.mockResolvedValue(fakeSupabase({ failures: { 'ops_briefs.select': { code: '42P01', message: 'relation "ops_briefs" does not exist' } } }).client);
    res = await get();
    expect(res.statusCode).toBe(200);
    expect(res.body.brief).toBeNull();
  });

  it('memoises the row for 30 seconds so CDN misses do not each hit Supabase', async () => {
    const db = fakeSupabase({ tables: { ops_briefs: [storedRow()] } });
    supabaseMocks.getSupabaseAdmin.mockResolvedValue(db.client);
    await get();
    await get();
    expect(db.calls.filter((c) => c.table === 'ops_briefs')).toHaveLength(1);
  });

  it('405 for anything but GET, 403 for a foreign origin, 429 past the rate limit (never cached)', async () => {
    expect((await get({ method: 'POST' })).statusCode).toBe(405);
    const foreign = await get({ headers: { origin: 'https://evil.example' } });
    expect(foreign.statusCode).toBe(403);
    expect(foreign.headers['Cache-Control']).toBe('no-store');
    let last;
    for (let i = 0; i < 61; i++) last = await get({ headers: { 'x-real-ip': '203.0.113.9' } });
    expect(last.statusCode).toBe(429);
    expect(last.headers['Cache-Control']).toBe('no-store');
  });

  it('nextCronRunMs is the next 10-minute boundary', () => {
    expect(new Date(nextCronRunMs(Date.parse('2026-11-10T21:40:00Z'))).toISOString()).toBe('2026-11-10T21:50:00.000Z');
    expect(new Date(nextCronRunMs(Date.parse('2026-11-10T21:49:59Z'))).toISOString()).toBe('2026-11-10T21:50:00.000Z');
  });
});

describe('collectBriefSources', () => {
  const raw = (reg, altFt, onGround, callsign) => ['A1B2C3', 40.6, -74.1, 90, altFt, onGround ? 0 : 450, '1200', 'T-KEWR1', 'B39M', reg, 0, 'EWR', 'SFO', 'UA1', onGround ? 1 : 0, 0, callsign, 0, 'UAL'];
  const FEED = { full_count: 4, version: 4, a: raw('N17421', 35000, false, 'UAL1'), b: raw('N37527', 33000, false, 'UAL2'), c: raw('N12345', 31000, false, 'SKW3'), d: raw('N17422', 0, true, 'UAL4') };
  const ROUTES = {
    '/api/irops': CALM.sources.irops,
    '/api/faa': CALM.sources.faa,
    '/api/nas': CALM.sources.nas,
    [`/api/metar?ids=${BRIEF_METAR_IDS}`]: CALM.sources.metar,
    '/api/fr24-feed?airline=UAL': FEED,
    '/api/starlink-data?fields=roster': { aircraft: [{ tail: 'N17421' }, { tail: 'N37527' }] },
    '/data/fleet.json': [{ r: 'N17421' }, { r: 'N37527' }],
  };
  function routedFetch(overrides = {}) {
    const routes = { ...ROUTES, ...overrides };
    return vi.fn(async (url, init) => {
      const path = String(url).replace('https://site.test', '');
      if (!(path in routes)) throw new Error(`unexpected fetch ${url}`);
      const body = routes[path];
      if (body instanceof Error) throw body;
      if (typeof body === 'number') return { ok: false, status: body, text: async () => '', headers: new Headers() };
      return { ok: true, status: 200, json: async () => body, text: async () => '', headers: new Headers({ age: '120' }) };
    });
  }

  it('asks only the site’s own endpoints, with Accept: application/json, and counts airborne + Starlink', async () => {
    const fetchImpl = routedFetch();
    const out = await collectBriefSources({ fetchImpl, nowMs: NOW, baseUrl: 'https://site.test' });
    expect(out.errors).toEqual({ airNormal: 'unavailable' });
    expect(out.air).toEqual({ airborne: 3, express: 1, starlink: 2 });
    expect(out.asOf.faa).toBe(NOW - 120_000);
    for (const [url, init] of fetchImpl.mock.calls) {
      expect(String(url).startsWith('https://site.test/')).toBe(true);
      expect(init.headers.Accept).toBe('application/json');
    }
    // The METAR request is byte-identical to api/cron/refresh-metar.ts's warm request.
    expect(fetchImpl.mock.calls.map(([u]) => String(u))).toContain('https://site.test/api/metar?ids=KEWR,KIAH,KORD,KDEN,KSFO,KLAX,KIAD,RJAA,PGUM');
    // No schedule provider, no paid FR24, no third-party host.
    expect(fetchImpl.mock.calls.some(([u]) => /aerodatabox|fr24api|scrapingbee|flightradar24\.com/i.test(String(u)))).toBe(false);
  });

  it('names a failed source and keeps the rest', async () => {
    const out = await collectBriefSources({ fetchImpl: routedFetch({ '/api/faa': 502, '/api/nas': new Error('socket hang up') }), nowMs: NOW, baseUrl: 'https://site.test' });
    expect(out.faa).toBeNull();
    expect(out.nas).toBeNull();
    expect(out.errors).toEqual(expect.objectContaining({ faa: 'HTTP 502', nas: 'socket hang up' }));
    expect(out.irops).not.toBeNull();
  });

  it('an empty live feed is a failed read, not an empty sky', async () => {
    const out = await collectBriefSources({ fetchImpl: routedFetch({ '/api/fr24-feed?airline=UAL': { full_count: 0, version: 4 } }), nowMs: NOW, baseUrl: 'https://site.test' });
    expect(out.air).toBeNull();
    expect(out.errors.air).toBe('empty feed');
  });

  it('without the Starlink roster, counts airborne but claims no Starlink', async () => {
    const out = await collectBriefSources({ fetchImpl: routedFetch({ '/api/starlink-data?fields=roster': 503 }), nowMs: NOW, baseUrl: 'https://site.test' });
    expect(out.air).toEqual({ airborne: 3, express: 1, starlink: null });
    expect(out.errors.starlink).toBe('roster unavailable');
  });

  it('reads the airborne median from narrow airborne_samples windows', async () => {
    const rows = [];
    for (let d = 1; d <= 7; d++) rows.push({ sampled_at: new Date(NOW - d * 86_400_000).toISOString(), airborne: 600 + d * 10 });
    const db = fakeSupabase({ tables: { airborne_samples: rows } });
    supabaseMocks.getSupabaseAdmin.mockResolvedValue(db.client);
    const out = await collectBriefSources({ fetchImpl: routedFetch(), nowMs: NOW, baseUrl: 'https://site.test' });
    expect(out.airNormal).toEqual({ median: 640, days: 7 });
    expect(db.calls.filter((c) => c.table === 'airborne_samples')).toHaveLength(7);
  });
});
