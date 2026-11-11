// "Cover a day" status — which days of this month supporters have covered.
// GET /api/support-status   (public, unauthenticated, identical for every visitor)
//
// → 200 { configured: true, timeZone: 'America/Chicago', month: 'YYYY-MM', daysInMonth, today,
//         daysCovered, todayCovered, todayBy, nextOpenDate: 'YYYY-MM-DD' | null,
//         days: [{ day, by }], dailyCostUsd: 17 }
//   `today` is the US Central date. A payment covers the day it was made, or the next open day
//   after it, with leftovers pooled (src/lib/cover-a-day.js), so `days` lists this month's covered
//   days (not necessarily from the 1st, gaps and all) and `by` is the shown label for each: a name
//   that passed src/lib/supporter-name.js on a row the owner has not hidden, "a supporter", or
//   "N supporters" for a pooled day. `nextOpenDate` is the first open day on or after today (it
//   may be next month), which is the day $17 given now would cover. Nothing else: no amount per
//   person, no dollar totals, no ids.
// → 200 { configured: false }  when the webhook is not set up (no STRIPE_WEBHOOK_SECRET), the table
//   is missing (sql/023 not applied yet), or the read fails. The dashboard then shows the plain
//   $17-a-day ask and makes no coverage claim, and the flight page keeps its own support sentence
//   (it reads this once per page view, src/scripts/flight-page.ts).
//
// READ WINDOW: the last 400 days of payments (READ_WINDOW_DAYS), allocated in full, so money carried
// over from earlier months (a $40 gift on Oct 31 covers Nov 1) shows on this month's calendar. A
// payment older than that could only reach this month by pre-paying more than 400 days ahead
// ($6,800 in one gift); that case is accepted as lost. Counts only USD rows; in production only
// live-mode rows; and,
// when STRIPE_PAYMENT_LINK_IDS is set (comma-separated `plink_…`), only payments from those links,
// so another product sold on the same Stripe account can never read as site coverage.
// SUPPORTER_NAMES=off shows every day as "a supporter".
//
// CDN-cached ~60 s. The memo bounds Supabase reads when a caller busts the cache with junk query
// strings: one read per 30 s per warm instance. Rate-limited per IP like /api/support-stats.

import type { VercelRequest, VercelResponse } from './_types.js';
import { createRateLimiter } from './_rate-limit.js';
import { getSupabase } from './_supabase.js';
import { COVER_TIME_ZONE, supportStatusFromRows } from '../src/lib/cover-a-day.js';
import { supporterNamesEnabled } from '../src/lib/supporter-name.js';

const isRateLimited = createRateLimiter('support-status', 60);

export const STATUS_CACHE_CONTROL = 'public, s-maxage=60, stale-while-revalidate=60';
export const STATUS_MEMO_MS = 30_000;
const TABLE = 'supporter_payments';
const COLUMNS = 'id, session_id, amount_cents, currency, paid_at, refunded, amount_refunded_cents, display_name, hidden, payment_link_id';
/** How far back payments are read (see the header). */
export const READ_WINDOW_DAYS = 400;
/** A ceiling, not a page: 400 days of this site's donations are a few hundred rows. If it is ever
 * reached, the NEWEST rows are kept (the read is newest-first) and the oldest carry-over is lost. */
const ROW_LIMIT = 10000;

let memo: { at: number; body: Record<string, unknown> } | null = null;
let inFlight: Promise<Record<string, unknown>> | null = null;

/** Test seam: the module-level memo would otherwise leak across cases. */
export function __resetSupportStatusForTests(): void {
  memo = null;
  inFlight = null;
}

function paymentLinkAllowlist(): string[] {
  return String(process.env.STRIPE_PAYMENT_LINK_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^plink_[A-Za-z0-9_]+$/.test(s));
}

async function buildBody(nowMs: number): Promise<Record<string, unknown>> {
  if (!process.env.STRIPE_WEBHOOK_SECRET) return { configured: false };

  const since = new Date(nowMs - READ_WINDOW_DAYS * 86_400_000).toISOString();
  let query = getSupabase().from(TABLE).select(COLUMNS).eq('currency', 'usd').gte('paid_at', since);
  if (process.env.VERCEL_ENV === 'production') query = query.eq('livemode', true);
  const links = paymentLinkAllowlist();
  if (links.length) query = query.in('payment_link_id', links);
  // Newest first, so a hit ceiling drops the oldest rows; the allocation re-sorts by paid time.
  const { data, error } = await query.order('paid_at', { ascending: false }).order('id', { ascending: false }).limit(ROW_LIMIT);

  if (error) {
    // 42P01 / PGRST205: sql/023 has not been applied. Anything else is a failed read. Either way
    // the honest answer is "no coverage to report".
    const missing = error.code === '42P01' || error.code === 'PGRST205';
    if (!missing) console.error('support-status: read failed:', error.code || '', error.message || error);
    return { configured: false };
  }

  return supportStatusFromRows(Array.isArray(data) ? data : [], nowMs, {
    timeZone: COVER_TIME_ZONE,
    namesOn: supporterNamesEnabled(process.env.SUPPORTER_NAMES),
  });
}

async function currentBody(nowMs: number): Promise<Record<string, unknown>> {
  if (memo && nowMs - memo.at < STATUS_MEMO_MS) return memo.body;
  if (inFlight) return inFlight;
  inFlight = buildBody(nowMs)
    .catch((e: any) => {
      // getSupabase() throws when Supabase is not configured at all.
      console.error('support-status: failed:', e?.message || e);
      return { configured: false } as Record<string, unknown>;
    })
    .then((body) => {
      memo = { at: nowMs, body };
      return body;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (isRateLimited(req)) {
    // Never let a 429 into the shared CDN cache — it would be served to innocent visitors.
    res.setHeader('Cache-Control', 'no-store');
    return res.status(429).json({ error: 'Rate limited — try again shortly' });
  }

  const body = await currentBody(Date.now());
  res.setHeader('Cache-Control', STATUS_CACHE_CONTROL);
  return res.status(200).json(body);
}
