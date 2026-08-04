import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import handler, { __resetFeedStateForTests } from '../api/fr24-feed.js';
import { __resetRateLimitersForTests } from '../api/_rate-limit.js';
import { FEED_FRESH_MS } from '../src/lib/feed-health.js';

function createRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

function feedReq(airline) {
  const query = airline === undefined ? {} : { airline };
  return { method: 'GET', headers: { origin: 'http://localhost:3000' }, query };
}

const EMPTY_BODY = { full_count: 22684, version: 4 };

// One aircraft entry in FR24's positional-array shape. The handler's "is this feed empty?" predicate
// IS the client's parseFr24Feed, which drops any entry without a truthy lat/lon (indices 1 and 2), so
// a fixture aircraft has to carry a real position or the whole payload reads as an empty feed.
const AC = ['a1b2c3', 41.98, -87.9];

// An aircraft entry with NO position — the degraded shape that used to count as a success (it is an
// array-valued key) while every client parsed it as zero flights.
const AC_NO_POSITION = ['a1b2c3', null, null];

// Shared per-test reset. The handler keeps THREE module-level stores (fresh cache, in-flight dedup,
// last-known-good ring) that outlive a test file; before the __resetFeedStateForTests seam existed,
// tests encoded "which airline codes are still cold" as declaration order, so a shuffled run failed.
// The retry delay is zeroed here too: it is a REAL setTimeout, and a dozen retry cases at 400ms each
// is wall-clock time spent asserting nothing.
function resetFeedTestState() {
  vi.restoreAllMocks();
  __resetRateLimitersForTests();
  __resetFeedStateForTests();
  process.env.FR24_EMPTY_RETRY_DELAY_MS = '0';
  delete process.env.FR24_FEED_STALE_SERVE_MAX_MS;
}

function cleanupFeedTestEnv() {
  vi.useRealTimers();
  delete process.env.FR24_EMPTY_RETRY_DELAY_MS;
  delete process.env.FR24_FEED_STALE_SERVE_MAX_MS;
}

describe('fr24-feed API', () => {
  beforeEach(resetFeedTestState);
  afterEach(cleanupFeedTestEnv);

  it('rejects non-GET requests', async () => {
    const res = createRes();
    await handler({ method: 'POST', headers: {}, query: {} }, res);
    expect(res.statusCode).toBe(405);
  });

  it('rejects forbidden origins', async () => {
    const res = createRes();
    await handler({ method: 'GET', headers: { origin: 'https://evil.com' }, query: {} }, res);
    expect(res.statusCode).toBe(403);
  });

  it('rejects invalid airline codes', async () => {
    const res = createRes();
    await handler(feedReq('DROP TABLE'), res);
    expect(res.statusCode).toBe(400);
  });

  it('normalizes a non-string airline param instead of throwing (validation now lives outside the try)', async () => {
    // ?airline=UAL&airline=DAL arrives as an array; a bare/odd param can arrive as ''/true. Since
    // validation moved ABOVE the try (the catch needs the cacheKey), .test()/.toUpperCase() on a
    // non-string would escape as an unhandled 500 rather than the intended 400/UAL default.
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ ...EMPTY_BODY, aa00bb: AC }),
    });

    const arrayRes = createRes();
    await handler(feedReq(['DAL', 'JBU']), arrayRes);
    expect(arrayRes.statusCode).toBe(200);
    expect(String(fetchMock.mock.calls[0][0])).toContain('airline=DAL');

    for (const junk of ['', true, 42, { a: 1 }, [], [null]]) {
      __resetFeedStateForTests();
      const res = createRes();
      await handler(feedReq(junk), res);
      expect(res.statusCode, `airline=${JSON.stringify(junk)}`).toBe(200);
    }
  });

  it('returns 502 on upstream failure (cold cache), draining the error body first', async () => {
    // An undrained body keeps its socket checked out of the agent pool until GC, and this is the
    // branch that fires in bursts (sustained upstream 5xx) — the same reason the AeroDataBox fetcher
    // reads the body on its !ok path.
    const text = vi.fn(async () => 'upstream exploded');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 500, text });

    const res = createRes();
    await handler(feedReq(), res);

    expect(res.statusCode).toBe(502);
    expect(text).toHaveBeenCalledTimes(1);
  });

  it('returns 504 on timeout (cold cache)', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      Object.assign(new Error('timeout'), { name: 'AbortError' })
    );

    const res = createRes();
    await handler(feedReq(), res);

    expect(res.statusCode).toBe(504);
  });

  it('returns flight data on success', async () => {
    const mockData = { full_count: 500, version: 4, '2d5c8a': AC };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => mockData,
    });

    const res = createRes();
    await handler(feedReq(), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(mockData);
    expect(res.headers['Cache-Control']).toContain('s-maxage=15');
  });


  it('serves a non-UAL code as a plain pass-through — no fresh cache read or write', async () => {
    // The fresh cache holds exactly ONE entry and the airline param is caller-controlled, so letting
    // arbitrary codes occupy it turns alternating requests into permanent thrash for the one airline
    // the product actually serves. Non-UAL codes still answer correctly; they just never cache.
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const airline = new URL(url).searchParams.get('airline');
      return {
        ok: true,
        json: async () => ({ airline, full_count: airline === 'DAL' ? 500 : 120, aabbcc: AC }),
      };
    });

    const resDAL = createRes();
    await handler(feedReq('DAL'), resDAL);

    const resAAL = createRes();
    await handler(feedReq('AAL'), resAAL);

    // Same code, immediately again: a cached entry would answer without upstream traffic.
    const resAALAgain = createRes();
    await handler(feedReq('AAL'), resAALAgain);

    expect(resDAL.statusCode).toBe(200);
    expect(resDAL.body.airline).toBe('DAL');
    expect(resAAL.statusCode).toBe(200);
    expect(resAAL.body.airline).toBe('AAL');
    expect(resAALAgain.body.airline).toBe('AAL');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('returns cached data on subsequent requests', async () => {
    const mockData = { full_count: 500, version: 4, '2d5c8a': AC };
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => mockData,
    });

    const firstRes = createRes();
    await handler(feedReq('UAL'), firstRes);

    const secondRes = createRes();
    await handler(feedReq('UAL'), secondRes);

    expect(firstRes.statusCode).toBe(200);
    expect(secondRes.statusCode).toBe(200);
    expect(secondRes.body.full_count).toBe(500);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

