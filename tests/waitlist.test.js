import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockEmailSend = vi.fn();

// Mock @supabase/supabase-js to prevent createClient from throwing
// when env vars are missing in test environment
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ from: vi.fn() })),
}));

// Mock Supabase before importing handler
vi.mock('../api/_supabase.js', () => ({
  supabase: {
    from: vi.fn(),
  },
}));

vi.mock('resend', () => ({
  Resend: vi.fn(() => ({
    emails: {
      send: mockEmailSend,
    },
  })),
}));

import handler from '../api/waitlist.js';
import { supabase } from '../api/_supabase.js';

// Use unique IPs per test to avoid rate limiter collisions
let ipCounter = 100;
function uniqueIp() { return '10.0.0.' + (ipCounter++); }

let existingRows = [];
let upsertError = null;
let mockUpsert;
let mockSelect;
let mockEq;
let mockLimit;

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
    existingRows = [];
    upsertError = null;
    mockEmailSend.mockResolvedValue({ data: { id: 'email_123' }, error: null });

    mockUpsert = vi.fn(() => Promise.resolve({ error: upsertError }));
    mockLimit = vi.fn(() => Promise.resolve({ data: existingRows, error: null }));
    mockEq = vi.fn(() => ({ limit: mockLimit }));
    mockSelect = vi.fn(() => ({ eq: mockEq }));

    supabase.from.mockReturnValue({
      select: mockSelect,
      upsert: mockUpsert,
    });

    delete process.env.RESEND_API_KEY;
  });

  afterEach(() => {
    delete process.env.RESEND_API_KEY;
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

  it('upserts with correct data', async () => {
    const res = makeRes();
    await handler(makeReq({ body: { email: 'Test@Example.com', source: 'footer', featureRequest: 'Dark mode' } }), res);

    expect(supabase.from).toHaveBeenCalledWith('waitlist');
    expect(mockUpsert).toHaveBeenCalledWith(
      { email: 'test@example.com', source: 'footer', feature_request: 'Dark mode' },
      { onConflict: 'email' }
    );
    expect(res._status).toBe(200);
  });

  it('returns 500 on Supabase error', async () => {
    upsertError = { message: 'db error' };

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

  it('truncates long source and feature_request', async () => {
    const res = makeRes();
    await handler(makeReq({
      body: {
        email: 'a@b.com',
        source: 'x'.repeat(100),
        featureRequest: 'y'.repeat(1000),
      },
    }), res);

    const upsertArg = mockUpsert.mock.calls[0][0];
    expect(upsertArg.source.length).toBe(50);
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

  it('skips the welcome email for repeat signups', async () => {
    process.env.RESEND_API_KEY = 're_test_key';
    existingRows = [{ email: 'test@example.com' }];

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
