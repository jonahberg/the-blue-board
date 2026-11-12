// Thin proxy for the upstream industry fleet-summary endpoint.
// Wraps unitedstarlinktracker.com/api/fleet-summary and serves its
// { airlines: [{ code, name, installed, total, percentage, families }], generatedAt }
// payload to the dashboard. It feeds the Starlink tab's industry coverage strip and, since
// Nov 12 2026, the Express share (the UA row's two-cabin regional families,
// `expressStarlinkScope()`): the Starlink tab's Express bar and the Fleet tab's "Express Fleet" chip.
//
// Cloned from api/check-flight.ts minus the flight-number normalization: this
// endpoint takes no parameters. GET-only, origin-locked to theblueboard.co /
// localhost, IP rate-limited, ~4s upstream abort, and a single shared 5-minute
// positive cache that matches upstream's max-age=300. On any failure it returns
// 502 — the client treats a non-200 as "no data": the strip is hidden, the Express bar falls back
// to the tracker's equipped count with no bar or percentage, and the "Express Fleet" chip is not shown.

import type { VercelRequest, VercelResponse } from './_types.js';
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
      // 502 as this file's header says, and the same negative cache as a connection failure: the
      // tracker answered Cloudflare 521 for a whole day (Nov 11 2026) and this passed the 521 through
      // and asked upstream again on every dashboard boot. The upstream code stays in the body.
      upstreamUnhealthyUntil = Date.now() + NEGATIVE_TTL;
      return res.status(502).json({ error: `Upstream returned ${resp.status}` });
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