// Jul 3 2026 audit: the upstream feed occasionally 200s with a meta-only body
// ({full_count, version}, zero aircraft arrays). Serving that as success wiped the client's
// map/boards into "NO DATA". The handler must surface it as a 503 and never cache it.
describe('fr24-feed empty-payload rejection', () => {
  beforeEach(resetFeedTestState);
  afterEach(cleanupFeedTestEnv);

  it('returns 503 (no-store) when upstream 200s with a meta-only body', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => EMPTY_BODY,
    });

    const res = createRes();
    await handler(feedReq('UAL'), res);

    expect(res.statusCode).toBe(503);
    expect(res.body.error).toMatch(/empty feed/i);
    expect(res.headers['Cache-Control']).toBe('no-store');
  });

  it('does not cache the empty body — next request refetches and succeeds', async () => {
    // Both attempts of the FIRST request must be empty for it to 503 (United retries once since
    // Aug 4 2026), so the good body lands on the third upstream call.
    let call = 0;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => ({
      ok: true,
      json: async () => (++call <= 2 ? EMPTY_BODY : { ...EMPTY_BODY, ddeeff: AC }),
    }));

    const first = createRes();
    await handler(feedReq('UAL'), first);
    expect(first.statusCode).toBe(503);

    const second = createRes();
    await handler(feedReq('UAL'), second);
    expect(second.statusCode).toBe(200);
    expect(second.body.ddeeff).toEqual(AC);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does NOT retry for a non-United airline — "empty is never truth" is a UA-only claim', async () => {
    // United always has hundreds airborne, so an empty UA feed is an upstream glitch. Any other
    // caller-supplied code may legitimately have nothing flying, and re-asking would just double the
    // upstream amplification an attacker gets for free from the open `airline` param.
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => EMPTY_BODY,
    });

    const res = createRes();
    await handler(feedReq('SWA'), res);

    expect(res.statusCode).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

