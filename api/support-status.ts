// "Cover a day" status — which days of this month supporters have covered.
// GET /api/support-status   (public, unauthenticated, identical for every visitor)
//
// → 200 { configured: true, timeZone: 'America/Chicago', month: 'YYYY-MM', daysInMonth, today,
//         daysCovered, todayCovered, todayBy, days: [{ day, by }], dailyCostUsd: 17 }
//   `today` is the US Central date. Days are covered in order from the 1st (src/lib/cover-a-day.js),
//   so `days` lists days 1..daysCovered and `by` is the shown label for each: a name that passed
//   src/lib/supporter-name.js on a row the owner has not hidden, "a supporter", or "N supporters"
//   for a pooled day. Nothing else: no amount per person, no dollar totals, no ids.
// → 200 { configured: false }  when the webhook is not set up (no STRIPE_WEBHOOK_SECRET), the table
//   is missing (sql/023 not applied yet), or the read fails. The dashboard then shows the plain
//   $17-a-day ask and makes no coverage claim.
//
// Counts only USD rows paid in the current Central month; in production only live-mode rows; and,
// when STRIPE_PAYMENT_LINK_IDS is set (comma-separated `plink_…`), only payments from those links,
// so another product sold on the same Stripe account can never read as site coverage.
// SUPPORTER_NAMES=off shows every day as "a supporter".
//
// CDN-cached ~60 s. The memo bounds Supabase reads when a caller busts the cache with junk query
// strings: one read per 30 s per warm instance. Rate-limited per IP like /api/support-stats.

import type { VercelRequest, VercelResponse } from './_types.js';
import { createRateLimiter } from './_rate-limit.js';
import { getSupabase } from './_supabase.js';
import { COVER_TIME_ZONE, monthBoundsUtc, supportStatusFromRows, zonedDate } from '../src/lib/cover-a-day.js';
import { supporterNamesEnabled } from '../src/lib/supporter-name.js';

const isRateLimited = createRateLimiter('support-status', 60);

export const STATUS_CACHE_CONTROL = 'public, s-maxage=60, stale-while-revalidate=60';
export const STATUS_MEMO_MS = 30_000;
const TABLE = 'supporter_payments';
const COLUMNS = 'id, session_id, amount_cents, currency, paid_at, refunded, amount_refunded_cents, display_name, hidden, payment_link_id';
/** A month holds a few hundred payments at the very most; this is a ceiling, not a page. */
const ROW_LIMIT = 5000;

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

  const today = zonedDate(nowMs, COVER_TIME_ZONE);
  const { startMs, endMs } = monthBoundsUtc(today.year, today.month, COVER_TIME_ZONE);
  let query = getSupabase()
    .from(TABLE)
    .select(COLUMNS)
    .eq('currency', 'usd')
    .gte('paid_at', new Date(startMs).toISOString())
    .lt('paid_at', new Date(endMs).toISOString());
  if (process.env.VERCEL_ENV === 'production') query = query.eq('livemode', true);
  const links = paymentLinkAllowlist();
  if (links.length) query = query.in('payment_link_id', links);
  const { data, error } = await query.order('paid_at', { ascending: true }).order('id', { ascending: true }).limit(ROW_LIMIT);

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
