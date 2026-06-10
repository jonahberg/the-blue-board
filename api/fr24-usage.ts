// FR24 Official API — Credit Usage Monitoring Endpoint
// Usage: GET /api/fr24-usage  (Authorization: Bearer $CRON_SECRET)
// Returns current billing period credit consumption from FR24's usage API.
//
// Owner/ops debug endpoint: the response exposes paid FR24 plan billing/credit
// telemetry, so it is gated behind CRON_SECRET (timing-safe, fails closed when
// the secret is unset) — same credential the cron handlers use.

import type { VercelRequest, VercelResponse } from './types.js';
import { createRateLimiter } from './_rate-limit.js';
import { isAuthorizedCronRequest } from './_cron-auth.js';

const FR24_BASE = 'https://fr24api.flightradar24.com';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const isRateLimited = createRateLimiter('fr24-usage', 10);

let usageCache: { data: any; ts: number } | null = null;

function corsHeaders(req: VercelRequest): Record<string, string> {
  const origin = req.headers?.origin || '';
  const allowed = origin === 'https://theblueboard.co' || /^http:\/\/localhost(:\d+)?$/.test(origin as string);
  return {
    'Access-Control-Allow-Origin': allowed ? (origin as string) : 'https://theblueboard.co',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const cors = corsHeaders(req);
  for (const [k, v] of Object.entries(cors)) res.setHeader(k, v);

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // Authenticated responses must NEVER hit the shared CDN cache: an s-maxage'd 200 would be
  // served to unauthenticated requests for its TTL, silently bypassing the auth gate below.
  res.setHeader('Cache-Control', 'private, no-store');

  if (isRateLimited(req)) {
    return res.status(429).json({ error: 'Too many requests — try again later' });
  }

  if (!isAuthorizedCronRequest(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!process.env.FR24_API_TOKEN) {
    return res.status(200).json({ data: null, error: 'No FR24 API token configured' });
  }

  // Return cached if fresh
  if (usageCache && Date.now() - usageCache.ts < CACHE_TTL_MS) {
    return res.status(200).json({ ...usageCache.data, cached: true });
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const resp = await fetch(`${FR24_BASE}/api/usage`, {
      signal: controller.signal,
      headers: {
        'Authorization': `Bearer ${process.env.FR24_API_TOKEN}`,
        'Accept': 'application/json',
        'Accept-Version': 'v1',
        'User-Agent': 'TheBlueBoardDashboard/1.0 (https://theblueboard.co)',
      },
    });
    clearTimeout(timeout);

    if (!resp.ok) {
      console.error(`FR24 usage API returned ${resp.status}`);
      return res.status(502).json({ error: 'Upstream API error' });
    }

    const data = await resp.json();
    usageCache = { data, ts: Date.now() };

    return res.status(200).json({ ...data, cached: false });
  } catch (e: any) {
    console.error('FR24 usage fetch error:', e.message);
    return res.status(500).json({ error: 'Failed to fetch usage data' });
  }
}
