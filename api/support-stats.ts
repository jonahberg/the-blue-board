// Public cost-transparency endpoint — "what it costs to keep this free".
// GET /api/support-stats  (no auth; safe for any visitor to read)
//
// Renders the About/Donate popover's support meter (public/js/support-meter.js). Everything
// returned here is deliberately SANITIZED and COARSE:
//   - boards.{used,budget}: today's AeroDataBox schedule-refresh unit total + the daily budget
//     (api/_cost-state.ts). This lambda never records ADB spend itself — only the schedule/warm-cron
//     paths call recordAdbUnits — so its per-instance getAdbUnitsToday counter is structurally 0.
//     We therefore call hydrateAdbSpend() first to pull the real CROSS-INSTANCE total from Supabase
//     (schedule_provider_spend); it is TTL-limited, never throws, and degrades to the in-memory
//     value on any failure, so a broken read shows a stale/zero meter rather than erroring.
//     AeroDataBox is already publicly credited on the Sources page, so naming it is fine; no raw
//     account/plan info.
//   - liveFeed.usedPct: a coarse (rounded to nearest 5%) FR24 billing-period credit-consumption
//     percentage. Computed from the SAME upstream fetch used by the CRON_SECRET-gated
//     api/fr24-usage.ts (fetchFr24UsageRaw, a minimal export added there for this reuse — that
//     endpoint's own auth gate is untouched). No raw credit counts, dollar amounts, or account
//     identifiers are ever included. If FR24_API_TOKEN is absent, or the upstream call fails,
//     liveFeed reports { configured: false } rather than erroring the whole response.
//   - monthlyCostNote: a static string the widget renders alongside the bars.
//
// Heavily cached at the CDN (s-maxage 300 + SWR) since none of this needs to be fresh to the
// second and it is public, unauthenticated, and safe to share across all visitors.

import type { VercelRequest, VercelResponse } from './types.js';
import { hydrateAdbSpend, getAdbDailyUnitBudget } from './_cost-state.js';
import { fetchFr24UsageRaw } from './fr24-usage.js';
import { createRateLimiter } from './_rate-limit.js';

const MONTHLY_COST_NOTE = 'Data feeds, hosting, and AI explanations cost real money every month';

// This endpoint is public and unauthenticated, and the CDN cache is keyed by the full URL — so
// `?z=<random>` is a MISS every time and reaches the origin. Before the memo below, each MISS
// fired a fresh *authenticated* call to FR24's usage API, which made an anonymous loop an
// amplifier onto a metered upstream this project has exhausted before. The rate limiter is
// per-instance (serverless) and so only partial cover; the memo is the real guard, because it
// bounds upstream calls to one per TTL per warm instance no matter how many requests arrive.
const isRateLimited = createRateLimiter('support-stats', 60);

const LIVE_FEED_TTL_MS = 5 * 60 * 1000;
// How long a last-known-good reading may be served after the upstream starts failing. Without
// this, a flaky FR24 made the response flap between {configured:true} and {configured:false} on
// consecutive identical requests — and {configured:false} is the same shape the endpoint uses to
// mean "no token configured", so the meter silently vanished rather than admitting a bad fetch.
const LIVE_FEED_STALE_MS = 30 * 60 * 1000;

type LiveFeed = { configured: false } | { configured: true; usedPct: number };
let liveFeedMemo: { at: number; value: { configured: true; usedPct: number } } | null = null;

/** Test seam: module-level memo would otherwise leak across cases. */
export function __resetLiveFeedMemo(): void {
  liveFeedMemo = null;
}

// Coarse denominator for the live-feed percentage. There is no published per-account credit
// ceiling in the FR24 usage response itself, so this is an operator-configured estimate of the
// current plan's monthly credit allotment — same "operator env override, sane default" pattern
// as AERODATABOX_DAILY_UNIT_BUDGET in api/_cost-state.ts. Only ever used to compute a rounded
// percentage; the raw value is not exposed.
function getFr24MonthlyCreditBudget(): number {
  const configured = Number(process.env.FR24_MONTHLY_CREDIT_BUDGET);
  return Number.isFinite(configured) && configured > 0 ? configured : 100000;
}

function roundToNearest5(pct: number): number {
  const clamped = Math.max(0, Math.min(100, pct));
  return Math.round(clamped / 5) * 5;
}

async function getLiveFeedUsage(now: number = Date.now()): Promise<LiveFeed> {
  if (!process.env.FR24_API_TOKEN) return { configured: false };

  if (liveFeedMemo && now - liveFeedMemo.at < LIVE_FEED_TTL_MS) return liveFeedMemo.value;

  try {
    const raw = await fetchFr24UsageRaw();
    const rows: Array<{ credits?: number }> = Array.isArray(raw?.data) ? raw.data : [];
    const totalCredits = rows.reduce((sum, row) => sum + (Number(row?.credits) || 0), 0);
    const budget = getFr24MonthlyCreditBudget();
    const pct = budget > 0 ? (totalCredits / budget) * 100 : 0;
    const value = { configured: true as const, usedPct: roundToNearest5(pct) };
    liveFeedMemo = { at: now, value };
    return value;
  } catch (e: any) {
    console.error('support-stats: FR24 usage fetch failed:', e?.message || e);
    // Prefer a slightly stale truth over a false "not configured".
    if (liveFeedMemo && now - liveFeedMemo.at < LIVE_FEED_STALE_MS) return liveFeedMemo.value;
    return { configured: false };
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  if (isRateLimited(req)) {
    // Never let a 429 into the shared CDN cache — it would be served to innocent visitors.
    res.setHeader('Cache-Control', 'no-store');
    return res.status(429).json({ error: 'Rate limited — try again shortly' });
  }

  // Public, unauthenticated, identical for everyone — safe to cache hard at the CDN.
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');

  // Both never throw; run them concurrently. hydrateAdbSpend returns the cross-instance ADB unit
  // total (this lambda's own per-instance counter is always 0 — see the header note).
  const [liveFeed, boardsUsed] = await Promise.all([getLiveFeedUsage(), hydrateAdbSpend()]);

  return res.status(200).json({
    boards: {
      used: boardsUsed,
      budget: getAdbDailyUnitBudget(),
    },
    liveFeed,
    monthlyCostNote: MONTHLY_COST_NOTE,
  });
}
