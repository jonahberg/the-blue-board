import { describe, it, expect, beforeEach, vi } from 'vitest';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://test.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
delete process.env.VERCEL_ENV;

const mockGetUser = vi.fn();
const mockFrom = vi.fn();
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ auth: { getUser: mockGetUser }, from: mockFrom })),
}));

const handler = (await import('../api/pro/push-subscribe.js')).default;

function makeReq(opts = {}) {
  const headers = opts.headers !== undefined
    ? opts.headers
    : { authorization: 'Bearer t', origin: 'https://theblueboard.co' };
  return {
    method: opts.method || 'POST',
    headers,
    body: opts.body || {},
  };
}
function makeRes() {
  const res = { statusCode: 200, body: null, headers: {} };
  res.status = vi.fn((c) => { res.statusCode = c; return res; });
  res.json = vi.fn((b) => { res.body = b; return res; });
  res.setHeader = vi.fn((k, v) => { res.headers[k] = v; });
  res.end = vi.fn(() => res);
  return res;
}

function mockAuthOk(userId = 'user-1') {
  mockGetUser.mockResolvedValueOnce({
    data: { user: { id: userId, email: 'a@b.com' } },
    error: null,
  });
}
function mockProSubscription() {
  const mockMaybeSingle = vi.fn(() => Promise.resolve({
    data: { status: 'active', current_period_end: new Date(Date.now() + 86_400_000).toISOString() },
    error: null,
  }));
  const mockEq = vi.fn(() => ({ maybeSingle: mockMaybeSingle }));
  const mockSelect = vi.fn(() => ({ eq: mockEq }));
  mockFrom.mockReturnValueOnce({ select: mockSelect });
}
function mockUpsertOk() {
  const mockUpsert = vi.fn(() => Promise.resolve({ data: [{ id: 1 }], error: null }));
  mockFrom.mockReturnValueOnce({ upsert: mockUpsert });
}

describe('POST /api/pro/push-subscribe', () => {
  beforeEach(() => {
    mockGetUser.mockReset();
    mockFrom.mockReset();
    delete process.env.PRO_ENABLED;
    delete process.env.PRO_FEATURE_PUSH_ENABLED;
  });

  it('returns 401 when not authenticated', async () => {
    const res = makeRes();
    await handler(makeReq({ headers: {} }), res);
    expect(res.statusCode).toBe(401);
  });

  it('returns 403 when not Pro', async () => {
    mockAuthOk();
    const mockMaybeSingle = vi.fn(() => Promise.resolve({ data: null, error: null }));
    const mockEq = vi.fn(() => ({ maybeSingle: mockMaybeSingle }));
    const mockSelect = vi.fn(() => ({ eq: mockEq }));
    mockFrom.mockReturnValueOnce({ select: mockSelect });
    const res = makeRes();
    await handler(makeReq({ body: { delivery: 'email' } }), res);
    expect(res.statusCode).toBe(403);
  });

  it('returns 503 when push kill switch off', async () => {
    process.env.PRO_FEATURE_PUSH_ENABLED = 'false';
    mockAuthOk();
    mockProSubscription();
    const res = makeRes();
    await handler(makeReq({ body: { delivery: 'email' } }), res);
    expect(res.statusCode).toBe(503);
  });

  it('returns 405 for non-POST', async () => {
    mockAuthOk();
    mockProSubscription();
    const res = makeRes();
    await handler(makeReq({ method: 'GET' }), res);
    expect(res.statusCode).toBe(405);
  });

  it('upserts a push subscription with delivery=push', async () => {
    mockAuthOk('user-1');
    mockProSubscription();
    mockUpsertOk();
    const res = makeRes();
    await handler(
      makeReq({
        body: {
          delivery: 'push',
          subscription: {
            endpoint: 'https://fcm.test/abc',
            keys: { p256dh: 'k1', auth: 'a1' },
          },
          user_agent: 'Mozilla/5.0',
        },
      }),
      res
    );
    expect(res.statusCode).toBe(201);
  });

  it('upserts an email-fallback subscription (iOS non-installer)', async () => {
    mockAuthOk('user-1');
    mockProSubscription();
    mockUpsertOk();
    const res = makeRes();
    await handler(
      makeReq({
        body: { delivery: 'email' },
      }),
      res
    );
    expect(res.statusCode).toBe(201);
  });

  it('returns 400 when delivery is push but subscription missing', async () => {
    mockAuthOk();
    mockProSubscription();
    const res = makeRes();
    await handler(makeReq({ body: { delivery: 'push' } }), res);
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 for unknown delivery type', async () => {
    mockAuthOk();
    mockProSubscription();
    const res = makeRes();
    await handler(makeReq({ body: { delivery: 'sms' } }), res);
    expect(res.statusCode).toBe(400);
  });
});
