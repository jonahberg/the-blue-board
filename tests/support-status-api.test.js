/**
 * GET /api/support-status: this Central month's covered days, today's coverer, the daily cost,
 * and nothing else. `{configured:false}` whenever there is no truthful coverage to report (no
 * webhook secret, no table, a failed read). CDN-cached ~60 s, rate-limited, memoised.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ rows: [], error: null, queries: [] }));

vi.mock('../api/_supabase.js', () => ({
  getSupabase: () => ({
    from(table) {
      const q = { table, filters: [], order: [], limit: null, columns: null };
      db.queries.push(q);
      const chain = {
        select(columns) {
          q.columns = columns;
          return chain;
        },
        eq(col, val) {
          q.filters.push(['eq', col, val]);
          return chain;
        },
        gte(col, val) {
          q.filters.push(['gte', col, val]);
          return chain;
        },
        lt(col, val) {
          q.filters.push(['lt', col, val]);
          return chain;
        },
        in(col, vals) {
          q.filters.push(['in', col, vals]);
          return chain;
        },
        order(col) {
          q.order.push(col);
          return chain;
        },
        limit(n) {
          q.limit = n;
          if (db.error) return Promise.resolve({ data: null, error: db.error });
          const rows = db.rows.filter((r) =>
            q.filters.every(([op, col, val]) =>
              op === 'eq' ? r[col] === val : op === 'gte' ? r[col] >= val : op === 'lt' ? r[col] < val : val.includes(r[col]),
            ),
          );
          return Promise.resolve({ data: rows, error: null });
        },
      };
      return chain;
    },
  }),
}));

const { default: handler, STATUS_CACHE_CONTROL, __resetSupportStatusForTests } = await import('../api/support-status.js');
const { __resetRateLimitersForTests } = await import('../api/_rate-limit.js');

// Nov 10 2026, noon Central.
const NOW = Date.parse('2026-11-10T18:00:00Z');

let id = 0;
const row = (dollars, paidAt, extra = {}) => ({
  id: ++id,
  session_id: `cs_live_${id}`,
  amount_cents: dollars * 100,
  currency: 'usd',
  paid_at: paidAt,
  refunded: false,
  amount_refunded_cents: 0,
  display_name: null,
  hidden: false,
  livemode: true,
  payment_link_id: 'plink_1Support',
  ...extra,
});

function createRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

async function get(method = 'GET') {
  const res = createRes();
  await handler({ method, headers: {} }, res);
  return res;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  db.rows = [];
  db.error = null;
  db.queries = [];
  __resetSupportStatusForTests();
  __resetRateLimitersForTests();
  vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_x');
  vi.stubEnv('VERCEL_ENV', 'production');
  vi.stubEnv('SUPPORTER_NAMES', '');
  vi.stubEnv('STRIPE_PAYMENT_LINK_IDS', '');
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('GET /api/support-status', () => {
  it('reports this month\'s coverage, today\'s coverer and the daily cost — nothing else', async () => {
    db.rows = [row(17 * 9, '2026-11-02T15:00:00.000Z'), row(17, '2026-11-09T15:00:00.000Z', { display_name: 'Dana R.' })];
    const res = await get();
    expect(res.statusCode).toBe(200);
    expect(res.headers['Cache-Control']).toBe(STATUS_CACHE_CONTROL);
    expect(STATUS_CACHE_CONTROL).toBe('public, s-maxage=60, stale-while-revalidate=60');
    expect(res.body).toMatchObject({
      configured: true,
      timeZone: 'America/Chicago',
      month: '2026-11',
      daysInMonth: 30,
      today: 10,
      daysCovered: 10,
      todayCovered: true,
      todayBy: 'Dana R.',
      dailyCostUsd: 17,
    });
    expect(JSON.stringify(res.body)).not.toMatch(/amount|cents|session|plink|153|cs_live/);
  });

  it('reads one Central month (from 05:00Z on Nov 1 2026, the day DST ends), USD and live only', async () => {
    await get();
    const [q] = db.queries;
    expect(q.table).toBe('supporter_payments');
    expect(q.columns).not.toMatch(/email|customer/);
    expect(q.filters).toEqual(
      expect.arrayContaining([
        ['eq', 'currency', 'usd'],
        ['gte', 'paid_at', '2026-11-01T05:00:00.000Z'],
        ['lt', 'paid_at', '2026-12-01T06:00:00.000Z'],
        ['eq', 'livemode', true],
      ]),
    );
  });

  it('counts test-mode rows outside production', async () => {
    vi.stubEnv('VERCEL_ENV', 'preview');
    db.rows = [row(17 * 10, '2026-11-02T15:00:00.000Z', { livemode: false })];
    expect((await get()).body.daysCovered).toBe(10);
  });

  it('counts only the allowlisted Payment Links when STRIPE_PAYMENT_LINK_IDS is set', async () => {
    vi.stubEnv('STRIPE_PAYMENT_LINK_IDS', 'plink_1Support, plink_2Monthly');
    db.rows = [row(17 * 10, '2026-11-02T15:00:00.000Z', { payment_link_id: 'plink_9OtherProduct' }), row(17, '2026-11-02T16:00:00.000Z')];
    const res = await get();
    expect(db.queries[0].filters).toContainEqual(['in', 'payment_link_id', ['plink_1Support', 'plink_2Monthly']]);
    expect(res.body.daysCovered).toBe(1);
  });

  it('applies the owner\'s hidden flag and the SUPPORTER_NAMES switch', async () => {
    db.rows = [row(17 * 10, '2026-11-02T15:00:00.000Z', { display_name: 'Dana R.', hidden: true })];
    expect((await get()).body.todayBy).toBe('a supporter');
    __resetSupportStatusForTests();
    db.rows = [row(17 * 10, '2026-11-02T15:00:00.000Z', { display_name: 'Dana R.' })];
    vi.stubEnv('SUPPORTER_NAMES', 'off');
    expect((await get()).body.todayBy).toBe('a supporter');
  });

  it('answers {configured:false} without the webhook secret, without reading anything', async () => {
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', '');
    expect((await get()).body).toEqual({ configured: false });
    expect(db.queries).toHaveLength(0);
  });

  it('answers {configured:false} while sql/023 is not applied, and on any failed read', async () => {
    db.error = { code: 'PGRST205', message: "Could not find the table 'public.supporter_payments'" };
    expect((await get()).body).toEqual({ configured: false });
    expect(console.error).not.toHaveBeenCalled();
    __resetSupportStatusForTests();
    db.error = { code: '57014', message: 'timeout' };
    expect((await get()).body).toEqual({ configured: false });
    expect(console.error).toHaveBeenCalled();
  });

  it('memoises for 30 s per instance, so cache-busting query strings cannot hammer the table', async () => {
    await get();
    await get();
    expect(db.queries).toHaveLength(1);
    vi.setSystemTime(NOW + 31_000);
    await get();
    expect(db.queries).toHaveLength(2);
  });

  it('answers 405 to anything but GET and keeps a 429 out of the CDN', async () => {
    expect((await get('POST')).statusCode).toBe(405);
    let last;
    for (let i = 0; i < 61; i += 1) last = await get();
    expect(last.statusCode).toBe(429);
    expect(last.headers['Cache-Control']).toBe('no-store');
  });
});
