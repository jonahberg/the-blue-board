// CRITICAL REGRESSION TEST per Eng Review section 3:
// existing free users currently get unlimited delay-explain. The 3/day cap is
// a behavior change. This suite verifies (1) the boundary (3 succeeds, 4 fails),
// (2) Pro bypass works, (3) failure mode is a clear 429 with upsell hint.

import { describe, it, expect, beforeEach, vi } from 'vitest';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://test.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
process.env.ANTHROPIC_API_KEY = 'sk_fake';
delete process.env.VERCEL_ENV;

const mockGetUser = vi.fn();
const mockFrom = vi.fn();
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ auth: { getUser: mockGetUser }, from: mockFrom })),
}));

const mockMessagesCreate = vi.fn();
vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn(() => ({ messages: { create: mockMessagesCreate } })),
}));

const handler = (await import('../api/delay-explain.js')).default;

function makeReq(opts = {}) {
  const headers = {
    origin: 'https://theblueboard.co',
    referer: 'https://theblueboard.co/',
    'x-real-ip': opts.ip || '203.0.113.1',
    'content-type': 'application/json',
    ...(opts.token ? { authorization: 'Bearer ' + opts.token } : {}),
    ...(opts.headers || {}),
  };
  return {
    method: opts.method || 'POST',
    headers,
    body: opts.body || { flight: 'UA123', riskScore: 50 },
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

function mockAnthropicSuccess() {
  mockMessagesCreate.mockResolvedValueOnce({
    content: [{ type: 'text', text: 'Mocked AI explanation.' }],
  });
}

function mockProSessionFor(uid) {
  // First call: getAuthUser -> supabase.auth.getUser
  mockGetUser.mockResolvedValueOnce({
    data: { user: { id: uid, email: 'pilot@example.com' } },
    error: null,
  });
  // Second: subscriptions lookup
  const mockMaybeSingle = vi.fn(() => Promise.resolve({
    data: { status: 'active', current_period_end: new Date(Date.now() + 86_400_000).toISOString() },
    error: null,
  }));
  const mockEq = vi.fn(() => ({ maybeSingle: mockMaybeSingle }));
  const mockSelect = vi.fn(() => ({ eq: mockEq }));
  mockFrom.mockReturnValueOnce({ select: mockSelect });
}

describe('delay-explain free-tier 3/day gate (REGRESSION)', () => {
  beforeEach(() => {
    mockGetUser.mockReset();
    mockFrom.mockReset();
    mockMessagesCreate.mockReset();
  });

  it('allows the 1st, 2nd, 3rd request from same IP, blocks 4th', async () => {
    const ip = '198.51.100.7';

    for (let i = 1; i <= 3; i++) {
      mockAnthropicSuccess();
      const res = makeRes();
      await handler(makeReq({ ip, body: { flight: 'UA' + i, riskScore: 40 } }), res);
      expect(res.statusCode, `request ${i} should succeed`).toBe(200);
    }

    // 4th call: gated
    const res4 = makeRes();
    await handler(makeReq({ ip, body: { flight: 'UA4', riskScore: 40 } }), res4);
    expect(res4.statusCode).toBe(429);
    expect(res4.body.error).toMatch(/limit|cap|upgrade|pro/i);
  });

  it('does not count cached responses against the daily cap', async () => {
    const ip = '198.51.100.8';
    // Same body each time → cached after first call
    const body = { flight: 'UA999', riskScore: 50 };

    mockAnthropicSuccess();
    const r1 = makeRes();
    await handler(makeReq({ ip, body }), r1);
    expect(r1.statusCode).toBe(200);

    // Calls 2-5 hit the cache, no new Anthropic call, no quota burned
    for (let i = 2; i <= 5; i++) {
      const r = makeRes();
      await handler(makeReq({ ip, body }), r);
      expect(r.statusCode, `cached call ${i} should succeed`).toBe(200);
    }
    expect(mockMessagesCreate).toHaveBeenCalledTimes(1);
  });

  it('Pro user bypasses the 3/day cap', async () => {
    const ip = '198.51.100.9';

    // First 3 calls as a Pro user — should all succeed
    for (let i = 1; i <= 5; i++) {
      mockProSessionFor('pro-user-1');
      mockAnthropicSuccess();
      const res = makeRes();
      await handler(
        makeReq({ ip, token: 'pro-token', body: { flight: 'UA' + i, riskScore: 40 } }),
        res
      );
      expect(res.statusCode, `Pro request ${i} should succeed`).toBe(200);
    }
  });

  it('429 response includes upsell hint pointing to /pro', async () => {
    const ip = '198.51.100.10';
    for (let i = 1; i <= 3; i++) {
      mockAnthropicSuccess();
      await handler(makeReq({ ip, body: { flight: 'UAx' + i, riskScore: 40 } }), makeRes());
    }
    const res = makeRes();
    await handler(makeReq({ ip, body: { flight: 'UAover', riskScore: 40 } }), res);
    expect(res.statusCode).toBe(429);
    expect(res.body.upgrade_url).toBe('/pro');
  });
});
