import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Readable } from 'node:stream';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://test.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_fake';
delete process.env.VERCEL_ENV;

const mockFrom = vi.fn();
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ from: mockFrom })),
}));

const mockConstructEvent = vi.fn();
const mockSubscriptionRetrieve = vi.fn();
vi.mock('stripe', () => ({
  default: vi.fn(() => ({
    webhooks: { constructEvent: mockConstructEvent },
    subscriptions: { retrieve: mockSubscriptionRetrieve },
  })),
}));

const handler = (await import('../api/stripe/webhook.js')).default;

function makeRawReq(rawBody, headers = {}) {
  // Simulate a Node IncomingMessage with raw body as a stream
  const stream = Readable.from([Buffer.from(rawBody)]);
  // Attach headers
  stream.headers = { 'stripe-signature': 'sig-test', ...headers };
  stream.method = 'POST';
  return stream;
}

function makeRes() {
  const res = { statusCode: 200, body: null };
  res.status = vi.fn((c) => { res.statusCode = c; return res; });
  res.json = vi.fn((b) => { res.body = b; return res; });
  res.send = vi.fn((b) => { res.body = b; return res; });
  res.end = vi.fn(() => res);
  return res;
}

// Mock chains for various supabase operations.
// New flow: SELECT pre-check → handler runs → INSERT post-success.
function mockStripeEventLookup(found) {
  // .from('stripe_events').select('id').eq('id', x).maybeSingle()
  const result = found
    ? { data: { id: 'evt_dup' }, error: null }
    : { data: null, error: null };
  const mockMaybeSingle = vi.fn(() => Promise.resolve(result));
  const mockEq = vi.fn(() => ({ maybeSingle: mockMaybeSingle }));
  const mockSelect = vi.fn(() => ({ eq: mockEq }));
  mockFrom.mockReturnValueOnce({ select: mockSelect });
}

function mockStripeEventInsert(success = true) {
  // .from('stripe_events').insert(...) — runs AFTER successful handler.
  const result = success
    ? { data: [{ id: 'evt_123' }], error: null }
    : { data: null, error: { code: '23505', message: 'duplicate' } };
  const mockInsert = vi.fn(() => Promise.resolve(result));
  mockFrom.mockReturnValueOnce({ insert: mockInsert });
}

function mockSubscriptionUpsert(success = true) {
  const mockUpsert = vi.fn(() =>
    Promise.resolve({ data: success ? [{ id: 1 }] : null, error: success ? null : { message: 'fail' } })
  );
  mockFrom.mockReturnValueOnce({ upsert: mockUpsert });
}

function mockSubscriptionUpdate(success = true) {
  const mockUpdateEq = vi.fn(() => Promise.resolve({ data: success ? [{ id: 1 }] : null, error: success ? null : { message: 'fail' } }));
  const mockUpdate = vi.fn(() => ({ eq: mockUpdateEq }));
  mockFrom.mockReturnValueOnce({ update: mockUpdate });
}

