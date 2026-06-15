// Thin proxy for the upstream industry fleet-summary endpoint.
// Wraps unitedstarlinktracker.com/api/fleet-summary and serves its
// { airlines: [{ code, name, installed, total, percentage }], generatedAt }
// payload to the dashboard's "Starlink coverage by airline" strip.
//
// Cloned from api/check-flight.ts minus the flight-number normalization: this
// endpoint takes no parameters. GET-only, origin-locked to theblueboard.co /
// localhost, IP rate-limited, ~4s upstream abort, and a single shared 5-minute
// positive cache that matches upstream's max-age=300. On any failure it returns
// 502 — the client treats a non-200 as "no data" and simply hides the strip.

import type { VercelRequest, VercelResponse } from './types.js';
import { createRateLimiter } from './_rate-limit.js';

const UPSTREAM_URL = 'https://unitedstarlinktracker.com/api/fleet-summary';
const isRateLimited = createRateLimiter('fleet-summary', 20);

// Single-key positive cache: the upstream payload is identical for every caller,
// so one shared 5-minute entry (matching upstream's max-age=300) is enough.
let cache: { data: unknown; ts: number } | null = null;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Negative cache: short-circuit subsequent requests for NEGATIVE_TTL ms after an
// upstream connection failure so we don't burn function-seconds on a dead host.
const NEGATIVE_TTL = 60 * 1000;
let upstreamUnhealthyUntil = 0;

// Test-only: reset module-level state. Imported by tests/fleet-summary.test.js.
export function _resetCacheForTest(): void {
  cache = null;
  upstreamUnhealthyUntil = 0;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const origin = req.headers.origin as string | undefined;
  if (origin && origin !== 'https://theblueboard.co' && !/^http:\/\/localhost(:\d+)?$/.test(origin)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  res.setHeader('Access-Control-Allow-Origin', origin || 'https://theblueboard.co');

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    if (isRateLimited(req)) {
      return res.status(429).json({ error: 'Too many requests' });
    }

    if (cache && Date.now() - cache.ts < CACHE_TTL) {
      res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=60');
      return res.status(200).json(cache.data);
    }

    if (Date.now() < upstreamUnhealthyUntil) {
      return res.status(502).json({ error: 'Fleet summary service unavailable' });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);

    const resp = await fetch(UPSTREAM_URL, {
      signal: controller.signal,
      headers: { 'User-Agent': 'BlueBoard-FleetSummary/1.0' },
    });
    clearTimeout(timeout);

    if (!resp.ok) {
      return res.status(resp.status).json({ error: `Upstream returned ${resp.status}` });
    }

    const data = await resp.json();

    upstreamUnhealthyUntil = 0;
    cache = { data, ts: Date.now() };

    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=60');
    return res.status(200).json(data);
  } catch (err: any) {
    upstreamUnhealthyUntil = Date.now() + NEGATIVE_TTL;
    console.error('Fleet-summary error:', err);
    return res.status(502).json({ error: 'Fleet summary service unavailable' });
  }
}
