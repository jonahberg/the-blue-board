// United Express fleet — every Express tail seen flying United in the last 45 days.
// GET /api/express-fleet
//
// → 200 { tails: [{ r, op, ft, m, lf, fs, ls }], staleDays, generatedAt, note? }
//   r = registration, op = operator ICAO code (SKW/RPA/GJS/UCA/ASH/AWI), ft = live-feed type
//   designator, m = schedule-board model code, lf = last United flight, fs/ls = first/last seen.
//   The dashboard joins this with the Starlink roster and the cabin table (src/lib/express-fleet.js).
//
// Public and identical for every visitor → cached hard at the CDN (the table changes twice an
// hour). It never 5xxes: unconfigured Supabase, a missing table or a failing read answer 200 with
// `tails: []` and a `note`, cached for only 60 s.

import type { VercelRequest, VercelResponse } from './_types.js';
import { createRateLimiter } from './_rate-limit.js';
import { loadExpressTails, type ExpressTailOut } from './_express-tails.js';
import { EXPRESS_STALE_DAYS } from '../src/lib/express-fleet.js';

const isRateLimited = createRateLimiter('express-fleet', 30);

const MEMO_TTL_MS = 5 * 60_000;
let memo: { at: number; tails: ExpressTailOut[] } | null = null;

export const UNAVAILABLE_NOTE = 'The United Express fleet is unavailable right now.';

export function __resetExpressFleetForTests(): void {
  memo = null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const origin = req.headers?.origin || '';
  if (origin && origin !== 'https://theblueboard.co' && !/^http:\/\/localhost(:\d+)?$/.test(String(origin))) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(403).json({ error: 'Forbidden' });
  }
  if (isRateLimited(req)) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(429).json({ error: 'Rate limited — try again shortly' });
  }

  const now = Date.now();
  const base = { staleDays: EXPRESS_STALE_DAYS, generatedAt: new Date(now).toISOString() };
  if (memo && now - memo.at < MEMO_TTL_MS) {
    res.setHeader('Cache-Control', 'public, s-maxage=1800, stale-while-revalidate=86400');
    return res.status(200).json({ ...base, tails: memo.tails });
  }
  const result = await loadExpressTails(now);
  if (!result.ok) {
    res.setHeader('Cache-Control', 'public, s-maxage=60');
    return res.status(200).json({ ...base, tails: [], note: UNAVAILABLE_NOTE });
  }
  memo = { at: now, tails: result.tails };
  res.setHeader('Cache-Control', 'public, s-maxage=1800, stale-while-revalidate=86400');
  return res.status(200).json({ ...base, tails: result.tails });
}
