// Proxy endpoint for Starlink flight prediction
// Calls upstream unitedstarlinktracker.com/api/predict-flight

import type { VercelRequest, VercelResponse } from './types.js';
import { createRateLimiter } from './_rate-limit.js';

const UPSTREAM_URL = 'https://unitedstarlinktracker.com/api/predict-flight';
const isRateLimited = createRateLimiter('predict-flight', 20);

// Simple in-memory cache: predictions don't change frequently
const cache = new Map<string, { data: any; ts: number }>();
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

// Negative cache: when upstream connection fails, short-circuit subsequent
// requests for NEGATIVE_TTL ms so we don't burn function-seconds re-attempting
// a known-dead host. Cleared on the first successful upstream response.
const NEGATIVE_TTL = 60 * 1000; // 60 seconds
let upstreamUnhealthyUntil = 0;

// Test-only: reset module-level state. Imported by tests/predict-flight.test.js.
export function _resetCacheForTest(): void {
  cache.clear();
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

  const flightNumber = (req.query.flight_number as string || '').trim();
  if (!flightNumber) {
    return res.status(400).json({ error: 'Missing flight_number parameter' });
  }

  // Normalize: strip ICAO 'UAL' prefix first, then ensure 'UA'.
  // Without the strip-first order, 'UAL123' would pass startsWith('UA') and
  // be sent as-is, which the upstream rejects.
  const stripped = flightNumber.toUpperCase().replace(/^UAL/, '');
  const normalized = stripped.startsWith('UA') ? stripped : 'UA' + stripped;

  try {
    // Rate limit every request — including cache hits. An attacker sending 500+
    // unique flight-number strings would always miss cache and burn upstream
    // quota; limiting before cache lookup also bounds the per-IP invocation
    // cost on this endpoint.
    if (isRateLimited(req)) {
      return res.status(429).json({ error: 'Too many requests' });
    }

    const cached = cache.get(normalized);
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      res.setHeader('Cache-Control', 'public, s-maxage=1800, stale-while-revalidate=300');
      return res.status(200).json(cached.data);
    }

    // Short-circuit while upstream is known-unhealthy: don't re-attempt a dead
    // host, just fail fast. Surfaces as the same 502 the catch block produces.
    if (Date.now() < upstreamUnhealthyUntil) {
      return res.status(502).json({ error: 'Prediction service unavailable' });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);

    const resp = await fetch(`${UPSTREAM_URL}?flight_number=${encodeURIComponent(normalized)}`, {
      signal: controller.signal,
      headers: { 'User-Agent': 'BlueBoard-PredictFlight/1.0' },
    });
    clearTimeout(timeout);

    if (!resp.ok) {
      return res.status(resp.status).json({ error: `Upstream returned ${resp.status}` });
    }

    const data = await resp.json();

    upstreamUnhealthyUntil = 0;
    cache.set(normalized, { data, ts: Date.now() });

    // Evict old entries periodically
    if (cache.size > 500) {
      const now = Date.now();
      for (const [key, val] of cache) {
        if (now - val.ts > CACHE_TTL) cache.delete(key);
      }
    }

    res.setHeader('Cache-Control', 'public, s-maxage=1800, stale-while-revalidate=300');
    return res.status(200).json(data);
  } catch (err: any) {
    upstreamUnhealthyUntil = Date.now() + NEGATIVE_TTL;
    console.error('Predict-flight error:', err);
    return res.status(502).json({ error: 'Prediction service unavailable' });
  }
}
