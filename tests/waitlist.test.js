import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockEmailSend = vi.fn();

// Mock @supabase/supabase-js so the real getSupabase() in api/_supabase.ts
// returns a mockable client. Env vars below satisfy the production-mode
// assertEnv check. The handler calls supabase.from(...) through the real
// getSupabase(); replacing the client happens via this createClient mock.
const mockFrom = vi.fn();
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ from: mockFrom })),
}));

// Set env BEFORE the handler module loads; getSupabase() reads these lazily
// but some tests trigger module-load paths that assert on them.
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://test.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
// Force non-production so the strict env check in api/_supabase.ts doesn't
// trip during tests — the handler still exercises the full flow.
process.env.NODE_ENV = 'test';
delete process.env.VERCEL_ENV;

vi.mock('resend', () => ({
  Resend: vi.fn(function () {
    return {
      emails: {
        send: mockEmailSend,
      },
    };
  }),
}));

import handler from '../api/waitlist.js';

// Use unique IPs per test to avoid rate limiter collisions
let ipCounter = 100;
function uniqueIp() { return '10.0.0.' + (ipCounter++); }

// Mock upsert().select('created_at').single() chain. Tests adjust createdAt
// to simulate fresh vs returning signups (see NEW_SIGNUP_WINDOW_MS = 10_000
// in api/waitlist.ts).
let upsertResult;
let mockSingle;
let mockUpsertSelect;
let mockUpsert;

