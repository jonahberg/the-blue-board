// Proxy endpoint for Starlink flight status (documented upstream contract).
// Wraps unitedstarlinktracker.com/api/check-flight and adapts the
// {hasStarlink, confidence, flights} shape into a probability-bearing payload
// so the existing dashboard render code keeps working.

import type { VercelRequest, VercelResponse } from './types.js';
import { createRateLimiter } from './_rate-limit.js';

const UPSTREAM_URL = 'https://unitedstarlinktracker.com/api/check-flight';
const isRateLimited = createRateLimiter('check-flight', 20);

const cache = new Map<string, { data: AdaptedResponse; ts: number }>();
const CACHE_TTL = 30 * 60 * 1000;

const NEGATIVE_TTL = 60 * 1000;
let upstreamUnhealthyUntil = 0;

export function _resetCacheForTest(): void {
  cache.clear();
  upstreamUnhealthyUntil = 0;
}

interface UpstreamFlight {
  tail_number?: string;
  aircraft_type?: string;
  flight_number?: string;
  ua_flight_number?: string;
  departure_airport?: string;
  arrival_airport?: string;
  departure_time?: number;
  arrival_time?: number;
  departure_time_formatted?: string;
  arrival_time_formatted?: string;
  operated_by?: string | null;
  fleet_type?: string | null;
}

interface UpstreamResponse {
  hasStarlink: boolean;
  confidence?: 'verified' | 'likely';
  flights?: UpstreamFlight[];
  message?: string;
}

interface AdaptedResponse {
  hasStarlink: boolean;
  probability: number;
  confidence: 'verified' | 'likely' | 'none';
  n_observations: number;
  flights: UpstreamFlight[];
}

// Maps upstream's discrete {hasStarlink, confidence} into a 0..1 score the
// existing badge UI can render. Verified matches read as 95%, likely as 70%,
// no-match as 0% (the dashboard hides the badge below 5%).
function adapt(u: UpstreamResponse): AdaptedResponse {
  const hasStarlink = !!u.hasStarlink;
  const confidence = u.confidence ?? (hasStarlink ? 'likely' : 'none');
  const probability = !hasStarlink ? 0 : confidence === 'verified' ? 0.95 : 0.7;
  return {
    hasStarlink,
    probability,
    confidence,
    n_observations: u.flights?.length ?? 0,
    flights: u.flights ?? [],
  };
}

function isValidDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
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
  const date = (req.query.date as string || '').trim();
  if (!date || !isValidDate(date)) {
    return res.status(400).json({ error: 'Missing or invalid date parameter (YYYY-MM-DD)' });
  }

  // Strip ICAO 'UAL' prefix first, then ensure 'UA'. Without the strip-first
  // order, 'UAL123' would pass the startsWith('UA') check unchanged.
  const stripped = flightNumber.toUpperCase().replace(/^UAL/, '');
  const normalized = stripped.startsWith('UA') ? stripped : 'UA' + stripped;
  const cacheKey = `${normalized}|${date}`;

  try {
    if (isRateLimited(req)) {
      return res.status(429).json({ error: 'Too many requests' });
    }

    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      res.setHeader('Cache-Control', 'public, s-maxage=1800, stale-while-revalidate=300');
      return res.status(200).json(cached.data);
    }

    if (Date.now() < upstreamUnhealthyUntil) {
      return res.status(502).json({ error: 'Check-flight service unavailable' });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);

    const url = `${UPSTREAM_URL}?flight_number=${encodeURIComponent(normalized)}&date=${encodeURIComponent(date)}`;
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'BlueBoard-CheckFlight/1.0' },
    });
    clearTimeout(timeout);

    if (!resp.ok) {
      return res.status(resp.status).json({ error: `Upstream returned ${resp.status}` });
    }

    const upstream = await resp.json() as UpstreamResponse;
    const adapted = adapt(upstream);

    upstreamUnhealthyUntil = 0;
    cache.set(cacheKey, { data: adapted, ts: Date.now() });

    if (cache.size > 500) {
      const now = Date.now();
      for (const [k, v] of cache) {
        if (now - v.ts > CACHE_TTL) cache.delete(k);
      }
    }

    res.setHeader('Cache-Control', 'public, s-maxage=1800, stale-while-revalidate=300');
    return res.status(200).json(adapted);
  } catch (err: any) {
    upstreamUnhealthyUntil = Date.now() + NEGATIVE_TTL;
    console.error('Check-flight error:', err);
    return res.status(502).json({ error: 'Check-flight service unavailable' });
  }
}
