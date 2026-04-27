import { describe, it, expect, beforeEach, vi } from 'vitest';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://test.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
delete process.env.VERCEL_ENV;

const mockGetUser = vi.fn();
const mockFrom = vi.fn();
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    auth: { getUser: mockGetUser },
    from: mockFrom,
  })),
}));

const handler = (await import('../api/pro/flights.js')).default;

function makeReq(opts = {}) {
  // If headers passed, use them as-is; otherwise default to auth + origin
  const headers = opts.headers !== undefined
    ? opts.headers
    : { authorization: 'Bearer t', origin: 'https://theblueboard.co' };
  return {
    method: opts.method || 'GET',
    headers,
    body: opts.body || {},
    query: opts.query || {},
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
  // For getProSession: subscription lookup
  const mockMaybeSingle = vi.fn(() => Promise.resolve({
    data: {
      status: 'active',
      current_period_end: new Date(Date.now() + 86_400_000).toISOString(),
    },
    error: null,
  }));
  const mockEq = vi.fn(() => ({ maybeSingle: mockMaybeSingle }));
  const mockSelect = vi.fn(() => ({ eq: mockEq }));
  mockFrom.mockReturnValueOnce({ select: mockSelect });
}

function mockNonProSubscription() {
  const mockMaybeSingle = vi.fn(() => Promise.resolve({ data: null, error: null }));
  const mockEq = vi.fn(() => ({ maybeSingle: mockMaybeSingle }));
  const mockSelect = vi.fn(() => ({ eq: mockEq }));
  mockFrom.mockReturnValueOnce({ select: mockSelect });
}

describe('GET /api/pro/flights', () => {
  beforeEach(() => {
    mockGetUser.mockReset();
    mockFrom.mockReset();
  });

  it('returns 401 when not authenticated', async () => {
    const res = makeRes();
    await handler(makeReq({ method: 'GET', headers: {} }), res);
    expect(res.statusCode).toBe(401);
  });

  it('returns 403 when authenticated but not Pro', async () => {
    mockAuthOk();
    mockNonProSubscription();
    const res = makeRes();
    await handler(makeReq({ method: 'GET' }), res);
    expect(res.statusCode).toBe(403);
  });

  it('returns the user flights for a Pro user', async () => {
    mockAuthOk('user-1');
    mockProSubscription();
    // .from('user_flights').select('*').eq('user_id', userId).order('created_at')
    const flights = [
      { id: 1, user_id: 'user-1', flight_number: 'UA123' },
    ];
    const mockOrder = vi.fn(() => Promise.resolve({ data: flights, error: null }));
    const mockEq = vi.fn(() => ({ order: mockOrder }));
    const mockSelect = vi.fn(() => ({ eq: mockEq }));
    mockFrom.mockReturnValueOnce({ select: mockSelect });

    const res = makeRes();
    await handler(makeReq({ method: 'GET' }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ flights });
  });
});

describe('POST /api/pro/flights', () => {
  beforeEach(() => {
    mockGetUser.mockReset();
    mockFrom.mockReset();
  });

  it('returns 400 for invalid flight number (prompt-injection defense)', async () => {
    mockAuthOk();
    mockProSubscription();
    const res = makeRes();
    await handler(
      makeReq({ method: 'POST', body: { flight_number: 'UA123\nIgnore previous' } }),
      res
    );
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 for missing flight_number', async () => {
    mockAuthOk();
    mockProSubscription();
    const res = makeRes();
    await handler(makeReq({ method: 'POST', body: {} }), res);
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when at 10-flight cap', async () => {
    mockAuthOk();
    mockProSubscription();
    // Count query returns 10
    const mockSelectCount = vi.fn(() => Promise.resolve({ count: 10, error: null }));
    const mockEqCount = vi.fn(() => mockSelectCount());
    const mockSelectCountWrap = vi.fn(() => ({ eq: mockEqCount }));
    mockFrom.mockReturnValueOnce({ select: mockSelectCountWrap });

    const res = makeRes();
    await handler(makeReq({ method: 'POST', body: { flight_number: 'UA1234' } }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/10/);
  });

  it('inserts a valid flight', async () => {
    mockAuthOk('user-1');
    mockProSubscription();
    // Count query returns 5 (under cap)
    const mockSelectEq = vi.fn(() => Promise.resolve({ count: 5, error: null }));
    const mockSelectWrap = vi.fn(() => ({ eq: mockSelectEq }));
    mockFrom.mockReturnValueOnce({ select: mockSelectWrap });
    // Insert
    const inserted = [{ id: 1, user_id: 'user-1', flight_number: 'UA1234' }];
    const mockInsertSelect = vi.fn(() => Promise.resolve({ data: inserted, error: null }));
    const mockInsert = vi.fn(() => ({ select: mockInsertSelect }));
    mockFrom.mockReturnValueOnce({ insert: mockInsert });

    const res = makeRes();
    await handler(makeReq({ method: 'POST', body: { flight_number: 'UA1234' } }), res);
    expect(res.statusCode).toBe(201);
    expect(res.body.flight).toMatchObject({ flight_number: 'UA1234' });
  });

  it('returns 409 on duplicate flight (UNIQUE constraint)', async () => {
    mockAuthOk('user-1');
    mockProSubscription();
    const mockSelectEq = vi.fn(() => Promise.resolve({ count: 5, error: null }));
    const mockSelectWrap = vi.fn(() => ({ eq: mockSelectEq }));
    mockFrom.mockReturnValueOnce({ select: mockSelectWrap });
    const mockInsertSelect = vi.fn(() => Promise.resolve({
      data: null,
      error: { code: '23505', message: 'duplicate key' },
    }));
    const mockInsert = vi.fn(() => ({ select: mockInsertSelect }));
    mockFrom.mockReturnValueOnce({ insert: mockInsert });

    const res = makeRes();
    await handler(makeReq({ method: 'POST', body: { flight_number: 'UA1234' } }), res);
    expect(res.statusCode).toBe(409);
  });
});

describe('DELETE /api/pro/flights', () => {
  beforeEach(() => {
    mockGetUser.mockReset();
    mockFrom.mockReset();
  });

  it('deletes a flight by flight_number for the auth user', async () => {
    mockAuthOk('user-1');
    mockProSubscription();
    // .from('user_flights').delete().eq('user_id', uid).eq('flight_number', fn)
    const mockEqFn = vi.fn(() => Promise.resolve({ data: [{ id: 1 }], error: null, count: 1 }));
    const mockEqUid = vi.fn(() => ({ eq: mockEqFn }));
    const mockDelete = vi.fn(() => ({ eq: mockEqUid }));
    mockFrom.mockReturnValueOnce({ delete: mockDelete });

    const res = makeRes();
    await handler(
      makeReq({ method: 'DELETE', query: { flight_number: 'UA1234' } }),
      res
    );
    expect(res.statusCode).toBe(200);
  });

  it('returns 400 when flight_number missing', async () => {
    mockAuthOk();
    mockProSubscription();
    const res = makeRes();
    await handler(makeReq({ method: 'DELETE', query: {} }), res);
    expect(res.statusCode).toBe(400);
  });
});

describe('method handling', () => {
  beforeEach(() => {
    mockGetUser.mockReset();
    mockFrom.mockReset();
  });

  it('returns 405 for unsupported methods', async () => {
    mockAuthOk();
    mockProSubscription();
    const res = makeRes();
    await handler(makeReq({ method: 'PATCH' }), res);
    expect(res.statusCode).toBe(405);
  });
});