function makeReq(overrides = {}) {
  return {
    method: 'POST',
    headers: { origin: 'https://theblueboard.co', 'x-real-ip': uniqueIp() },
    body: { email: 'test@example.com' },
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

describe('waitlist API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: simulate a fresh signup — created_at right now. Tests that need
    // a "returning visitor" override createdAt to be older than 10 seconds ago.
    upsertResult = { data: { created_at: new Date().toISOString(), id: 1 }, error: null };
    mockEmailSend.mockResolvedValue({ data: { id: 'email_123' }, error: null });

    mockSingle = vi.fn(() => Promise.resolve(upsertResult));
    mockUpsertSelect = vi.fn(() => ({ single: mockSingle }));
    mockUpsert = vi.fn(() => ({ select: mockUpsertSelect }));
    mockFrom.mockReturnValue({ upsert: mockUpsert });

    delete process.env.RESEND_API_KEY;
  });

  afterEach(() => {
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_POSTAL_ADDRESS;
  });

  it('rejects non-POST methods', async () => {
    const res = makeRes();
    await handler(makeReq({ method: 'GET' }), res);
    expect(res._status).toBe(405);
  });

  it('returns 400 for missing email', async () => {
    const res = makeRes();
    await handler(makeReq({ body: {} }), res);
    expect(res._status).toBe(400);
  });

  it('returns 400 for invalid email', async () => {
    const res = makeRes();
    await handler(makeReq({ body: { email: 'not-an-email' } }), res);
    expect(res._status).toBe(400);
  });

  it('returns 400 for empty email', async () => {
    const res = makeRes();
    await handler(makeReq({ body: { email: '' } }), res);
    expect(res._status).toBe(400);
  });

  it('returns success for valid email', async () => {
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(200);
    expect(res._json).toEqual({ success: true });
  });

  it('upserts with correct data and normalizes email', async () => {
    const res = makeRes();
    await handler(makeReq({ body: { email: 'Test@Example.com', source: 'footer', featureRequest: 'Dark mode' } }), res);

    expect(mockFrom).toHaveBeenCalledWith('waitlist');
    expect(mockUpsert).toHaveBeenCalledWith(
      { email: 'test@example.com', source: 'footer', feature_request: 'Dark mode' },
      { onConflict: 'email' }
    );
    // Handler uses the returning-row's created_at to classify as new vs repeat.
    expect(mockUpsertSelect).toHaveBeenCalledWith('created_at');
    expect(res._status).toBe(200);
  });

  it('returns 500 on Supabase error', async () => {
    upsertResult = { data: null, error: { message: 'db error' } };

    const res = makeRes();
    await handler(makeReq(), res);
    expect(res._status).toBe(500);
  });

  it('handles OPTIONS preflight', async () => {
    const res = makeRes();
    await handler(makeReq({ method: 'OPTIONS' }), res);
    expect(res._status).toBe(204);
  });

  it('rejects forbidden origins', async () => {
    const res = makeRes();
    await handler(makeReq({ headers: { origin: 'https://evil.com', 'x-real-ip': uniqueIp() } }), res);
    expect(res._status).toBe(403);
  });

  it('whitelists source and falls back to popup for out-of-enum values', async () => {
    // With the DB CHECK constraint in sql/006_waitlist_checks.sql, only values
    // from VALID_SOURCES are allowed. Out-of-enum values fall back to 'popup'
    // instead of being passed through and tripping a constraint error.
    const res = makeRes();
    await handler(makeReq({
      body: {
        email: 'a@b.com',
        source: 'x'.repeat(100),
        featureRequest: 'y'.repeat(1000),
      },
    }), res);

    const upsertArg = mockUpsert.mock.calls[0][0];
    expect(upsertArg.source).toBe('popup');
    expect(upsertArg.feature_request.length).toBe(500);
  });

  it('sends a welcome email for first-time signups when Resend is configured', async () => {
    process.env.RESEND_API_KEY = 're_test_key';

    const res = makeRes();
    await handler(makeReq(), res);

    expect(mockEmailSend).toHaveBeenCalledTimes(1);
    expect(mockEmailSend).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'Jonah @ The Blue Board <hello@theblueboard.co>',
        replyTo: 'hello@theblueboard.co',
        to: 'test@example.com',
        subject: 'Welcome aboard ✈️',
      })
    );
    expect(res._status).toBe(200);
  });

  it('skips the welcome email for repeat signups (created_at older than the new-signup window)', async () => {
    process.env.RESEND_API_KEY = 're_test_key';
    // Simulate a returning visitor — created_at is well outside the 10s window.
    upsertResult = {
      data: { created_at: new Date(Date.now() - 60_000).toISOString(), id: 1 },
      error: null,
    };

    const res = makeRes();
    await handler(makeReq(), res);

    expect(mockEmailSend).not.toHaveBeenCalled();
    expect(res._status).toBe(200);
  });

  it('waits for Resend before returning success', async () => {
    process.env.RESEND_API_KEY = 're_test_key';

    let resolveSend;
    mockEmailSend.mockImplementation(() => new Promise((resolve) => {
      resolveSend = resolve;
    }));

    const res = makeRes();
    const pending = handler(makeReq(), res);

    await vi.waitFor(() => {
      expect(mockEmailSend).toHaveBeenCalledTimes(1);
      expect(typeof resolveSend).toBe('function');
    });
    expect(res._status).toBe(0);

    resolveSend({ data: { id: 'email_456' }, error: null });
    await pending;

    expect(res._status).toBe(200);
  });

  it('still succeeds when Resend returns an error', async () => {
    process.env.RESEND_API_KEY = 're_test_key';
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockEmailSend.mockResolvedValue({ data: null, error: { message: 'send failed' } });

    const res = makeRes();
    await handler(makeReq(), res);

    expect(res._status).toBe(200);
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
  });

  // ── CAN-SPAM compliance footer ──────────────────────────────────────────
  // The welcome email is a TRANSACTIONAL Resend send (resend.emails.send), so
  // the {{{RESEND_UNSUBSCRIBE_URL}}} broadcast placeholder would NOT substitute.
  // It must use the honest mailto unsubscribe line + List-Unsubscribe headers.

  it('welcome email html contains the unsubscribe line and privacy policy link', async () => {
    process.env.RESEND_API_KEY = 're_test_key';

    const res = makeRes();
    await handler(makeReq(), res);

    expect(mockEmailSend).toHaveBeenCalledTimes(1);
    const sent = mockEmailSend.mock.calls[0][0];
    expect(sent.html).toContain('Unsubscribe anytime');
    expect(sent.html).toContain('hello@theblueboard.co');
    expect(sent.html).toContain('https://theblueboard.co/privacy');
    // Broadcast-only placeholder must never appear in a transactional send —
    // Resend would deliver it as literal text.
    expect(sent.html).not.toContain('RESEND_UNSUBSCRIBE_URL');
  });

  it('welcome email send carries List-Unsubscribe headers (Gmail/Yahoo bulk-sender rules)', async () => {
    process.env.RESEND_API_KEY = 're_test_key';

    const res = makeRes();
    await handler(makeReq(), res);

    const sent = mockEmailSend.mock.calls[0][0];
    expect(sent.headers).toBeDefined();
    expect(sent.headers['List-Unsubscribe']).toContain('mailto:hello@theblueboard.co');
    // No List-Unsubscribe-Post: RFC 8058 requires an HTTPS URI for one-click; mailto-only
    // with a stray -Post header is malformed and some filters flag it.
    expect(sent.headers['List-Unsubscribe-Post']).toBeUndefined();
  });

  it('welcome email includes the postal address when EMAIL_POSTAL_ADDRESS is set', async () => {
    process.env.RESEND_API_KEY = 're_test_key';
    process.env.EMAIL_POSTAL_ADDRESS = 'The Blue Board, PO Box 12345, Chicago, IL 60601';

    const res = makeRes();
    await handler(makeReq(), res);

    const sent = mockEmailSend.mock.calls[0][0];
    expect(sent.html).toContain('The Blue Board, PO Box 12345, Chicago, IL 60601');
  });

  it('welcome email omits the postal address line when EMAIL_POSTAL_ADDRESS is unset', async () => {
    process.env.RESEND_API_KEY = 're_test_key';
    delete process.env.EMAIL_POSTAL_ADDRESS;

    const res = makeRes();
    await handler(makeReq(), res);

    const sent = mockEmailSend.mock.calls[0][0];
    expect(sent.html).not.toContain('PO Box 12345');
    // Still has the rest of the compliance footer.
    expect(sent.html).toContain('Unsubscribe anytime');
  });

  it('returns 429 when rate limited (6th request from same IP)', async () => {
    const fixedIp = '10.99.99.99';
    for (let i = 0; i < 5; i++) {
      const res = makeRes();
      await handler(makeReq({ headers: { origin: 'https://theblueboard.co', 'x-real-ip': fixedIp } }), res);
      expect(res._status).toBe(200);
    }
    const res = makeRes();
    await handler(makeReq({ headers: { origin: 'https://theblueboard.co', 'x-real-ip': fixedIp } }), res);
    expect(res._status).toBe(429);
    expect(res._json.error).toMatch(/too many/i);
  });
});
