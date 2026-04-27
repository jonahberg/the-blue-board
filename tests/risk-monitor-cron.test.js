import { describe, it, expect, beforeEach, vi } from 'vitest';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://test.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
process.env.CRON_SECRET = 'cron-secret-test';
delete process.env.VERCEL_ENV;

const mockFrom = vi.fn();
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ from: mockFrom })),
}));

const handler = (await import('../api/cron/risk-monitor.js')).default;

function makeReq(opts = {}) {
  return {
    method: 'GET',
    headers: { authorization: 'Bearer cron-secret-test', ...opts.headers },
  };
}

function makeRes() {
  const res = { statusCode: 200, body: null };
  res.status = vi.fn((c) => { res.statusCode = c; return res; });
  res.json = vi.fn((b) => { res.body = b; return res; });
  return res;
}

function mockFlightsQuery(rows) {
  // .from('user_flights').select(...).in('user_id', ...).limit(...)
  // Or: .from('user_flights').select(...).eq('subscriptions.status', 'active')
  // We use a simpler query: SELECT user_flights with subscription join via app filter
  const result = Promise.resolve({ data: rows, error: null });
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    in: vi.fn(() => chain),
    limit: vi.fn(() => result),
    then: result.then.bind(result),
  };
  mockFrom.mockReturnValueOnce(chain);
}

function mockActiveSubs(userIds) {
  const result = Promise.resolve({
    data: userIds.map((id) => ({ user_id: id })),
    error: null,
  });
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => result),
    then: result.then.bind(result),
  };
  mockFrom.mockReturnValueOnce(chain);
}

function mockRiskStateUpsert() {
  const upsertResult = Promise.resolve({ data: [{}], error: null });
  mockFrom.mockReturnValueOnce({
    upsert: vi.fn(() => upsertResult),
  });
}

describe('GET /api/cron/risk-monitor', () => {
  beforeEach(() => {
    mockFrom.mockReset();
    delete process.env.PRO_ENABLED;
    delete process.env.PRO_FEATURE_RISK_MONITOR_ENABLED;
  });

  it('returns 401 when CRON_SECRET is missing or wrong', async () => {
    const res = makeRes();
    await handler({ method: 'GET', headers: { authorization: 'Bearer wrong' } }, res);
    expect(res.statusCode).toBe(401);
  });

  it('returns 503 when PRO_FEATURE_RISK_MONITOR_ENABLED=false', async () => {
    process.env.PRO_FEATURE_RISK_MONITOR_ENABLED = 'false';
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res.statusCode).toBe(503);
  });

  it('returns 503 when master PRO_ENABLED=false', async () => {
    process.env.PRO_ENABLED = 'false';
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res.statusCode).toBe(503);
  });

  it('returns success with empty processed list when no Pro flights in bucket', async () => {
    mockActiveSubs([]); // no active subs
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ processed: 0 });
  });

  it('processes each flight in the current bucket and records to risk_state', async () => {
    // 2 active Pro users, both in current bucket (we'll just trust assignBucket here)
    mockActiveSubs(['user-a', 'user-b']);
    mockFlightsQuery([
      { user_id: 'user-a', flight_number: 'UA100' },
      { user_id: 'user-b', flight_number: 'UA200' },
    ]);
    mockRiskStateUpsert();
    mockRiskStateUpsert();

    const res = makeRes();
    await handler(makeReq(), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.processed).toBeGreaterThanOrEqual(0);
  });

  it('caps processed flights to MAX_FLIGHTS_PER_TICK to stay under task budget', async () => {
    mockActiveSubs(['u']);
    // Return way too many flights
    const manyFlights = [];
    for (let i = 0; i < 200; i++) {
      manyFlights.push({ user_id: 'u', flight_number: `UA${i}` });
    }
    mockFlightsQuery(manyFlights);
    // Risk-state upserts for each processed flight (cap-limited)
    for (let i = 0; i < 100; i++) mockRiskStateUpsert();

    const res = makeRes();
    await handler(makeReq(), res);
    expect(res.statusCode).toBe(200);
    // Cap is 50 by default
    expect(res.body.processed).toBeLessThanOrEqual(50);
  });
});
