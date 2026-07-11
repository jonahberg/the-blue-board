import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The cron orchestrator is mocked at its module seams: cron auth, Supabase, and Web Push are
// stubbed so we exercise the real diff→notify→send→persist control flow (diffWatch stays real)
// without any network or DB. global.fetch is stubbed for the /api/flight-times resolve step.
vi.mock('../api/_cron-auth.js', () => ({ isAuthorizedCronRequest: vi.fn(() => true) }));
vi.mock('../api/_supabase.js', () => ({ getSupabase: vi.fn() }));
vi.mock('../api/_web-push.js', () => ({
  isPushConfigured: vi.fn(() => true),
  ensureVapidConfigured: vi.fn(() => true),
  sendPush: vi.fn(() => Promise.resolve({ ok: true, statusCode: 201, gone: false })),
}));

import handler from '../api/cron/watch-alerts.js';
import { isAuthorizedCronRequest } from '../api/_cron-auth.js';
import { getSupabase } from '../api/_supabase.js';
import { isPushConfigured, ensureVapidConfigured, sendPush } from '../api/_web-push.js';

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

// A /api/flight-times response for resolveFlight. success:false or ok:false → resolve miss (null).
function flightResponse({ ok = true, status = 'Departed', gate = 'C1', registration = 'N1', success = true } = {}) {
  return {
    ok,
    json: async () => ({ success, status, origin: { gate }, registration }),
  };
}

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
    fetchMock = vi.fn(() => Promise.resolve(flightResponse()));
    globalThis.fetch = fetchMock;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
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

  it('no-ops with 200 {configured:false} when push is unconfigured', async () => {
    isPushConfigured.mockReturnValue(false);
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(200);
    expect(res._json.configured).toBe(false);
    expect(getSupabase).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(sendPush).not.toHaveBeenCalled();
  });

  it('no-ops with 200 {configured:false} when NEXT_PUBLIC_SUPABASE_URL is absent', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(200);
    expect(res._json.configured).toBe(false);
    expect(getSupabase).not.toHaveBeenCalled();
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
        watches: [{ flight: 'UA1', lastStatus: 'Scheduled' }] }],
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
    expect(payload.tag).toContain('ua1');
    expect(payload.url).toBe('/?flight=UA1');
    // State persisted with the new status and failed_count zeroed.
    expect(calls.updates).toHaveLength(1);
    expect(calls.updates[0].payload.watches[0].lastStatus).toBe('Departed');
    expect(calls.updates[0].payload.failed_count).toBe(0);
  });

  it('does NOT notify or persist when the resolve step misses (upstream null)', async () => {
    const { client, calls } = makeSupabase({
      rows: [{ id: 's1', endpoint: 'https://push/s1', p256dh: 'p', auth: 'a', failed_count: 0,
        watches: [{ flight: 'UA1', lastStatus: 'Scheduled' }] }],
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
        watches: [{ flight: 'UA1', lastStatus: 'Scheduled' }] }],
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
        watches: [{ flight: 'UA1', lastStatus: 'Departed' }] }],
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
        watches: [{ flight: 'UA1', lastStatus: 'Scheduled' }] }],
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
    const watches = Array.from({ length: 60 }, (_, i) => ({ flight: 'UA' + (i + 1), lastStatus: 'Scheduled' }));
    const { client } = makeSupabase({
      rows: [{ id: 's1', endpoint: 'https://push/s1', p256dh: 'p', auth: 'a', failed_count: 0, watches }],
    });
    getSupabase.mockReturnValue(client);
    fetchMock.mockResolvedValue(flightResponse({ status: 'Departed' }));

    const res = makeRes();
    await handler(makeReq(), res);

    expect(fetchMock).toHaveBeenCalledTimes(50);
    expect(res._json.flightsCapped).toBe(true);
    expect(res._json.distinctFlights).toBe(60);
  });

  it('caps sends at MAX_SENDS_PER_RUN (200) and flags sendCapReached', async () => {
    const rows = Array.from({ length: 210 }, (_, i) => ({
      id: 's' + i, endpoint: 'https://push/s' + i, p256dh: 'p', auth: 'a', failed_count: 0,
      watches: [{ flight: 'UA1', lastStatus: 'Scheduled' }],
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
        watches: [{ flight: 'UA1', lastStatus: 'Scheduled' }] }],
    });
    getSupabase.mockReturnValue(client);
    // First Date.now() call = runStart; the loop-guard call jumps past the deadline → break.
    const nowSpy = vi.spyOn(Date, 'now');
    nowSpy.mockReturnValueOnce(1000).mockReturnValue(1000 + 100_001);

    const res = makeRes();
    await handler(makeReq(), res);

    expect(res._json.resolveDeadlineHit).toBe(true);
    expect(res._json.resolved).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('counts a persist write error instead of silently swallowing it (dedup safety)', async () => {
    const { client, calls } = makeSupabase({
      rows: [{ id: 's1', endpoint: 'https://push/s1', p256dh: 'p', auth: 'a', failed_count: 0,
        watches: [{ flight: 'UA1', lastStatus: 'Scheduled' }] }],
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
