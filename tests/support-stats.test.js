import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import handler, { __resetLiveFeedMemo } from '../api/support-stats.js';
import * as costState from '../api/_cost-state.js';
import * as fr24Usage from '../api/fr24-usage.js';

function createRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    ended: false,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
    end() { this.ended = true; return this; },
  };
}

function makeReq(overrides = {}) {
  return { method: 'GET', headers: {}, ...overrides };
}

describe('support-stats API', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    __resetLiveFeedMemo();
    delete process.env.FR24_API_TOKEN;
    delete process.env.FR24_MONTHLY_CREDIT_BUDGET;
  });

  afterEach(() => {
    delete process.env.FR24_API_TOKEN;
    delete process.env.FR24_MONTHLY_CREDIT_BUDGET;
  });

  it('returns 405 for non-GET requests', async () => {
    const res = createRes();
    await handler(makeReq({ method: 'POST' }), res);
    expect(res.statusCode).toBe(405);
  });

  it('returns 204 for OPTIONS preflight', async () => {
    const res = createRes();
    await handler(makeReq({ method: 'OPTIONS' }), res);
    expect(res.statusCode).toBe(204);
    expect(res.ended).toBe(true);
  });

  it('sets a public, heavily-cached Cache-Control header', async () => {
    const res = createRes();
    await handler(makeReq(), res);
    expect(res.headers['Cache-Control']).toBe('public, s-maxage=300, stale-while-revalidate=600');
  });

  it('returns the sanitized boards summary from _cost-state helpers', async () => {
    vi.spyOn(costState, 'getAdbUnitsToday').mockReturnValue(340);
    vi.spyOn(costState, 'getAdbDailyUnitBudget').mockReturnValue(400);

    const res = createRes();
    await handler(makeReq(), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.boards).toEqual({ used: 340, budget: 400 });
  });

  it('reports liveFeed as unconfigured when FR24_API_TOKEN is absent', async () => {
    const fetchSpy = vi.spyOn(fr24Usage, 'fetchFr24UsageRaw');
    const res = createRes();
    await handler(makeReq(), res);

    expect(res.body.liveFeed).toEqual({ configured: false });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('computes a coarse rounded-to-5% liveFeed usage when configured', async () => {
    process.env.FR24_API_TOKEN = 'test-token';
    process.env.FR24_MONTHLY_CREDIT_BUDGET = '1000';
    vi.spyOn(fr24Usage, 'fetchFr24UsageRaw').mockResolvedValue({
      data: [
        { endpoint: '/api/flight-summary', request_count: 50, credits: 430 },
        { endpoint: '/api/live/flight-positions', request_count: 30, credits: 220 },
      ],
    });

    const res = createRes();
    await handler(makeReq(), res);

    // (430 + 220) / 1000 = 65% exactly, already a multiple of 5.
    expect(res.body.liveFeed).toEqual({ configured: true, usedPct: 65 });
  });

  it('never leaks raw credit counts or dollar amounts, only the rounded percentage', async () => {
    process.env.FR24_API_TOKEN = 'test-token';
    process.env.FR24_MONTHLY_CREDIT_BUDGET = '1000';
    vi.spyOn(fr24Usage, 'fetchFr24UsageRaw').mockResolvedValue({
      data: [{ endpoint: '/api/flight-summary', request_count: 12, credits: 123 }],
    });

    const res = createRes();
    await handler(makeReq(), res);

    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toMatch(/123/);
    expect(serialized).not.toMatch(/\$/);
  });

  it('degrades gracefully to unconfigured when the upstream fetch fails', async () => {
    process.env.FR24_API_TOKEN = 'test-token';
    vi.spyOn(fr24Usage, 'fetchFr24UsageRaw').mockRejectedValue(new Error('boom'));

    const res = createRes();
    await handler(makeReq(), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.liveFeed).toEqual({ configured: false });
  });

  // ── Cost + honesty guards ────────────────────────────────────────────────────
  // This endpoint is public and unauthenticated, and the CDN cache is keyed by the full URL, so
  // `?z=<random>` reaches the origin every time. Each origin hit used to fire a fresh
  // authenticated FR24 usage call, making an anonymous loop an amplifier onto a metered upstream.

  it('memoizes the upstream usage call across requests', async () => {
    process.env.FR24_API_TOKEN = 'test-token';
    process.env.FR24_MONTHLY_CREDIT_BUDGET = '1000';
    const fetchSpy = vi.spyOn(fr24Usage, 'fetchFr24UsageRaw').mockResolvedValue({
      data: [{ credits: 500 }],
    });

    for (let i = 0; i < 5; i++) await handler(makeReq(), createRes());

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('serves the last good reading when the upstream starts failing, instead of flapping to unconfigured', async () => {
    process.env.FR24_API_TOKEN = 'test-token';
    process.env.FR24_MONTHLY_CREDIT_BUDGET = '1000';

    // Prime the memo with a success, then make every later fetch blow up.
    const spy = vi
      .spyOn(fr24Usage, 'fetchFr24UsageRaw')
      .mockResolvedValueOnce({ data: [{ credits: 300 }] });
    const first = createRes();
    await handler(makeReq(), first);
    expect(first.body.liveFeed).toEqual({ configured: true, usedPct: 30 });

    spy.mockRejectedValue(new Error('FR24 503'));
    // Push past the memo's freshness window so the failing branch is actually taken.
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 6 * 60 * 1000);

    const second = createRes();
    await handler(makeReq(), second);

    // {configured:false} is the same shape as "no token", so a failed fetch must not use it
    // while a recent good reading exists — that made the meter silently vanish.
    expect(second.body.liveFeed).toEqual({ configured: true, usedPct: 30 });
  });

  it('rate limits a single IP and never lets the 429 into the shared CDN cache', async () => {
    const req = () => makeReq({ headers: { 'x-real-ip': '203.0.113.9' } });

    let limited = null;
    for (let i = 0; i < 61; i++) {
      const res = createRes();
      await handler(req(), res);
      if (res.statusCode === 429) { limited = res; break; }
    }

    expect(limited, 'expected a 429 within 61 requests from one IP').not.toBeNull();
    expect(limited.headers['Cache-Control']).toBe('no-store');
  });

  it('includes the static monthlyCostNote', async () => {
    const res = createRes();
    await handler(makeReq(), res);
    expect(res.body.monthlyCostNote).toBe('Data feeds, hosting, and AI explanations cost real money every month');
  });
});
