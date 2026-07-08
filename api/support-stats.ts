// Public cost-transparency endpoint — "what it costs to keep this free".
// GET /api/support-stats  (no auth; safe for any visitor to read)
//
// Renders the About/Donate popover's support meter (public/js/support-meter.js). Everything
// returned here is deliberately SANITIZED and COARSE:
//   - boards.{used,budget}: today's AeroDataBox schedule-refresh unit counter, reused as-is from
//     api/_cost-state.ts (getAdbUnitsToday / getAdbDailyUnitBudget). AeroDataBox is already
//     publicly credited on the Sources page, so naming it is fine; no raw account/plan info.
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
import { getAdbUnitsToday, getAdbDailyUnitBudget } from './_cost-state.js';
import { fetchFr24UsageRaw } from './fr24-usage.js';

const MONTHLY_COST_NOTE = 'Data feeds, hosting, and AI explanations cost real money every month';

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

async function getLiveFeedUsage(): Promise<{ configured: false } | { configured: true; usedPct: number }> {
  if (!process.env.FR24_API_TOKEN) return { configured: false };

  try {
    const raw = await fetchFr24UsageRaw();
    const rows: Array<{ credits?: number }> = Array.isArray(raw?.data) ? raw.data : [];
    const totalCredits = rows.reduce((sum, row) => sum + (Number(row?.credits) || 0), 0);
    const budget = getFr24MonthlyCreditBudget();
    const pct = budget > 0 ? (totalCredits / budget) * 100 : 0;
    return { configured: true, usedPct: roundToNearest5(pct) };
  } catch (e: any) {
    console.error('support-stats: FR24 usage fetch failed:', e?.message || e);
    return { configured: false };
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // Public, unauthenticated, identical for everyone — safe to cache hard at the CDN.
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');

  const liveFeed = await getLiveFeedUsage();

  return res.status(200).json({
    boards: {
      used: getAdbUnitsToday(),
      budget: getAdbDailyUnitBudget(),
    },
    liveFeed,
    monthlyCostNote: MONTHLY_COST_NOTE,
  });
}