// Aug 4 2026: FR24's empty bodies arrive in STREAKS, not isolated blips — 12 sequential probes of
// the upstream returned 708, 0, 0, 706, 708, 0, 0, 0, 0, 0, 712, 0 aircraft, and 1,062 of ~5,200
// requests/24h were 503ing on the Jul 3 empty-feed guard. A single retry clears the one-deep
// streaks; the streaks of 2-5 need the bounded last-known-good serve. The ceiling matches the
// client's FEED_FRESH_MS (180s) so the LIVE chip can never overclaim by more than a fresh window.
describe('fr24-feed empty-streak recovery (retry + bounded stale-serve)', () => {
  const T0 = '2026-08-04T18:00:00Z';
  const at = (ms) => new Date(Date.parse(T0) + ms);

  beforeEach(resetFeedTestState);
  afterEach(cleanupFeedTestEnv);

  it('retries the upstream once and serves the second, good payload when the first body is empty', async () => {
    let call = 0;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => ({
      ok: true,
      json: async () => (++call === 1 ? EMPTY_BODY : { ...EMPTY_BODY, aa11bb: AC }),
    }));

    const res = createRes();
    await handler(feedReq('UAL'), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.aa11bb).toEqual(AC);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('serves the last-known-good payload as a 200 (X-BB-Feed-Stale + shared TTL) when both attempts are empty', async () => {
    // Fake Date ONLY — setTimeout stays real so the inter-attempt pause still resolves.
    vi.useFakeTimers({ now: at(0), toFake: ['Date'] });
    const good = { ...EMPTY_BODY, cc22dd: AC };
    let empty = false;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => ({
      ok: true,
      json: async () => (empty ? EMPTY_BODY : good),
    }));

    const seed = createRes();
    await handler(feedReq('UAL'), seed);
    expect(seed.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // 40s later: past the 15s fresh cache (so we really refetch) but well inside the 180s ceiling.
    vi.setSystemTime(at(40_000));
    empty = true;

    const res = createRes();
    await handler(feedReq('UAL'), res);

    // Both attempts were made before falling back — stale-serve is the last resort, not the first.
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(good);
    expect(res.headers['X-BB-Feed-Stale']).toBe('40');
    // 140s of freshness left, so the edge may share it — clamped to the fresh path's own 15s.
    expect(res.headers['Cache-Control']).toBe('s-maxage=15');
  });

  it('does not repopulate the fresh cache from a stale-serve — the next poll still asks upstream', async () => {
    // Deliberately NO feedCache.set on the stale path: caching it would restart the 15s fresh window
    // on old data and stop us re-trying the upstream that just failed.
    vi.useFakeTimers({ now: at(0), toFake: ['Date'] });
    let empty = false;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => ({
      ok: true,
      json: async () => (empty ? EMPTY_BODY : { ...EMPTY_BODY, ee11ff: AC }),
    }));

    await handler(feedReq('UAL'), createRes());
    vi.setSystemTime(at(40_000));
    empty = true;

    const first = createRes();
    await handler(feedReq('UAL'), first);
    expect(first.statusCode).toBe(200);
    expect(first.headers['X-BB-Feed-Stale']).toBe('40');
    const callsAfterFirst = fetchMock.mock.calls.length;

    // Same instant, same airline: a cached stale body would answer without any upstream traffic.
    const second = createRes();
    await handler(feedReq('UAL'), second);
    expect(second.statusCode).toBe(200);
    expect(fetchMock.mock.calls.length).toBeGreaterThan(callsAfterFirst);
  });

  it('falls back to last-known-good for a non-empty failure too (upstream 5xx, single attempt)', async () => {
    vi.useFakeTimers({ now: at(0), toFake: ['Date'] });
    const good = { ...EMPTY_BODY, ee33ff: AC };
    let broken = false;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      (broken ? { ok: false, status: 500, text: async () => 'upstream exploded' } : { ok: true, json: async () => good }));

    const seed = createRes();
    await handler(feedReq('UAL'), seed);
    expect(seed.statusCode).toBe(200);

    vi.setSystemTime(at(20_000));
    broken = true;

    const res = createRes();
    await handler(feedReq('UAL'), res);
    expect(res.statusCode).toBe(200); // was a 502
    expect(res.body).toEqual(good);
    expect(res.headers['X-BB-Feed-Stale']).toBe('20');
    // A hard failure is not the empty-body glitch: exactly ONE upstream attempt (seed + this one).
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('serves last-known-good on an aborted (timed-out) upstream too', async () => {
    // The third failure mode the stale-serve comment claims to cover, alongside empty + 5xx.
    vi.useFakeTimers({ now: at(0), toFake: ['Date'] });
    const good = { ...EMPTY_BODY, gg55hh: AC };
    let hung = false;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      if (hung) throw Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
      return { ok: true, json: async () => good };
    });

    await handler(feedReq('UAL'), createRes());
    vi.setSystemTime(at(35_000));
    hung = true;

    const res = createRes();
    await handler(feedReq('UAL'), res);
    expect(res.statusCode).toBe(200); // was a 504
    expect(res.body).toEqual(good);
    expect(res.headers['X-BB-Feed-Stale']).toBe('35');
  });

  it('still 503s when both attempts are empty and there is no last-known-good payload', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => EMPTY_BODY });

    const res = createRes();
    await handler(feedReq('UAL'), res);

    expect(res.statusCode).toBe(503);
    expect(res.headers['Cache-Control']).toBe('no-store');
    expect(res.headers['X-BB-Feed-Stale']).toBeUndefined();
  });

  it('refuses to serve a last-known-good payload older than the 180s ceiling', async () => {
    vi.useFakeTimers({ now: at(0), toFake: ['Date'] });
    let empty = false;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => ({
      ok: true,
      json: async () => (empty ? EMPTY_BODY : { ...EMPTY_BODY, gg44hh: AC }),
    }));

    const seed = createRes();
    await handler(feedReq('UAL'), seed);
    expect(seed.statusCode).toBe(200);

    // 4 min later the payload is older than the client would ever call "live" — fail honestly.
    vi.setSystemTime(at(240_000));
    empty = true;

    const res = createRes();
    await handler(feedReq('UAL'), res);
    expect(res.statusCode).toBe(503);
    expect(res.headers['X-BB-Feed-Stale']).toBeUndefined();
  });

  it('serves AT the ceiling and refuses one millisecond past it', async () => {
    // The comparison is `ageMs <= staleServeMaxMs`; pin both sides of the boundary so a future
    // refactor to `<` (or a re-typed literal ceiling) cannot slip through.
    const seedThenFailAt = async (offsetMs) => {
      resetFeedTestState();
      vi.useFakeTimers({ now: at(0), toFake: ['Date'] });
      let empty = false;
      vi.spyOn(globalThis, 'fetch').mockImplementation(async () => ({
        ok: true,
        json: async () => (empty ? EMPTY_BODY : { ...EMPTY_BODY, hh66ii: AC }),
      }));
      await handler(feedReq('UAL'), createRes());
      vi.setSystemTime(at(offsetMs));
      empty = true;
      const res = createRes();
      await handler(feedReq('UAL'), res);
      return res;
    };

    const exactly = await seedThenFailAt(FEED_FRESH_MS);
    expect(exactly.statusCode).toBe(200);
    expect(exactly.headers['X-BB-Feed-Stale']).toBe('180');
    // Nothing left of the window — the body may be served once, but never cached by an edge.
    expect(exactly.headers['Cache-Control']).toBe('no-store');

    const past = await seedThenFailAt(FEED_FRESH_MS + 1);
    expect(past.statusCode).toBe(503);
    expect(past.headers['X-BB-Feed-Stale']).toBeUndefined();
  });

  it('clamps the stale-serve CDN TTL inside the remaining freshness window', async () => {
    // Unconditional no-store made every client in an outage re-ask the origin independently; an
    // unclamped TTL would let an edge keep serving a body past the age the client calls live.
    const seedThenFailAt = async (offsetMs) => {
      resetFeedTestState();
      vi.useFakeTimers({ now: at(0), toFake: ['Date'] });
      let empty = false;
      vi.spyOn(globalThis, 'fetch').mockImplementation(async () => ({
        ok: true,
        json: async () => (empty ? EMPTY_BODY : { ...EMPTY_BODY, ii77jj: AC }),
      }));
      await handler(feedReq('UAL'), createRes());
      vi.setSystemTime(at(offsetMs));
      empty = true;
      const res = createRes();
      await handler(feedReq('UAL'), res);
      return res;
    };

    // Young: 160s of window left, so the 15s fresh-path cap is what binds.
    expect((await seedThenFailAt(20_000)).headers['Cache-Control']).toBe('s-maxage=15');
    // Nearly expired: only 10s left, so the window binds instead of the cap.
    expect((await seedThenFailAt(170_000)).headers['Cache-Control']).toBe('s-maxage=10');
    // Exactly spent: nothing may be cached.
    expect((await seedThenFailAt(FEED_FRESH_MS)).headers['Cache-Control']).toBe('no-store');
  });

  it('a burst of other-airline requests cannot evict UAL last-known-good (single UAL-only slot)', async () => {
    // The whole point of making the slot UAL-only: `airline` is caller-controlled and needs no Origin
    // header, so ANY per-airline store — however carefully LRU'd — lets a handful of curl requests
    // with real ICAO codes push out the one payload the dashboard falls back to. Here that burst runs
    // and UAL still stale-serves.
    vi.useFakeTimers({ now: at(0), toFake: ['Date'] });
    let empty = false;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (empty) return { ok: true, json: async () => EMPTY_BODY };
      const airline = new URL(url).searchParams.get('airline');
      return { ok: true, json: async () => ({ ...EMPTY_BODY, [`ac${airline}`]: AC }) };
    });

    await handler(feedReq('UAL'), createRes());
    for (const code of ['AAL', 'DAL', 'SWA', 'ASA', 'JBU', 'FFT', 'NKS', 'SKW', 'ACA', 'BAW']) {
      await handler(feedReq(code), createRes());
    }

    vi.setSystemTime(at(30_000));
    empty = true;

    const ual = createRes();
    await handler(feedReq('UAL'), ual);
    expect(ual.statusCode).toBe(200);
    expect(ual.body.acUAL).toEqual(AC);
    expect(ual.headers['X-BB-Feed-Stale']).toBe('30');
  });

  it('never remembers a non-UAL payload: a later failure for that code is a plain 5xx', async () => {
    // A successful AAL request must leave no last-known-good behind — otherwise the slot is
    // reachable (and therefore poisonable/evictable) from the open airline param after all.
    vi.useFakeTimers({ now: at(0), toFake: ['Date'] });
    let broken = false;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      (broken ? { ok: false, status: 500, text: async () => 'boom' } : { ok: true, json: async () => ({ ...EMPTY_BODY, acAAL: AC }) }));

    const seed = createRes();
    await handler(feedReq('AAL'), seed);
    expect(seed.statusCode).toBe(200);

    vi.setSystemTime(at(20_000));
    broken = true;

    const res = createRes();
    await handler(feedReq('AAL'), res);
    expect(res.statusCode).toBe(502);
    expect(res.headers['X-BB-Feed-Stale']).toBeUndefined();
  });

  it('honours FR24_FEED_STALE_SERVE_MAX_MS=0 as an explicit stale-serve kill switch', async () => {
    vi.useFakeTimers({ now: at(0), toFake: ['Date'] });
    let empty = false;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => ({
      ok: true,
      json: async () => (empty ? EMPTY_BODY : { ...EMPTY_BODY, ii55jj: AC }),
    }));

    const seed = createRes();
    await handler(feedReq('UAL'), seed);
    expect(seed.statusCode).toBe(200);

    vi.setSystemTime(at(20_000));
    empty = true;
    process.env.FR24_FEED_STALE_SERVE_MAX_MS = '0';

    const res = createRes();
    await handler(feedReq('UAL'), res);
    // A 20s-old payload is well inside the default ceiling; 0 must still mean "never".
    expect(res.statusCode).toBe(503);
    expect(res.headers['X-BB-Feed-Stale']).toBeUndefined();
  });

  it('treats a blank or garbage FR24_FEED_STALE_SERVE_MAX_MS as UNSET, and honours a real override', async () => {
    // Number('') is 0, so a defined-but-empty env row (Vercel's default for a value-less variable)
    // used to silently arm the kill switch above on a deploy nobody meant to change.
    const seedThenFailAt = async (envValue, offsetMs) => {
      resetFeedTestState();
      if (envValue !== undefined) process.env.FR24_FEED_STALE_SERVE_MAX_MS = envValue;
      vi.useFakeTimers({ now: at(0), toFake: ['Date'] });
      let empty = false;
      vi.spyOn(globalThis, 'fetch').mockImplementation(async () => ({
        ok: true,
        json: async () => (empty ? EMPTY_BODY : { ...EMPTY_BODY, jj88kk: AC }),
      }));
      await handler(feedReq('UAL'), createRes());
      vi.setSystemTime(at(offsetMs));
      empty = true;
      const res = createRes();
      await handler(feedReq('UAL'), res);
      return res;
    };

    for (const bad of ['', '   ', 'abc', '-1']) {
      const res = await seedThenFailAt(bad, 40_000);
      expect(res.statusCode, `env=${JSON.stringify(bad)}`).toBe(200);
      expect(res.headers['X-BB-Feed-Stale'], `env=${JSON.stringify(bad)}`).toBe('40');
    }

    // A real value is obeyed in both directions.
    expect((await seedThenFailAt('60000', 40_000)).statusCode).toBe(200);
    expect((await seedThenFailAt('60000', 90_000)).statusCode).toBe(503);
  });

  it('clamps FR24_FEED_STALE_SERVE_MAX_MS to the client freshness window — an hour reads as 180s', async () => {
    // The knob only ever gets reached for during an outage, and only ever moves the wrong way. An
    // operator setting 3600000 would have us serving hour-old positions as clean 200s that the client
    // then stamps into the reg-sightings ledger as fresh sightings, so the env can tighten the
    // ceiling but never loosen it.
    const seedThenFailAt = async (offsetMs) => {
      resetFeedTestState();
      process.env.FR24_FEED_STALE_SERVE_MAX_MS = '3600000';
      vi.useFakeTimers({ now: at(0), toFake: ['Date'] });
      let empty = false;
      vi.spyOn(globalThis, 'fetch').mockImplementation(async () => ({
        ok: true,
        json: async () => (empty ? EMPTY_BODY : { ...EMPTY_BODY, kk99ll: AC }),
      }));
      await handler(feedReq('UAL'), createRes());
      vi.setSystemTime(at(offsetMs));
      empty = true;
      const res = createRes();
      await handler(feedReq('UAL'), res);
      return res;
    };

    // Inside the real 180s ceiling: served, exactly as the default would.
    const inside = await seedThenFailAt(170_000);
    expect(inside.statusCode).toBe(200);
    expect(inside.headers['X-BB-Feed-Stale']).toBe('170');

    // Past it: refused, even though the operator's literal value would have allowed it.
    const past = await seedThenFailAt(190_000);
    expect(past.statusCode).toBe(503);
    expect(past.headers['X-BB-Feed-Stale']).toBeUndefined();
  });
});

