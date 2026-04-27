import { describe, it, expect, beforeEach, vi } from 'vitest';

// Set required env vars before module load.
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

const { getAuthUser, getProSession } = await import('../api/_auth.js');

function makeReq(authHeader) {
  return { headers: authHeader ? { authorization: authHeader } : {} };
}

function mockSubscriptionLookup(result) {
  // .from('subscriptions').select(...).eq('user_id', id).maybeSingle()
  const mockMaybeSingle = vi.fn(() => Promise.resolve(result));
  const mockEq = vi.fn(() => ({ maybeSingle: mockMaybeSingle }));
  const mockSelect = vi.fn(() => ({ eq: mockEq }));
  mockFrom.mockReturnValueOnce({ select: mockSelect });
}

describe('getAuthUser', () => {
  beforeEach(() => {
    mockGetUser.mockReset();
    mockFrom.mockReset();
  });

  it('returns null when no Authorization header is present', async () => {
    const result = await getAuthUser(makeReq(undefined));
    expect(result).toBeNull();
    expect(mockGetUser).not.toHaveBeenCalled();
  });

  it('returns null when Authorization header lacks Bearer prefix', async () => {
    const result = await getAuthUser(makeReq('some-token'));
    expect(result).toBeNull();
    expect(mockGetUser).not.toHaveBeenCalled();
  });

  it('returns user info when token verifies successfully', async () => {
    mockGetUser.mockResolvedValueOnce({
      data: { user: { id: 'user-123', email: 'pilot@example.com' } },
      error: null,
    });
    const result = await getAuthUser(makeReq('Bearer valid-token'));
    expect(result).toEqual({ id: 'user-123', email: 'pilot@example.com' });
    expect(mockGetUser).toHaveBeenCalledWith('valid-token');
  });

  it('returns null when Supabase verification errors', async () => {
    mockGetUser.mockResolvedValueOnce({
      data: { user: null },
      error: { message: 'invalid token' },
    });
    const result = await getAuthUser(makeReq('Bearer bad-token'));
    expect(result).toBeNull();
  });

  it('returns null when Supabase returns no user but no error (defensive)', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null }, error: null });
    const result = await getAuthUser(makeReq('Bearer empty'));
    expect(result).toBeNull();
  });
});

describe('getProSession', () => {
  beforeEach(() => {
    mockGetUser.mockReset();
    mockFrom.mockReset();
  });

  it('returns null when getAuthUser returns null', async () => {
    const result = await getProSession(makeReq(undefined));
    expect(result).toBeNull();
  });

  it('returns pro: true when active subscription with future period_end', async () => {
    mockGetUser.mockResolvedValueOnce({
      data: { user: { id: 'user-1', email: 'a@b.com' } },
      error: null,
    });
    mockSubscriptionLookup({
      data: {
        status: 'active',
        current_period_end: new Date(Date.now() + 86_400_000).toISOString(),
      },
      error: null,
    });
    const result = await getProSession(makeReq('Bearer t'));
    expect(result).toEqual({ userId: 'user-1', email: 'a@b.com', pro: true });
  });

  it('returns pro: false when subscription status is canceled', async () => {
    mockGetUser.mockResolvedValueOnce({
      data: { user: { id: 'user-1', email: 'a@b.com' } },
      error: null,
    });
    mockSubscriptionLookup({
      data: {
        status: 'canceled',
        current_period_end: new Date(Date.now() + 86_400_000).toISOString(),
      },
      error: null,
    });
    const result = await getProSession(makeReq('Bearer t'));
    expect(result?.pro).toBe(false);
  });

  it('returns pro: false when active subscription has past period_end (race-safety)', async () => {
    mockGetUser.mockResolvedValueOnce({
      data: { user: { id: 'user-1', email: 'a@b.com' } },
      error: null,
    });
    mockSubscriptionLookup({
      data: {
        status: 'active',
        current_period_end: new Date(Date.now() - 86_400_000).toISOString(),
      },
      error: null,
    });
    const result = await getProSession(makeReq('Bearer t'));
    expect(result?.pro).toBe(false);
  });

  it('returns pro: false when no subscription row exists', async () => {
    mockGetUser.mockResolvedValueOnce({
      data: { user: { id: 'user-1', email: 'a@b.com' } },
      error: null,
    });
    mockSubscriptionLookup({ data: null, error: null });
    const result = await getProSession(makeReq('Bearer t'));
    expect(result).toEqual({ userId: 'user-1', email: 'a@b.com', pro: false });
  });
});
