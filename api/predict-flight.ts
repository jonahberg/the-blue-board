// Proxy endpoint for Starlink flight prediction
// Calls upstream unitedstarlinktracker.com/api/predict-flight

import type { VercelRequest, VercelResponse } from './types.js';
import { createRateLimiter } from './_rate-limit.js';

const UPSTREAM_URL = 'https://unitedstarlinktracker.com/api/predict-flight';
const isRateLimited = createRateLimiter('predict-flight', 20);

// Simple in-memory cache: predictions don't change frequently
const cache = new Map<string, { data: any; ts: number }>();
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

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

  // Normalize: ensure UA prefix
  const normalized = flightNumber.toUpperCase().startsWith('UA')
    ? flightNumber.toUpperCase()
    : 'UA' + flightNumber.replace(/^UAL/i, '');

  try {
    // Check cache — serve cached responses without rate limiting
    const cached = cache.get(normalized);
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      res.setHeader('Cache-Control', 'public, s-maxage=1800, stale-while-revalidate=300');
      return res.status(200).json(cached.data);
    }

    // Rate limit only upstream fetches, not cache hits
    if (isRateLimited(req)) {
      return res.status(429).json({ error: 'Too many requests' });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const resp = await fetch(`${UPSTREAM_URL}?flight_number=${encodeURIComponent(normalized)}`, {
      signal: controller.signal,
      headers: { 'User-Agent': 'BlueBoard-PredictFlight/1.0' },
    });
    clearTimeout(timeout);

    if (!resp.ok) {
      return res.status(resp.status).json({ error: `Upstream returned ${resp.status}` });
    }

    const data = await resp.json();

    // Cache it
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
    console.error('Predict-flight error:', err);
    return res.status(502).json({ error: 'Prediction service unavailable' });
  }
}