// R1 (Aug 4 2026): the server's "is this feed empty?" predicate used to count array-valued keys while
// the client's parseFr24Feed additionally drops entries with no lat/lon. A degraded payload of
// positionless aircraft therefore counted as SUCCESS server-side — cached, written to the
// last-known-good slot, and stale-served for the next three minutes — while every client parsed zero
// flights and rendered NO DATA. A permanent lie is worse than the 503 the guard exists to raise, so
// both sides now run the same parse.
describe('fr24-feed emptiness predicate matches the client parse', () => {
  const T0 = '2026-08-04T18:00:00Z';
  const at = (ms) => new Date(Date.parse(T0) + ms);

  beforeEach(resetFeedTestState);
  afterEach(cleanupFeedTestEnv);

  it('treats a payload of positionless aircraft entries as an EMPTY feed, not a success', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ ...EMPTY_BODY, zz11: AC_NO_POSITION, zz22: AC_NO_POSITION }),
    });

    const res = createRes();
    await handler(feedReq('UAL'), res);

    // Key-counting would have made this a cached 200 with two "aircraft".
    expect(res.statusCode).toBe(503);
    expect(res.body.error).toMatch(/empty feed/i);
    expect(res.headers['Cache-Control']).toBe('no-store');
    // United still gets its one retry — this is the same glitch class as a meta-only body.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not let a positionless payload overwrite (poison) the last-known-good slot', async () => {
    // The dangerous half of the old predicate: the degraded body was not merely served once, it
    // REPLACED a real payload, so the next three minutes of stale-serves handed out a body the
    // client parses as empty.
    vi.useFakeTimers({ now: at(0), toFake: ['Date'] });
    const good = { ...EMPTY_BODY, mm33nn: AC };
    let degraded = false;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => ({
      ok: true,
      json: async () => (degraded ? { ...EMPTY_BODY, zz11: AC_NO_POSITION } : good),
    }));

    await handler(feedReq('UAL'), createRes());
    vi.setSystemTime(at(30_000));
    degraded = true;

    const res = createRes();
    await handler(feedReq('UAL'), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(good);
    expect(res.headers['X-BB-Feed-Stale']).toBe('30');
  });

  it('accepts a mixed payload: one positioned aircraft among positionless ones is a real feed', async () => {
    // The predicate must not be "any entry is malformed" — FR24 sends the occasional junk row, and
    // a board with 699 good aircraft is not an outage.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ ...EMPTY_BODY, zz11: AC_NO_POSITION, oo44pp: AC }),
    });

    const res = createRes();
    await handler(feedReq('UAL'), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.oo44pp).toEqual(AC);
  });
});