describe('POST /api/stripe/webhook', () => {
  beforeEach(() => {
    mockFrom.mockReset();
    mockConstructEvent.mockReset();
    mockSubscriptionRetrieve.mockReset();
  });

  it('returns 405 for non-POST methods', async () => {
    const req = makeRawReq('{}');
    req.method = 'GET';
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(405);
  });

  it('returns 400 when stripe-signature header is missing', async () => {
    const req = makeRawReq('{}', {});
    delete req.headers['stripe-signature'];
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when signature verification fails (forged webhook)', async () => {
    mockConstructEvent.mockImplementationOnce(() => {
      throw new Error('Invalid signature');
    });
    const req = makeRawReq('{"fake":"event"}');
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
  });

  it('processes checkout.session.completed: upserts active subscription', async () => {
    mockConstructEvent.mockReturnValueOnce({
      id: 'evt_1',
      type: 'checkout.session.completed',
      data: {
        object: {
          subscription: 'sub_test_123',
          customer: 'cus_test_123',
          metadata: { user_id: 'user-abc' },
        },
      },
    });
    mockSubscriptionRetrieve.mockResolvedValueOnce({
      id: 'sub_test_123',
      status: 'active',
      cancel_at_period_end: false,
      current_period_end: 1735689600,
      items: { data: [{ price: { id: 'price_x' } }] },
    });
    mockStripeEventLookup(false); // not yet processed
    mockSubscriptionUpsert(true);
    mockStripeEventInsert(true); // post-success record

    const req = makeRawReq('raw');
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    // Order should be: stripe_events SELECT → subscriptions upsert → stripe_events INSERT
    expect(mockFrom.mock.calls[0][0]).toBe('stripe_events');
    expect(mockFrom.mock.calls[1][0]).toBe('subscriptions');
    expect(mockFrom.mock.calls[2][0]).toBe('stripe_events');
  });

  it('returns 200 immediately for duplicate event (idempotency, no handler re-run)', async () => {
    mockConstructEvent.mockReturnValueOnce({
      id: 'evt_dup',
      type: 'checkout.session.completed',
      data: { object: { subscription: 'sub', customer: 'cus', metadata: { user_id: 'u' } } },
    });
    mockStripeEventLookup(true); // already processed

    const req = makeRawReq('raw');
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    // Only the SELECT pre-check, no subscription work
    expect(mockFrom).toHaveBeenCalledTimes(1);
    expect(res.body.duplicate).toBe(true);
  });

  it('returns 500 (Stripe will retry) when subscription upsert fails — does NOT mark event processed', async () => {
    mockConstructEvent.mockReturnValueOnce({
      id: 'evt_fail',
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_x',
          status: 'active',
          cancel_at_period_end: false,
          current_period_end: 1735689600,
          items: { data: [{ price: { id: 'p' } }] },
        },
      },
    });
    mockStripeEventLookup(false);
    mockSubscriptionUpdate(false); // DB write fails

    const req = makeRawReq('raw');
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(500);
    // CRITICAL: stripe_events INSERT was NOT called — Stripe retry will re-run handler
    const insertCalls = mockFrom.mock.calls.filter(c => c[0] === 'stripe_events');
    expect(insertCalls).toHaveLength(1); // only the SELECT pre-check
  });

  it('processes customer.subscription.updated: updates status and period_end', async () => {
    mockConstructEvent.mockReturnValueOnce({
      id: 'evt_2',
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_test_123',
          status: 'active',
          cancel_at_period_end: true,
          current_period_end: 1735689600,
          items: { data: [{ price: { id: 'price_x' } }] },
        },
      },
    });
    mockStripeEventLookup(false);
    mockSubscriptionUpdate(true);
    mockStripeEventInsert(true);

    const req = makeRawReq('raw');
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
  });

  it('processes customer.subscription.deleted: marks status canceled', async () => {
    mockConstructEvent.mockReturnValueOnce({
      id: 'evt_3',
      type: 'customer.subscription.deleted',
      data: {
        object: {
          id: 'sub_test_123',
          status: 'canceled',
          current_period_end: 1735689600,
        },
      },
    });
    mockStripeEventLookup(false);
    mockSubscriptionUpdate(true);
    mockStripeEventInsert(true);

    const req = makeRawReq('raw');
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
  });

  it('processes invoice.payment_failed: flags subscription as past_due', async () => {
    mockConstructEvent.mockReturnValueOnce({
      id: 'evt_4',
      type: 'invoice.payment_failed',
      data: {
        object: {
          subscription: 'sub_test_123',
          customer: 'cus_test_123',
        },
      },
    });
    mockStripeEventLookup(false);
    mockSubscriptionUpdate(true);
    mockStripeEventInsert(true);

    const req = makeRawReq('raw');
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
  });

  it('returns 200 for unknown event types (records as processed, no handler)', async () => {
    mockConstructEvent.mockReturnValueOnce({
      id: 'evt_unknown',
      type: 'customer.discount.created',
      data: { object: {} },
    });
    mockStripeEventLookup(false);
    mockStripeEventInsert(true);

    const req = makeRawReq('raw');
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
  });
});
