import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock @supabase/supabase-js so the real getSupabase() returns a mockable client.
const mockFrom = vi.fn();
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ from: mockFrom })),
}));

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://test.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
process.env.NODE_ENV = 'test';
delete process.env.VERCEL_ENV;

import handler from '../api/push-subscribe.js';
import { __resetRateLimitersForTests } from '../api/_rate-limit.js';

let ipCounter = 100;
function uniqueIp() { return '10.0.1.' + (ipCounter++); }

function makeReq(overrides = {}) {
  return {
    method: 'POST',
    headers: { origin: 'https://theblueboard.co', 'x-real-ip': uniqueIp() },
    body: {},
    query: {},
    ...overrides,
  };
}

function makeRes() {
  const res = {
    _status: 0,
    _json: null,
    _headers: {},
    status(code) { res._status = code; return res; },
    json(data) { res._json = data; return res; },
    end() { return res; },
    setHeader(k, v) { res._headers[k] = v; return res; },
  };
  return res;
}

const VALID_SUB = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
  keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
};

function setVapid() {
  process.env.WEB_PUSH_VAPID_PUBLIC_KEY = 'BPublicKey';
  process.env.WEB_PUSH_VAPID_PRIVATE_KEY = 'PrivateKey';
  process.env.WEB_PUSH_CONTACT = 'mailto:test@example.com';
}
function clearVapid() {
  delete process.env.WEB_PUSH_VAPID_PUBLIC_KEY;
  delete process.env.WEB_PUSH_VAPID_PRIVATE_KEY;
  delete process.env.WEB_PUSH_CONTACT;
}

describe('push-subscribe API', () => {
  let mockUpsert, mockDelete, deleteEq;

  beforeEach(() => {
    vi.clearAllMocks();
    __resetRateLimitersForTests();
    setVapid();
    mockUpsert = vi.fn(() => Promise.resolve({ error: null }));
    deleteEq = vi.fn(() => Promise.resolve({ error: null }));
    mockDelete = vi.fn(() => ({ eq: deleteEq }));
    mockFrom.mockReturnValue({ upsert: mockUpsert, delete: mockDelete });
  });

  afterEach(() => { clearVapid(); });

  it('GET returns configured:true + public key when VAPID env present', async () => {
    const res = makeRes();
    await handler(makeReq({ method: 'GET' }), res);
    expect(res._status).toBe(200);
    expect(res._json.configured).toBe(true);
    expect(res._json.vapidPublicKey).toBe('BPublicKey');
  });

  it('GET reports configured:false when VAPID env absent', async () => {
    clearVapid();
    const res = makeRes();
    await handler(makeReq({ method: 'GET' }), res);
    expect(res._status).toBe(200);
    expect(res._json.configured).toBe(false);
  });

  it('POST returns configured:false (200) when unconfigured — client falls back to in-tab', async () => {
    clearVapid();
    const res = makeRes();
    await handler(makeReq({ body: { subscription: VALID_SUB, watches: [{ flight: 'UA123' }] } }), res);
    expect(res._status).toBe(200);
    expect(res._json.configured).toBe(false);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('POST upserts a subscription by endpoint with sanitized watches', async () => {
    const res = makeRes();
    await handler(makeReq({
      body: { subscription: VALID_SUB, watches: [{ flight: 'ua123' }, { flight: 'UA456', date: '2026-07-08' }] },
    }), res);
    expect(res._status).toBe(200);
    expect(res._json.success).toBe(true);
    expect(mockUpsert).toHaveBeenCalledTimes(1);
    const [row, opts] = mockUpsert.mock.calls[0];
    expect(opts).toEqual({ onConflict: 'endpoint' });
    expect(row.endpoint).toBe(VALID_SUB.endpoint);
    expect(row.watches.map((w) => w.flight)).toEqual(['UA123', 'UA456']);
    expect(row.watches[1].date).toBe('2026-07-08');
    expect(row.failed_count).toBe(0);
  });

  it('POST rejects an invalid (non-https) endpoint', async () => {
    const res = makeRes();
    await handler(makeReq({
      body: { subscription: { endpoint: 'ftp://nope', keys: VALID_SUB.keys }, watches: [{ flight: 'UA1' }] },
    }), res);
    expect(res._status).toBe(400);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('POST drops invalid flight numbers and caps at 10 watches', async () => {
    const many = Array.from({ length: 15 }, (_, i) => ({ flight: 'UA' + (i + 1) }));
    many.push({ flight: 'DL999' }); // wrong airline — dropped
    const res = makeRes();
    await handler(makeReq({ body: { subscription: VALID_SUB, watches: many } }), res);
    const [row] = mockUpsert.mock.calls[0];
    expect(row.watches.length).toBe(10);
    expect(row.watches.every((w) => /^UA\d{1,4}$/.test(w.flight))).toBe(true);
  });

  it('POST with an empty watch list deletes the subscription row', async () => {
    const res = makeRes();
    await handler(makeReq({ body: { subscription: VALID_SUB, watches: [] } }), res);
    expect(res._status).toBe(200);
    expect(res._json.removed).toBe(true);
    expect(mockDelete).toHaveBeenCalledTimes(1);
    expect(deleteEq).toHaveBeenCalledWith('endpoint', VALID_SUB.endpoint);
  });

  it('POST action:unsubscribe deletes by endpoint', async () => {
    const res = makeRes();
    await handler(makeReq({ body: { action: 'unsubscribe', subscription: { endpoint: VALID_SUB.endpoint } } }), res);
    expect(res._status).toBe(200);
    expect(res._json.success).toBe(true);
    expect(deleteEq).toHaveBeenCalledWith('endpoint', VALID_SUB.endpoint);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('DELETE removes the subscription by endpoint', async () => {
    const res = makeRes();
    await handler(makeReq({ method: 'DELETE', body: { subscription: { endpoint: VALID_SUB.endpoint } } }), res);
    expect(res._status).toBe(200);
    expect(deleteEq).toHaveBeenCalledWith('endpoint', VALID_SUB.endpoint);
  });

  it('rejects unsupported methods', async () => {
    const res = makeRes();
    await handler(makeReq({ method: 'PUT' }), res);
    expect(res._status).toBe(405);
  });
});
