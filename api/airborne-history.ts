// Airborne history — the Live tab's 24-hour "United flights airborne" graph.
// GET /api/airborne-history?hours=24   (1–168, default 24; garbage → 400)
//
// → 200 { samples: [{ t, airborne, express? }], hours, since, generatedAt, note? }
//   `samples` are oldest first, one per successful 5-minute read of the free live feed by the
//   watch-alerts cron (api/_airborne-samples.ts). A failed read has NO row, so a gap in `t` is a
//   gap in the data — the client draws it as a break, never as a zero. `since` is the window start.
//
// Public, unauthenticated, identical for every visitor → cached hard at the CDN (s-maxage=300 +
// SWR, the sampling cadence). It never 5xxes: unconfigured Supabase, sql/017 not applied yet, or a
// failing read all answer 200 with `samples: []` and a `note`, and that degraded body is cached for
// only 30 s so one blip cannot blank the graph at the edge for the full fifteen minutes.

import type { VercelRequest, VercelResponse } from './_types.js';
import { createRateLimiter } from './_rate-limit.js';
import { loadAirborneSamples, type HistorySample } from './_airborne-samples.js';
import { parseHistoryHours } from '../src/lib/airborne-history.js';

// Per instance, and only partial cover on serverless — the memo below is what bounds Supabase
// reads when a caller busts the CDN cache with junk query strings.
const isRateLimited = createRateLimiter('airborne-history', 30);

const MEMO_TTL_MS = 60_000;
const memo = new Map<number, { at: number; samples: HistorySample[] }>();

export const UNAVAILABLE_NOTE = 'History is unavailable right now.';

/** Test seam: the module-level memo would otherwise leak across cases. */
export function __resetAirborneHistoryForTests(): void {
  memo.clear();
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Same origin rule as /api/fr24-feed: the dashboard (and local dev) only.
  const origin = req.headers?.origin || '';
  if (origin && origin !== 'https://theblueboard.co' && !/^http:\/\/localhost(:\d+)?$/.test(String(origin))) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(403).json({ error: 'Forbidden' });
  }

  if (isRateLimited(req)) {
    // Never let a 429 into the shared CDN cache — it would be served to innocent visitors.
    res.setHeader('Cache-Control', 'no-store');
    return res.status(429).json({ error: 'Rate limited — try again shortly' });
  }

  const parsed = parseHistoryHours(req.query?.hours);
  if (!parsed.ok) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(400).json({ error: 'hours must be a number from 1 to 168' });
  }
  const { hours } = parsed;

  const now = Date.now();
  const sinceMs = now - hours * 3600_000;
  const base = { hours, since: new Date(sinceMs).toISOString(), generatedAt: new Date(now).toISOString() };

  const cached = memo.get(hours);
  if (cached && now - cached.at < MEMO_TTL_MS) {
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
    return res.status(200).json({ ...base, samples: cached.samples.filter((s) => Date.parse(s.t) >= sinceMs) });
  }

  const result = await loadAirborneSamples(sinceMs);
  if (!result.ok) {
    res.setHeader('Cache-Control', 'public, s-maxage=30');
    return res.status(200).json({ ...base, samples: [], note: UNAVAILABLE_NOTE });
  }

  memo.set(hours, { at: now, samples: result.samples });
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
  return res.status(200).json({ ...base, samples: result.samples });
}
