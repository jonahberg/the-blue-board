import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The cron orchestrator is mocked at its module seams: cron auth, Supabase, and Web Push are
// stubbed so we exercise the real evaluate→notify→send→persist control flow (evaluateWatch stays
// real) without any network or DB. global.fetch is stubbed per URL: /api/flight-times for the resolve
// step, and the public FR24 feed for the once-per-run sightings harvest.
//
// Since Oct 4 2026 a watch is tied to ONE dated leg and its first evaluation is a silent baseline
// (api/_watch-diff.ts). The notify-path tests below therefore start from a watch already PINNED to
// the leg flightResponse() describes (PINNED), where they used to start from {lastStatus:'Scheduled'}
// — an unpinned entry like that now baselines without a push (see the legacy test at the end).
vi.mock('../api/_cron-auth.js', () => ({ isAuthorizedCronRequest: vi.fn(() => true) }));
vi.mock('../api/_supabase.js', () => ({ getSupabase: vi.fn() }));
vi.mock('../api/_web-push.js', () => ({
  isPushConfigured: vi.fn(() => true),
  ensureVapidConfigured: vi.fn(() => true),
  sendPush: vi.fn(() => Promise.resolve({ ok: true, statusCode: 201, gone: false })),
}));
// The 24-hour airborne graph's sampler (api/_airborne-samples.ts) has its own tests; here only its
// call contract matters: once per run with the parsed feed, never on a failed read, never fatal.
vi.mock('../api/_airborne-samples.js', () => ({
  recordAirborneSample: vi.fn(async (parsed) => ({ recorded: true, airborne: parsed.length })),
}));

import handler from '../api/cron/watch-alerts.js';
import { isAuthorizedCronRequest } from '../api/_cron-auth.js';
import { getSupabase } from '../api/_supabase.js';
import { isPushConfigured, ensureVapidConfigured, sendPush } from '../api/_web-push.js';
import { recordAirborneSample } from '../api/_airborne-samples.js';

// Build a chainable Supabase mock covering the two shapes the handler uses:
//   loadAllSubscriptions: from().select().order().range()  → { data, error }
//   persist:              from().delete().eq()  /  from().update(payload).eq()  → { error }
function makeSupabase({ rows = [], loadError = null, writeError = null } = {}) {
  const calls = { deletes: [], updates: [] };
  const client = {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        order: vi.fn(() => ({
          range: vi.fn((from) =>
            Promise.resolve(from === 0 ? { data: rows, error: loadError } : { data: [], error: null })
          ),
        })),
      })),
      delete: vi.fn(() => ({
        eq: vi.fn((col, val) => {
          calls.deletes.push({ col, val });
          return Promise.resolve({ error: writeError });
        }),
      })),
      update: vi.fn((payload) => ({
        eq: vi.fn((col, val) => {
          calls.updates.push({ payload, col, val });
          return Promise.resolve({ error: writeError });
        }),
      })),
    })),
  };
  return { client, calls };
}

const LEG_DEP = '2026-10-03T18:00:00.000Z';
// A /api/flight-times response for the resolve step. success:false or ok:false → resolve miss (null).
function flightResponse({ ok = true, status = 'Departed', gate = 'C1', registration = 'N1', success = true, actualDep } = {}) {
  const departed = /depart|route/i.test(status);
  return {
    ok,
    json: async () => ({
      success, status, origin: { iata: 'ORD', gate, tz: 'America/Chicago' }, destination: { iata: 'SFO' }, registration,
      departure: { gate: { scheduled: LEG_DEP, estimated: '', actual: actualDep ?? (departed ? '2026-10-03T18:03:00.000Z' : '') } },
      arrival: { gate: {}, landing: {} },
    }),
  };
}
/** A watch already pinned to flightResponse()'s leg, before it left. */
const PINNED = (flight = 'UA1') => ({ flight, legDep: LEG_DEP, legOrigin: 'ORD', legDest: 'SFO', legDate: '2026-10-03', phase: 'scheduled', lastStatus: 'Scheduled', delayBucket: 0 });
const isFeed = (url) => String(url).includes('data-cloud.flightradar24.com');
const flightTimesCalls = (fetchMock) => fetchMock.mock.calls.filter(([url]) => !isFeed(url));
const feedCalls = (fetchMock) => fetchMock.mock.calls.filter(([url]) => isFeed(url));
// [icao24, lat, lon, hdg, alt ft, spd kt, squawk, radar, type, reg, ts, origin, dest, flight, onGround, vr fpm, callsign]
const LIVE_FEED = {
  full_count: 2,
  version: 4,
  a1: ['A1B2C3', 41.9, -88.5, 270, 23000, 420, '1234', '', 'B739', 'N11111', 0, 'ORD', 'SFO', 'UA1', 0, 1500, 'UAL1'],
  a2: ['A1B2C4', 41.97, -87.9, 0, 0, 0, '', '', 'B772', 'N22222', 0, 'ORD', 'LHR', 'UA930', 1, 0, 'UAL930'],
};
/** fetch that answers the live feed with `feed` and /api/flight-times with flightResponse(). */
const routedFetch = (feed) => vi.fn((url) =>
  Promise.resolve(isFeed(url) ? { ok: true, json: async () => feed } : flightResponse()));
