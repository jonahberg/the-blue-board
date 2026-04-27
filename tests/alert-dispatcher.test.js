import { describe, it, expect, beforeEach, vi } from 'vitest';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://test.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
process.env.VAPID_PUBLIC_KEY = 'BAfake_public_key_padded_to_decent_length_for_format';
process.env.VAPID_PRIVATE_KEY = 'fake_private_key_padded_to_decent_length_for_format';
process.env.VAPID_SUBJECT = 'mailto:hello@theblueboard.co';
process.env.RESEND_API_KEY = 'rk_test_fake';
delete process.env.VERCEL_ENV;

const mockFrom = vi.fn();
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ from: mockFrom })),
}));

const mockSendNotification = vi.fn();
const mockSetVapidDetails = vi.fn();
vi.mock('web-push', () => ({
  default: {
    sendNotification: mockSendNotification,
    setVapidDetails: mockSetVapidDetails,
  },
}));

const mockEmailsSend = vi.fn();
vi.mock('resend', () => ({
  Resend: vi.fn(() => ({
    emails: { send: mockEmailsSend },
  })),
}));

const { dispatchAlert } = await import('../api/_alert-dispatcher.js');

function mockSubscriptionsLookup(rows) {
  // .from('push_subscriptions').select('*').eq('user_id', uid)
  const result = Promise.resolve({ data: rows, error: null });
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => result),
    then: result.then.bind(result),
  };
  mockFrom.mockReturnValueOnce(chain);
}

function mockUserEmailLookup(email) {
  // .from('subscriptions').select('user_id').eq(...).maybeSingle() — actually we look up via auth admin
  // Simpler: pass email in via the alert payload
}

describe('dispatchAlert', () => {
  beforeEach(() => {
    mockFrom.mockReset();
    mockSendNotification.mockReset();
    mockSetVapidDetails.mockReset();
    mockEmailsSend.mockReset();
  });

  it('returns 0 sent when user has no push subscriptions', async () => {
    mockSubscriptionsLookup([]);
    const result = await dispatchAlert({
      userId: 'u1',
      email: 'a@b.com',
      flightNumber: 'UA123',
      title: 'UA123 risk increased',
      body: 'ORD ground stop active',
      url: 'https://theblueboard.co/pro/flights',
    });
    expect(result.pushSent).toBe(0);
    expect(result.emailSent).toBe(0);
  });

  it('sends web push for push-delivery subscriptions', async () => {
    mockSubscriptionsLookup([
      {
        endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
        keys: { p256dh: 'k1', auth: 'a1' },
        delivery: 'push',
      },
    ]);
    mockSendNotification.mockResolvedValueOnce({ statusCode: 201 });

    const result = await dispatchAlert({
      userId: 'u1',
      email: 'a@b.com',
      flightNumber: 'UA123',
      title: 'UA123 risk increased',
      body: 'ORD ground stop active',
      url: 'https://theblueboard.co/pro/flights',
    });

    expect(mockSendNotification).toHaveBeenCalledTimes(1);
    expect(result.pushSent).toBe(1);
    expect(result.emailSent).toBe(0);
  });

  it('sends email for email-delivery subscriptions', async () => {
    mockSubscriptionsLookup([
      {
        endpoint: 'email:a@b.com',
        keys: {},
        delivery: 'email',
      },
    ]);
    mockEmailsSend.mockResolvedValueOnce({ data: { id: 'em1' }, error: null });

    const result = await dispatchAlert({
      userId: 'u1',
      email: 'a@b.com',
      flightNumber: 'UA123',
      title: 'UA123 risk increased',
      body: 'ORD ground stop active',
      url: 'https://theblueboard.co/pro/flights',
    });

    expect(mockEmailsSend).toHaveBeenCalledTimes(1);
    expect(result.emailSent).toBe(1);
    expect(result.pushSent).toBe(0);
  });

  it('handles mixed push + email subscriptions', async () => {
    mockSubscriptionsLookup([
      { endpoint: 'https://fcm.test/x', keys: { p256dh: 'k', auth: 'a' }, delivery: 'push' },
      { endpoint: 'email:a@b.com', keys: {}, delivery: 'email' },
    ]);
    mockSendNotification.mockResolvedValueOnce({ statusCode: 201 });
    mockEmailsSend.mockResolvedValueOnce({ data: { id: 'em1' }, error: null });

    const result = await dispatchAlert({
      userId: 'u1',
      email: 'a@b.com',
      flightNumber: 'UA1',
      title: 'x',
      body: 'y',
      url: 'z',
    });
    expect(result.pushSent).toBe(1);
    expect(result.emailSent).toBe(1);
  });

  it('continues on individual push failure (does not throw)', async () => {
    mockSubscriptionsLookup([
      { endpoint: 'https://fcm.test/x', keys: { p256dh: 'k', auth: 'a' }, delivery: 'push' },
      { endpoint: 'https://fcm.test/y', keys: { p256dh: 'k', auth: 'a' }, delivery: 'push' },
    ]);
    mockSendNotification
      .mockRejectedValueOnce(new Error('expired subscription'))
      .mockResolvedValueOnce({ statusCode: 201 });

    const result = await dispatchAlert({
      userId: 'u1',
      email: 'a@b.com',
      flightNumber: 'UA1',
      title: 'x',
      body: 'y',
      url: 'z',
    });
    expect(result.pushSent).toBe(1);
    expect(result.failures).toBe(1);
  });
});
