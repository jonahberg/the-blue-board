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

// The welcome email (and its daily-cap count) run after the response via waitUntil. Capture each
// promise so a test can await the background work before asserting on it; without this mock,
// waitUntil is a silent no-op outside a Vercel request and the send would race the assertions.
const background = vi.hoisted(() => ({ tasks: [] }));
vi.mock('@vercel/functions', () => ({
  waitUntil: vi.fn((promise) => { background.tasks.push(promise); }),
}));
async function flushBackground() {
  while (background.tasks.length) await Promise.all(background.tasks.splice(0));
}

vi.mock('resend', () => ({
  Resend: vi.fn(function () {
    return {
      emails: {
        send: mockEmailSend,
      },
    };
  }),
}));

import handler, { WELCOME_EMAIL_DAILY_CAP } from '../api/waitlist.js';
import { waitUntil } from '@vercel/functions';

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
// The daily-cap query: from('waitlist').select('*', { count, head }).gte('created_at', since).
let countResult;
let mockCountGte;
let mockCountSelect;

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
    countResult = { count: 1, error: null };
    mockCountGte = vi.fn(() => Promise.resolve(countResult));
    mockCountSelect = vi.fn(() => ({ gte: mockCountGte }));
    mockFrom.mockReturnValue({ upsert: mockUpsert, select: mockCountSelect });
    background.tasks.length = 0;

    delete process.env.RESEND_API_KEY;
  });

  afterEach(async () => {
    await flushBackground();
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

  it('passes every dashboard source through, including the deep-use email ask (Oct 28 2026)', async () => {
    for (const source of ['popup', 'dashboard', 'deep-use']) {
      mockUpsert.mockClear();
      const res = makeRes();
      await handler(makeReq({ body: { email: 'a@b.com', source } }), res);
      expect(res._status).toBe(200);
      expect(mockUpsert).toHaveBeenCalledTimes(1);
      expect(mockUpsert.mock.calls[0][0].source).toBe(source);
    }
  });

  it('keeps the signup when the table has not been migrated for a source yet (sql/019): retried once as popup', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const violation = {
      data: null,
      error: { code: '23514', message: 'new row for relation "waitlist" violates check constraint "waitlist_source_enum"' },
    };
    const ok = { data: { created_at: new Date().toISOString(), id: 1 }, error: null };
    mockSingle.mockReturnValueOnce(Promise.resolve(violation)).mockReturnValueOnce(Promise.resolve(ok));

    const res = makeRes();
    await handler(makeReq({ body: { email: 'a@b.com', source: 'deep-use' } }), res);

    expect(res._status).toBe(200);
    expect(mockUpsert.mock.calls.map((call) => call[0].source)).toEqual(['deep-use', 'popup']);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/deep-use.*waitlist_source_enum/));
    warn.mockRestore();
  });

  it('does not retry other constraint failures', async () => {
    upsertResult = {
      data: null,
      error: { code: '23514', message: 'new row for relation "waitlist" violates check constraint "waitlist_email_format"' },
    };
    const res = makeRes();
    await handler(makeReq({ body: { email: 'a@b.com', source: 'deep-use' } }), res);
    expect(res._status).toBe(500);
    expect(mockUpsert).toHaveBeenCalledTimes(1);
  });

  it('sends a welcome email for first-time signups when Resend is configured', async () => {
    process.env.RESEND_API_KEY = 're_test_key';

    const res = makeRes();
    await handler(makeReq(), res);
    await flushBackground();

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
    await flushBackground();

    expect(mockEmailSend).not.toHaveBeenCalled();
    expect(waitUntil).not.toHaveBeenCalled();
    expect(mockCountSelect).not.toHaveBeenCalled();
    expect(res._status).toBe(200);
  });

  it('answers without waiting for Resend: the send is handed to waitUntil (Oct 28 2026)', async () => {
    // Awaiting the send only for NEW addresses made the response time say whether an address
    // was already on the list. Now both answer after the upsert alone.
    process.env.RESEND_API_KEY = 're_test_key';

    let resolveSend;
    mockEmailSend.mockImplementation(() => new Promise((resolve) => {
      resolveSend = resolve;
    }));

    const res = makeRes();
    await handler(makeReq(), res);

    expect(res._status).toBe(200);
    expect(res._json).toEqual({ success: true });
    expect(waitUntil).toHaveBeenCalledTimes(1);
    expect(typeof waitUntil.mock.calls[0][0]?.then).toBe('function');

    await vi.waitFor(() => expect(mockEmailSend).toHaveBeenCalledTimes(1));
    resolveSend({ data: { id: 'email_456' }, error: null });
    await flushBackground();
  });

  it('runs the daily-cap count after the response too, so a new address waits only for the upsert', async () => {
    process.env.RESEND_API_KEY = 're_test_key';
    let resolveCount;
    mockCountGte.mockImplementation(() => new Promise((resolve) => { resolveCount = resolve; }));

    const res = makeRes();
    await handler(makeReq(), res);

    // Answered while the count query is still outstanding.
    expect(res._status).toBe(200);
    expect(mockEmailSend).not.toHaveBeenCalled();

    resolveCount({ count: 1, error: null });
    await flushBackground();
    expect(mockEmailSend).toHaveBeenCalledTimes(1);
  });

  it('still succeeds when Resend returns an error', async () => {
    process.env.RESEND_API_KEY = 're_test_key';
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockEmailSend.mockResolvedValue({ data: null, error: { message: 'send failed' } });

    const res = makeRes();
    await handler(makeReq(), res);
    await flushBackground();

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
    await flushBackground();

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
    await flushBackground();

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
    await flushBackground();

    const sent = mockEmailSend.mock.calls[0][0];
    expect(sent.html).toContain('The Blue Board, PO Box 12345, Chicago, IL 60601');
  });

  it('welcome email omits the postal address line when EMAIL_POSTAL_ADDRESS is unset', async () => {
    process.env.RESEND_API_KEY = 're_test_key';
    delete process.env.EMAIL_POSTAL_ADDRESS;

    const res = makeRes();
    await handler(makeReq(), res);
    await flushBackground();

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

  it('enforces an HOURLY signup window — 5 submissions stay blocked long after 60s', async () => {
    // The stated intent is 5 signups per IP per hour. A per-minute (60s) window would reset here
    // and let a 6th welcome email fire minutes later; the hourly window must keep it blocked.
    vi.useFakeTimers();
    try {
      const ip = '10.55.55.55';
      const req = () => makeReq({ headers: { origin: 'https://theblueboard.co', 'x-real-ip': ip } });
      for (let i = 0; i < 5; i++) {
        const res = makeRes();
        await handler(req(), res);
        expect(res._status).toBe(200);
      }
      vi.advanceTimersByTime(5 * 60 * 1000); // 5 min — well past any per-minute window
      const res = makeRes();
      await handler(req(), res);
      expect(res._status).toBe(429); // still blocked inside the hour
    } finally {
      vi.useRealTimers();
    }
  });

  // ── Oct 28 2026 hardening ───────────────────────────────────────────────

  describe('email length', () => {
    // local@domain with the domain padded so the whole address is exactly n characters.
    function emailOfLength(n) {
      const local = 'a';
      const tld = '.com';
      return local + '@' + 'b'.repeat(n - local.length - 1 - tld.length) + tld;
    }

    it('accepts a 254-character address', async () => {
      const email = emailOfLength(254);
      expect(email).toHaveLength(254);
      const res = makeRes();
      await handler(makeReq({ body: { email } }), res);
      expect(res._status).toBe(200);
      expect(mockUpsert.mock.calls[0][0].email).toBe(email);
    });

    it('rejects a 255-character address with the usual 400, before touching the table', async () => {
      const email = emailOfLength(255);
      expect(email).toHaveLength(255);
      const res = makeRes();
      await handler(makeReq({ body: { email } }), res);
      expect(res._status).toBe(400);
      expect(res._json).toEqual({ error: 'Invalid or missing email address' });
      expect(mockUpsert).not.toHaveBeenCalled();
    });

    it('measures the trimmed address (surrounding whitespace is not counted)', async () => {
      const res = makeRes();
      await handler(makeReq({ body: { email: '   ' + emailOfLength(254) + '   ' } }), res);
      expect(res._status).toBe(200);
    });

    it('rejects a 100k-character string without saving it', async () => {
      const res = makeRes();
      await handler(makeReq({ body: { email: 'a@' + 'b.'.repeat(50_000) + ' ' } }), res);
      expect(res._status).toBe(400);
      expect(mockUpsert).not.toHaveBeenCalled();
    });
  });

  describe('Origin is required', () => {
    it('refuses a POST with no Origin header', async () => {
      const res = makeRes();
      await handler(makeReq({ headers: { 'x-real-ip': uniqueIp() } }), res);
      expect(res._status).toBe(403);
      expect(mockUpsert).not.toHaveBeenCalled();
    });

    it('refuses an empty Origin header', async () => {
      const res = makeRes();
      await handler(makeReq({ headers: { origin: '', 'x-real-ip': uniqueIp() } }), res);
      expect(res._status).toBe(403);
      expect(mockUpsert).not.toHaveBeenCalled();
    });

    it('refuses a request with no headers at all', async () => {
      const res = makeRes();
      await handler(makeReq({ headers: undefined }), res);
      expect(res._status).toBe(403);
    });

    it('refuses look-alike origins', async () => {
      for (const origin of [
        'http://theblueboard.co',
        'https://theblueboard.co.evil.com',
        'https://www.theblueboard.co',
        'https://theblueboard.co:8443',
        'http://localhost.evil.com',
        'null',
      ]) {
        const res = makeRes();
        await handler(makeReq({ headers: { origin, 'x-real-ip': uniqueIp() } }), res);
        expect(res._status, origin).toBe(403);
      }
      expect(mockUpsert).not.toHaveBeenCalled();
    });

    it('accepts the site and localhost, echoing the origin back', async () => {
      for (const origin of ['https://theblueboard.co', 'http://localhost', 'http://localhost:4321']) {
        const res = makeRes();
        await handler(makeReq({ headers: { origin, 'x-real-ip': uniqueIp() } }), res);
        expect(res._status, origin).toBe(200);
        expect(res._headers['Access-Control-Allow-Origin']).toBe(origin);
      }
    });
  });

  describe('daily welcome-email cap', () => {
    beforeEach(() => {
      process.env.RESEND_API_KEY = 're_test_key';
    });

    it(`counts the last 24 h of signups before sending (cap ${WELCOME_EMAIL_DAILY_CAP})`, async () => {
      expect(WELCOME_EMAIL_DAILY_CAP).toBe(50);
      const before = Date.now();
      const res = makeRes();
      await handler(makeReq(), res);
      await flushBackground();

      expect(mockCountSelect).toHaveBeenCalledWith('*', { count: 'exact', head: true });
      const [column, since] = mockCountGte.mock.calls[0];
      expect(column).toBe('created_at');
      const sinceMs = Date.parse(since);
      expect(before - sinceMs).toBeGreaterThanOrEqual(24 * 60 * 60 * 1000 - 1000);
      expect(before - sinceMs).toBeLessThanOrEqual(24 * 60 * 60 * 1000 + 1000);
      expect(mockEmailSend).toHaveBeenCalledTimes(1);
    });

    it('sends when the count is exactly at the cap (the new row is included in the count)', async () => {
      countResult = { count: WELCOME_EMAIL_DAILY_CAP, error: null };
      const res = makeRes();
      await handler(makeReq(), res);
      await flushBackground();
      expect(res._status).toBe(200);
      expect(mockEmailSend).toHaveBeenCalledTimes(1);
    });

    it('over the cap: saves the signup, skips the email, logs a warning', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      countResult = { count: WELCOME_EMAIL_DAILY_CAP + 1, error: null };
      const res = makeRes();
      await handler(makeReq(), res);
      await flushBackground();

      expect(res._status).toBe(200);
      expect(res._json).toEqual({ success: true });
      expect(mockUpsert).toHaveBeenCalledTimes(1);
      expect(mockEmailSend).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/daily cap of 50/));
      warn.mockRestore();
    });

    it('count query error: signup succeeds (fails open), email is skipped (fails closed)', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      countResult = { count: null, error: { message: 'statement timeout' } };
      const res = makeRes();
      await handler(makeReq(), res);
      await flushBackground();

      expect(res._status).toBe(200);
      expect(mockUpsert).toHaveBeenCalledTimes(1);
      expect(mockEmailSend).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalledWith(expect.stringMatching(/count failed/), 'statement timeout');
      errorSpy.mockRestore();
    });

    it('count query throws: signup succeeds, email is skipped, nothing rejects', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockCountGte.mockImplementation(() => Promise.reject(new Error('socket hang up')));
      const res = makeRes();
      await handler(makeReq(), res);
      await expect(flushBackground()).resolves.toBeUndefined();

      expect(res._status).toBe(200);
      expect(mockEmailSend).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalled();
      errorSpy.mockRestore();
    });

    it('a missing count (null without an error) also skips the email', async () => {
      countResult = { count: null, error: null };
      const res = makeRes();
      await handler(makeReq(), res);
      await flushBackground();
      expect(res._status).toBe(200);
      expect(mockEmailSend).not.toHaveBeenCalled();
    });

    it('does not run the count query when Resend is not configured', async () => {
      delete process.env.RESEND_API_KEY;
      const res = makeRes();
      await handler(makeReq(), res);
      await flushBackground();
      expect(res._status).toBe(200);
      expect(mockCountSelect).not.toHaveBeenCalled();
      expect(mockEmailSend).not.toHaveBeenCalled();
    });
  });
});