const NOW_MS = Date.parse('2026-10-03T18:20:00.000Z');

function makeReq(overrides = {}) {
  return { method: 'GET', headers: { authorization: 'Bearer secret' }, query: {}, ...overrides };
}

function makeRes() {
  const res = {
    _status: 0,
    _json: null,
    status(code) { res._status = code; return res; },
    json(data) { res._json = data; return res; },
    end() { return res; },
  };
  return res;
}

describe('watch-alerts cron', () => {
  let fetchMock;

  beforeEach(() => {
    vi.clearAllMocks();
    isAuthorizedCronRequest.mockReturnValue(true);
    isPushConfigured.mockReturnValue(true);
    ensureVapidConfigured.mockReturnValue(true);
    sendPush.mockResolvedValue({ ok: true, statusCode: 201, gone: false });
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://test.supabase.co';
    process.env.FR24_EMPTY_RETRY_DELAY_MS = '0';
    // One feed read = one United request in these cases; the Express-operator second request is
    // covered in tests/united-feed.test.js and tests/fr24-feed.test.js.
    process.env.FR24_EXPRESS_OPERATOR_FEED = '0';
    recordAirborneSample.mockImplementation(async (parsed) => ({ recorded: true, airborne: parsed.length }));
    fetchMock = vi.fn(() => Promise.resolve(flightResponse()));
    globalThis.fetch = fetchMock;
    vi.useFakeTimers({ toFake: ['Date'], now: NOW_MS });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.FR24_EMPTY_RETRY_DELAY_MS;
    delete process.env.FR24_EXPRESS_OPERATOR_FEED;
  });

  it('returns 401 and touches nothing when the cron request is unauthorized', async () => {
    isAuthorizedCronRequest.mockReturnValue(false);
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(401);
    expect(getSupabase).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(sendPush).not.toHaveBeenCalled();
  });

  it('when push is unconfigured: still takes the airborne sample, then no-ops with 200 {configured:false}', async () => {
    isPushConfigured.mockReturnValue(false);
    fetchMock = routedFetch(LIVE_FEED);
    globalThis.fetch = fetchMock;
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(200);
    expect(res._json.configured).toBe(false);
    expect(getSupabase).not.toHaveBeenCalled();
    expect(feedCalls(fetchMock)).toHaveLength(1);
    expect(flightTimesCalls(fetchMock)).toHaveLength(0);
    expect(recordAirborneSample).toHaveBeenCalledTimes(1);
    expect(res._json.airborneSample).toEqual({ recorded: true, airborne: 2 });
    expect(sendPush).not.toHaveBeenCalled();
  });

  it('no-ops with 200 {configured:false} when NEXT_PUBLIC_SUPABASE_URL is absent — no feed read, no sample', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(200);
    expect(res._json.configured).toBe(false);
    expect(getSupabase).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(recordAirborneSample).not.toHaveBeenCalled();
  });

  describe('the 24-hour airborne sample (one per run, from the one feed read)', () => {
    it('records exactly one sample per run from the parsed feed, even with no live watch', async () => {
      const { client } = makeSupabase({ rows: [] });
      getSupabase.mockReturnValue(client);
      fetchMock = routedFetch(LIVE_FEED);
      globalThis.fetch = fetchMock;
      const res = makeRes();
      await handler(makeReq(), res);
      expect(res._status).toBe(200);
      expect(feedCalls(fetchMock)).toHaveLength(1);
      expect(recordAirborneSample).toHaveBeenCalledTimes(1);
      const [parsed, atMs] = recordAirborneSample.mock.calls[0];
      expect(parsed.map((f) => f.fr24id).sort()).toEqual(['a1', 'a2']);
      expect(atMs).toBe(NOW_MS);
      // Nobody is watching → the sightings harvest is still skipped, as before.
      expect(res._json.liveFeed).toEqual({ skipped: true });
      expect(res._json.airborneSample).toEqual({ recorded: true, airborne: 2 });
    });

    it('records NOTHING when the feed body is meta-only, after retrying the read once (a gap, never a zero)', async () => {
      const { client } = makeSupabase({ rows: [] });
      getSupabase.mockReturnValue(client);
      fetchMock = routedFetch({ full_count: 0, version: 4 });
      globalThis.fetch = fetchMock;
      const res = makeRes();
      await handler(makeReq(), res);
      expect(res._status).toBe(200);
      expect(feedCalls(fetchMock)).toHaveLength(2);
      expect(recordAirborneSample).not.toHaveBeenCalled();
      expect(res._json.airborneSample).toEqual({ recorded: false, reason: 'feed read failed' });
    });

    it('a meta-only first body that recovers on the retry is sampled once', async () => {
      const { client } = makeSupabase({ rows: [] });
      getSupabase.mockReturnValue(client);
      let feedReads = 0;
      fetchMock = vi.fn((url) => {
        if (!isFeed(url)) return Promise.resolve(flightResponse());
        feedReads++;
        return Promise.resolve({ ok: true, json: async () => (feedReads === 1 ? { full_count: 0, version: 4 } : LIVE_FEED) });
      });
      globalThis.fetch = fetchMock;
      const res = makeRes();
      await handler(makeReq(), res);
      expect(feedReads).toBe(2);
      expect(recordAirborneSample).toHaveBeenCalledTimes(1);
    });

    it('records nothing on an HTTP error or a network throw, and the run still succeeds', async () => {
      const { client } = makeSupabase({ rows: [] });
      getSupabase.mockReturnValue(client);
      globalThis.fetch = vi.fn((url) => (isFeed(url) ? Promise.resolve({ ok: false, status: 503 }) : Promise.resolve(flightResponse())));
      let res = makeRes();
      await handler(makeReq(), res);
      expect(res._status).toBe(200);
      globalThis.fetch = vi.fn((url) => (isFeed(url) ? Promise.reject(new Error('ECONNRESET')) : Promise.resolve(flightResponse())));
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      res = makeRes();
      await handler(makeReq(), res);
      expect(res._status).toBe(200);
      expect(recordAirborneSample).not.toHaveBeenCalled();
    });

    it('a sample writer that rejects never fails the run', async () => {
      const { client } = makeSupabase({ rows: [] });
      getSupabase.mockReturnValue(client);
      globalThis.fetch = routedFetch(LIVE_FEED);
      recordAirborneSample.mockRejectedValue(new Error('supabase down'));
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const res = makeRes();
      await handler(makeReq(), res);
      expect(res._status).toBe(200);
      expect(res._json.configured).toBe(true);
      expect(res._json.airborneSample).toEqual({ recorded: false, reason: 'write threw' });
    });

    it('the sightings harvest reuses the same read when a watch is live (one feed fetch, not two)', async () => {
      const { client } = makeSupabase({
        rows: [{ id: 's1', endpoint: 'https://push/s1', p256dh: 'p', auth: 'a', failed_count: 0, watches: [PINNED()] }],
      });
      getSupabase.mockReturnValue(client);
      fetchMock = routedFetch(LIVE_FEED);
      globalThis.fetch = fetchMock;
      const res = makeRes();
      await handler(makeReq(), res);
      expect(feedCalls(fetchMock)).toHaveLength(1);
      expect(recordAirborneSample).toHaveBeenCalledTimes(1);
      expect(res._json.liveFeed.ok).toBe(true);
    });
  });

  it('treats a missing watch_subscriptions table (Postgres 42P01) as unconfigured → 200', async () => {
    const { client } = makeSupabase({
      loadError: { message: 'relation "watch_subscriptions" does not exist', code: '42P01' },
    });
    getSupabase.mockReturnValue(client);
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(200);
    expect(res._json.configured).toBe(false);
    expect(res._json.skipped).toMatch(/not provisioned/);
    expect(sendPush).not.toHaveBeenCalled();
  });

  it('returns 500 on a non-42P01 subscription load error', async () => {
    const { client } = makeSupabase({
      loadError: { message: 'connection reset', code: '08006' },
    });
    getSupabase.mockReturnValue(client);
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(500);
  });

  it('sends a push and persists the new state on a significant status change, resetting failed_count', async () => {
    const { client, calls } = makeSupabase({
      rows: [{ id: 's1', endpoint: 'https://push/s1', p256dh: 'p', auth: 'a', failed_count: 0,
        watches: [PINNED()] }],
    });
    getSupabase.mockReturnValue(client);
    fetchMock.mockResolvedValue(flightResponse({ status: 'Departed' }));

    const res = makeRes();
    await handler(makeReq(), res);

    expect(res._status).toBe(200);
    expect(res._json.configured).toBe(true);
    expect(res._json.sends).toBe(1);
    expect(res._json.subsUpdated).toBe(1);
    expect(sendPush).toHaveBeenCalledTimes(1);
    const [target, payload] = sendPush.mock.calls[0];
    expect(target.endpoint).toBe('https://push/s1');
    // Tagged with the LEG's date, so tomorrow's alert for the same flight never replaces today's.
    expect(payload.tag).toBe('ua1-2026-10-03');
    expect(payload.url).toBe('/?flight=UA1');
    // State persisted with the new status and failed_count zeroed.
    expect(calls.updates).toHaveLength(1);
    expect(calls.updates[0].payload.watches[0].lastStatus).toBe('Departed');
    expect(calls.updates[0].payload.watches[0].phase).toBe('departed');
    expect(calls.updates[0].payload.failed_count).toBe(0);
  });

  it('does NOT notify or persist when the resolve step misses (upstream null)', async () => {
    const { client, calls } = makeSupabase({
      rows: [{ id: 's1', endpoint: 'https://push/s1', p256dh: 'p', auth: 'a', failed_count: 0,
        watches: [PINNED()] }],
    });
    getSupabase.mockReturnValue(client);
    fetchMock.mockResolvedValue(flightResponse({ ok: false }));

    const res = makeRes();
    await handler(makeReq(), res);

    expect(res._json.resolved).toBe(0);
    expect(res._json.sends).toBe(0);
    expect(sendPush).not.toHaveBeenCalled();
    expect(calls.updates).toHaveLength(0);
  });

  it('deletes the whole subscription when a push comes back gone (404/410)', async () => {
    const { client, calls } = makeSupabase({
      rows: [{ id: 's1', endpoint: 'https://push/s1', p256dh: 'p', auth: 'a', failed_count: 0,
        watches: [PINNED()] }],
    });
    getSupabase.mockReturnValue(client);
    fetchMock.mockResolvedValue(flightResponse({ status: 'Departed' }));
    sendPush.mockResolvedValue({ ok: false, statusCode: 410, gone: true });

    const res = makeRes();
    await handler(makeReq(), res);

    expect(res._json.subsDeleted).toBe(1);
    expect(res._json.subsUpdated).toBe(0);
    expect(calls.deletes).toHaveLength(1);
    expect(calls.deletes[0].val).toBe('s1');
    expect(calls.updates).toHaveLength(0);
  });

  it('deletes a subscription that arrives already at MAX_FAILS', async () => {
    const { client, calls } = makeSupabase({
      rows: [{ id: 's1', endpoint: 'https://push/s1', p256dh: 'p', auth: 'a', failed_count: 3,
        watches: [{ ...PINNED(), phase: 'departed', lastStatus: 'Departed' }] }],
    });
    getSupabase.mockReturnValue(client);
    fetchMock.mockResolvedValue(flightResponse({ status: 'Departed' })); // same status → no notify

    const res = makeRes();
    await handler(makeReq(), res);

    expect(sendPush).not.toHaveBeenCalled();
    expect(res._json.subsDeleted).toBe(1);
    expect(calls.deletes[0].val).toBe('s1');
  });

  it('bumps (not resets) failed_count when a send fails without going gone', async () => {
    const { client, calls } = makeSupabase({
      rows: [{ id: 's1', endpoint: 'https://push/s1', p256dh: 'p', auth: 'a', failed_count: 1,
        watches: [PINNED()] }],
    });
    getSupabase.mockReturnValue(client);
    fetchMock.mockResolvedValue(flightResponse({ status: 'Departed' }));
    sendPush.mockResolvedValue({ ok: false, statusCode: 500, gone: false });

    const res = makeRes();
    await handler(makeReq(), res);

    expect(res._json.failuresBumped).toBe(1);
    expect(res._json.subsDeleted).toBe(0);
    expect(calls.updates).toHaveLength(1);
    expect(calls.updates[0].payload.failed_count).toBe(2);
  });

  it('caps upstream lookups at MAX_DISTINCT_FLIGHTS (50) and flags flightsCapped', async () => {
    const watches = Array.from({ length: 60 }, (_, i) => PINNED('UA' + (i + 1)));
    const { client } = makeSupabase({
      rows: [{ id: 's1', endpoint: 'https://push/s1', p256dh: 'p', auth: 'a', failed_count: 0, watches }],
    });
    getSupabase.mockReturnValue(client);
    fetchMock.mockResolvedValue(flightResponse({ status: 'Departed' }));

    const res = makeRes();
    await handler(makeReq(), res);

    // 50 /api/flight-times lookups; the one live-feed harvest is not a lookup.
    expect(flightTimesCalls(fetchMock)).toHaveLength(50);
    expect(res._json.flightsCapped).toBe(true);
    expect(res._json.distinctFlights).toBe(60);
  });

  it('caps sends at MAX_SENDS_PER_RUN (200) and flags sendCapReached', async () => {
    const rows = Array.from({ length: 210 }, (_, i) => ({
      id: 's' + i, endpoint: 'https://push/s' + i, p256dh: 'p', auth: 'a', failed_count: 0,
      watches: [PINNED()],
    }));
    const { client } = makeSupabase({ rows });
    getSupabase.mockReturnValue(client);
    fetchMock.mockResolvedValue(flightResponse({ status: 'Departed' }));

    const res = makeRes();
    await handler(makeReq(), res);

    expect(res._json.sends).toBe(200);
    expect(res._json.sendCapReached).toBe(true);
    expect(sendPush).toHaveBeenCalledTimes(200);
  });

  it('stops resolving and flags resolveDeadlineHit once the wall-clock deadline trips', async () => {
    const { client } = makeSupabase({
      rows: [{ id: 's1', endpoint: 'https://push/s1', p256dh: 'p', auth: 'a', failed_count: 0,
        watches: [PINNED()] }],
    });
    getSupabase.mockReturnValue(client);
    // First Date.now() call = runStart; the loop-guard call jumps past the deadline → break.
    const nowSpy = vi.spyOn(Date, 'now');
    nowSpy.mockReturnValueOnce(1000).mockReturnValue(1000 + 100_001);

    const res = makeRes();
    await handler(makeReq(), res);

    expect(res._json.resolveDeadlineHit).toBe(true);
    expect(res._json.resolved).toBe(0);
    // The run's one live-feed read (the airborne sample) happens first; no leg is resolved.
    expect(flightTimesCalls(fetchMock)).toHaveLength(0);
  });

  it('counts a persist write error instead of silently swallowing it (dedup safety)', async () => {
    const { client, calls } = makeSupabase({
      rows: [{ id: 's1', endpoint: 'https://push/s1', p256dh: 'p', auth: 'a', failed_count: 0,
        watches: [PINNED()] }],
      writeError: { message: 'row lock timeout' },
    });
    getSupabase.mockReturnValue(client);
    fetchMock.mockResolvedValue(flightResponse({ status: 'Departed' }));

    const res = makeRes();
    await handler(makeReq(), res);

    expect(sendPush).toHaveBeenCalledTimes(1);
    expect(res._json.writeErrors).toBe(1);
    expect(res._json.subsUpdated).toBe(0);
    expect(calls.updates).toHaveLength(1); // the write was attempted
  });
});
