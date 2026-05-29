import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockBroadcastCreate = vi.fn();
const mockBroadcastSend = vi.fn();

// Mock @supabase/supabase-js so the real getSupabase() in api/_supabase.ts
// returns a mockable client. Env vars below satisfy the startup checks.
const mockFrom = vi.fn();
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ from: mockFrom })),
}));

// Env must be set before the handler module loads (it reads env lazily, but
// multiple tests share the same module).
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://test.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
process.env.NODE_ENV = 'test';
delete process.env.VERCEL_ENV;

vi.mock('resend', () => ({
  Resend: vi.fn(function () {
    return {
      broadcasts: {
        create: mockBroadcastCreate,
        send: mockBroadcastSend,
      },
    };
  }),
}));

import handler from '../api/news-notify.js';

// The handler's atomic claim uses:
//   .update({slug}).eq('key','last_sent').neq('slug', newSlug).select('slug')
// When the UPDATE affects 1 row, data is [{slug: newSlug}] → we won the claim.
// When 0 rows, data is [] → either seed missing or someone already claimed.
// On the 0-rows path, the handler does a follow-up read:
//   .select('slug').eq('key','last_sent').maybeSingle()
// to distinguish "seed missing" from "already sent."
let claimResult;
let readAfterClaimResult;

function makeReq(overrides = {}) {
  return {
    method: 'POST',
    headers: { authorization: 'Bearer test-secret' },
    ...overrides,
  };
}

function makeRes() {
  const res = {
    statusCode: null,
    body: null,
    status(code) { res.statusCode = code; return res; },
    json(data) { res.body = data; return res; },
  };
  return res;
}

beforeEach(() => {
  vi.stubEnv('CRON_SECRET', 'test-secret');
  vi.stubEnv('RESEND_API_KEY', 'test-key');
  vi.stubEnv('RESEND_AUDIENCE_ID', 'aud-123');
  mockBroadcastCreate.mockReset();
  mockBroadcastSend.mockReset();

  mockBroadcastCreate.mockResolvedValue({ data: { id: 'bcast-123' }, error: null });
  mockBroadcastSend.mockResolvedValue({ error: null });

  // Default: claim succeeds (1 row updated), send proceeds
  claimResult = { data: [{ slug: 'test-article' }], error: null };
  // Default: if 0 rows from claim, a read confirms slug = current = already sent
  readAfterClaimResult = { data: { slug: 'test-article' }, error: null };

  // Build the update()→eq()→neq()→select() chain that returns claimResult.
  const mockUpdateSelect = vi.fn(() => Promise.resolve(claimResult));
  const mockNeq = vi.fn(() => ({ select: mockUpdateSelect }));
  const mockUpdateEq = vi.fn(() => ({ neq: mockNeq }));
  const mockUpdate = vi.fn(() => ({ eq: mockUpdateEq }));

  // Build the fallback select()→eq()→maybeSingle() chain.
  const mockMaybeSingle = vi.fn(() => Promise.resolve(readAfterClaimResult));
  const mockReadEq = vi.fn(() => ({ maybeSingle: mockMaybeSingle }));
  const mockSelect = vi.fn(() => ({ eq: mockReadEq }));

  mockFrom.mockImplementation(() => ({
    update: mockUpdate,
    select: mockSelect,
  }));

  global.fetch = vi.fn(() =>
    Promise.resolve({
      ok: true,
      json: () =>
        Promise.resolve([
          { slug: 'test-article', title: 'Test Article', date: '2026-03-19', category: 'Fleet' },
        ]),
    })
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('news-notify API', () => {
  it('rejects non-POST requests', async () => {
    const res = makeRes();
    await handler(makeReq({ method: 'GET' }), res);
    expect(res.statusCode).toBe(405);
  });

  it('rejects unauthorized requests', async () => {
    const res = makeRes();
    await handler(makeReq({ headers: { authorization: 'Bearer wrong' } }), res);
    expect(res.statusCode).toBe(401);
  });

  it('rejects requests with no auth header', async () => {
    const res = makeRes();
    await handler(makeReq({ headers: {} }), res);
    expect(res.statusCode).toBe(401);
  });

  it('returns 500 if RESEND_API_KEY is missing', async () => {
    vi.stubEnv('RESEND_API_KEY', '');
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res.statusCode).toBe(500);
    expect(res.body.error).toMatch(/RESEND_API_KEY/);
  });

  it('returns already_sent when the claim UPDATE affects 0 rows and the stored slug equals the new slug', async () => {
    // Simulate: row already holds 'test-article', so .neq('slug', 'test-article')
    // finds nothing to update. Fallback read confirms the same slug.
    claimResult = { data: [], error: null };
    readAfterClaimResult = { data: { slug: 'test-article' }, error: null };

    const res = makeRes();
    await handler(makeReq(), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('already_sent');
    expect(mockBroadcastCreate).not.toHaveBeenCalled();
  });

  it('claims slug then sends broadcast for new articles', async () => {
    // Default claimResult = 1 row returned → we won the claim.
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('sent');
    expect(res.body.slug).toBe('test-article');
    expect(mockBroadcastCreate).toHaveBeenCalledOnce();
    expect(mockBroadcastSend).toHaveBeenCalledWith('bcast-123');
  });

  it('sends broadcast when last slug differs (atomic UPDATE succeeds)', async () => {
    claimResult = { data: [{ slug: 'test-article' }], error: null };
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('sent');
    expect(mockBroadcastCreate).toHaveBeenCalledOnce();
  });

  it('returns no_articles when news-latest.json is empty', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
    );
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('no_articles');
  });

  it('returns 500 when broadcast create fails', async () => {
    mockBroadcastCreate.mockResolvedValue({ data: null, error: { message: 'Invalid audience' } });
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res.statusCode).toBe(500);
    expect(res.body.error).toMatch(/Failed to send/);
  });

  it('returns 500 when the claim UPDATE errors', async () => {
    claimResult = { data: null, error: { message: 'RLS violation' } };
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res.statusCode).toBe(500);
    expect(res.body.error).toMatch(/Failed to send/);
    expect(mockBroadcastCreate).not.toHaveBeenCalled();
  });

  it('returns 500 when the seed row is missing (UPDATE 0 rows + read finds no row)', async () => {
    // Regression guard for sql/005_news_notifications_seed.sql: if that
    // migration wasn't run, the atomic UPDATE can't find its target.
    claimResult = { data: [], error: null };
    readAfterClaimResult = { data: null, error: null };
    const res = makeRes();
    await handler(makeReq(), res);
    expect(res.statusCode).toBe(500);
    expect(res.body.error).toMatch(/Failed to send/);
  });

  it('does not leak err.message in the JSON response', async () => {
    // Upstream throws with a schema-revealing message — the handler must
    // log internally but respond with a generic error.
    global.fetch = vi.fn(() => Promise.reject(new Error('supabase schema audience_xyz secret')));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = makeRes();
    await handler(makeReq(), res);

    expect(res.statusCode).toBe(500);
    expect(res.body.error).toBe('Failed to send notification');
    expect(JSON.stringify(res.body)).not.toContain('supabase schema audience_xyz secret');
    errorSpy.mockRestore();
  });
});
