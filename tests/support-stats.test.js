import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import handler from '../api/support-stats.js';
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

  it('includes the static monthlyCostNote', async () => {
    const res = createRes();
    await handler(makeReq(), res);
    expect(res.body.monthlyCostNote).toBe('Data feeds, hosting, and AI explanations cost real money every month');
  });
});
