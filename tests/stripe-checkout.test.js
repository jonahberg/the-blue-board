import { describe, it, expect, beforeEach, vi } from 'vitest';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://test.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
process.env.STRIPE_PRICE_ID_FOUNDING = 'price_founding_test';
process.env.STRIPE_PRICE_ID_REGULAR = 'price_regular_test';
delete process.env.VERCEL_ENV;

const mockGetUser = vi.fn();
const mockFrom = vi.fn();
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    auth: { getUser: mockGetUser },
    from: mockFrom,
  })),
}));

const mockCheckoutCreate = vi.fn();
const mockCustomerList = vi.fn();
const mockCustomerCreate = vi.fn();
vi.mock('stripe', () => {
  return {
    default: vi.fn(() => ({
      checkout: { sessions: { create: mockCheckoutCreate } },
      customers: { list: mockCustomerList, create: mockCustomerCreate },
    })),
  };
});

const handler = (await import('../api/stripe/checkout.js')).default;

function makeReq(opts = {}) {
  return {
    method: opts.method || 'POST',
    headers: opts.headers || { authorization: 'Bearer valid-token', origin: 'https://theblueboard.co' },
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

function mockAuthOk(userId = 'user-1', email = 'pilot@example.com') {
  mockGetUser.mockResolvedValueOnce({
    data: { user: { id: userId, email } },
    error: null,
  });
}

function mockSubscriptionCount(count) {
  // .from('subscriptions').select('*', { count: 'exact', head: true })
  //   .in('status', ['active', 'trialing', 'past_due'])
  const result = Promise.resolve({ count, error: null });
  const mockIn = vi.fn(() => result);
  const mockSelect = vi.fn(() => ({ in: mockIn, then: result.then.bind(result) }));
  mockFrom.mockReturnValueOnce({ select: mockSelect });
}

function mockExistingSubscriptionLookup(data) {
  const mockMaybeSingle = vi.fn(() => Promise.resolve({ data, error: null }));
  const mockEq = vi.fn(() => ({ maybeSingle: mockMaybeSingle }));
  const mockSelect = vi.fn(() => ({ eq: mockEq }));
  mockFrom.mockReturnValueOnce({ select: mockSelect });
}

describe('POST /api/stripe/checkout', () => {
  beforeEach(() => {
    mockGetUser.mockReset();
    mockFrom.mockReset();
    mockCheckoutCreate.mockReset();
    mockCustomerList.mockReset();
    mockCustomerCreate.mockReset();
    delete process.env.PRO_ENABLED;
    delete process.env.PRO_FEATURE_CHECKOUT_ENABLED;
  });

  it('returns 405 for non-POST methods', async () => {
    const res = makeRes();
    await handler(makeReq({ method: 'GET' }), res);
    expect(res.statusCode).toBe(405);
  });

  it('returns 401 when no auth header', async () => {
    const res = makeRes();
    await handler(makeReq({ headers: { origin: 'https://theblueboard.co' } }), res);
    expect(res.statusCode).toBe(401);
  });

  it('returns 503 when PRO_ENABLED=false (master kill switch)', async () => {
    process.env.PRO_ENABLED = 'false';
    mockAuthOk();
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res.statusCode).toBe(503);
    expect(mockCheckoutCreate).not.toHaveBeenCalled();
  });

  it('returns 503 when PRO_FEATURE_CHECKOUT_ENABLED=false', async () => {
    process.env.PRO_FEATURE_CHECKOUT_ENABLED = 'false';
    mockAuthOk();
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res.statusCode).toBe(503);
  });

  it('uses founding price when active subscription count < 100', async () => {
    mockAuthOk();
    mockExistingSubscriptionLookup(null);
    mockSubscriptionCount(42);
    mockCustomerList.mockResolvedValueOnce({ data: [] });
    mockCustomerCreate.mockResolvedValueOnce({ id: 'cus_new' });
    mockCheckoutCreate.mockResolvedValueOnce({
      id: 'cs_test_123',
      url: 'https://checkout.stripe.com/test',
    });

    const res = makeRes();
    await handler(makeReq(), res);

    expect(res.statusCode).toBe(200);
    expect(mockCheckoutCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        line_items: [{ price: 'price_founding_test', quantity: 1 }],
      })
    );
    expect(res.body.url).toBe('https://checkout.stripe.com/test');
  });

  it('uses regular price when active subscription count >= 100', async () => {
    mockAuthOk();
    mockExistingSubscriptionLookup(null);
    mockSubscriptionCount(100);
    mockCustomerList.mockResolvedValueOnce({ data: [] });
    mockCustomerCreate.mockResolvedValueOnce({ id: 'cus_new' });
    mockCheckoutCreate.mockResolvedValueOnce({
      id: 'cs_test_123',
      url: 'https://checkout.stripe.com/test',
    });

    const res = makeRes();
    await handler(makeReq(), res);

    expect(mockCheckoutCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        line_items: [{ price: 'price_regular_test', quantity: 1 }],
      })
    );
  });

  it('reuses existing Stripe customer if one exists for the user email', async () => {
    mockAuthOk('user-1', 'pilot@example.com');
    mockExistingSubscriptionLookup(null);
    mockSubscriptionCount(10);
    mockCustomerList.mockResolvedValueOnce({
      data: [{ id: 'cus_existing', email: 'pilot@example.com' }],
    });
    mockCheckoutCreate.mockResolvedValueOnce({
      id: 'cs_test_456',
      url: 'https://checkout.stripe.com/test',
    });

    const res = makeRes();
    await handler(makeReq(), res);

    expect(mockCustomerCreate).not.toHaveBeenCalled();
    expect(mockCheckoutCreate).toHaveBeenCalledWith(
      expect.objectContaining({ customer: 'cus_existing' })
    );
  });

  it('returns 409 when user already has an active subscription', async () => {
    mockAuthOk();
    mockExistingSubscriptionLookup({
      status: 'active',
      current_period_end: new Date(Date.now() + 86_400_000).toISOString(),
    });
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res.statusCode).toBe(409);
    expect(mockCheckoutCreate).not.toHaveBeenCalled();
  });

  it('passes user_id in metadata for webhook to link back', async () => {
    mockAuthOk('user-abc-123');
    mockExistingSubscriptionLookup(null);
    mockSubscriptionCount(5);
    mockCustomerList.mockResolvedValueOnce({ data: [] });
    mockCustomerCreate.mockResolvedValueOnce({ id: 'cus_new' });
    mockCheckoutCreate.mockResolvedValueOnce({ id: 'cs', url: 'https://checkout.stripe.com/x' });
    const res = makeRes();
    await handler(makeReq(), res);

    expect(mockCheckoutCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ user_id: 'user-abc-123' }),
        subscription_data: expect.objectContaining({
          metadata: expect.objectContaining({ user_id: 'user-abc-123' }),
        }),
      })
    );
  });

  it('returns 500 if Stripe checkout creation fails', async () => {
    mockAuthOk();
    mockExistingSubscriptionLookup(null);
    mockSubscriptionCount(5);
    mockCustomerList.mockResolvedValueOnce({ data: [] });
    mockCustomerCreate.mockResolvedValueOnce({ id: 'cus_new' });
    mockCheckoutCreate.mockRejectedValueOnce(new Error('Stripe API down'));
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res.statusCode).toBe(500);
  });
});
