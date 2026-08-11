// Proxy endpoint for Starlink flight status.
// Wraps unitedstarlinktracker.com/api/check-flight and adapts its three live
// response shapes (see adapt() below) into a probability-bearing payload so the
// existing dashboard render code keeps working.

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

interface UpstreamSegment {
  tail_number?: string;
  aircraft_type?: string;
  aircraft_model?: string;
  flight_number?: string;
  ua_flight_number?: string;
  departure_airport?: string;
  arrival_airport?: string;
  origin?: string;
  destination?: string;
  departure_time?: number;
  arrival_time?: number;
  departure_time_formatted?: string;
  arrival_time_formatted?: string;
  operated_by?: string | null;
  fleet_type?: string | null;
  hasStarlink?: boolean;
  confidence?: string;
  verified_wifi?: string;
  verified_at?: number | string;
}

interface UpstreamPrediction {
  probability?: number;
  confidence?: string;
  n_observations?: number;
}

interface UpstreamResponse {
  hasStarlink?: boolean;
  confidence?: string;
  method?: string;
  prediction?: UpstreamPrediction;
  flights?: UpstreamSegment[];
  fallback?: { segments?: UpstreamSegment[] };
  message?: string;
}

interface AdaptedResponse {
  hasStarlink: boolean;
  probability: number;
  confidence: 'verified' | 'likely' | 'predicted' | 'none';
  n_observations: number;
  flights: UpstreamSegment[];
}

// Matches both live spellings of the wifi value ("Starlink" 170 / "StrLnk" 343
// as of 2026-08-11) — an exact-match check would drop 67% of the fleet.
const STARLINK_WIFI_RE = /star\s*l|strlnk/i;

// Adapts the three live response shapes (verified via segments, verified via
// top-level, statistical prediction) into the probability payload the badge
// renders. Truth is derived from segment data and the prediction object first;
// top-level hasStarlink/confidence alone can no longer mint a badge — that
// default was the fabricated-70% path.
function adapt(u: UpstreamResponse): AdaptedResponse {
  const segments = [
    ...(Array.isArray(u.flights) ? u.flights : []),
    ...(Array.isArray(u.fallback?.segments) ? u.fallback!.segments! : []),
  ];

  // 1) Per-segment verification signals (only fallback-path segments carry them).
  const signal = segments.filter((s) => typeof s.hasStarlink === 'boolean' || s.verified_wifi != null);
  if (signal.length > 0) {
    const positive = signal.some(
      (s) => s.hasStarlink === true || STARLINK_WIFI_RE.test(String(s.verified_wifi ?? '')),
    );
    return {
      hasStarlink: positive,
      probability: positive ? 0.95 : 0,
      confidence: 'verified',
      n_observations: segments.length,
      flights: segments,
    };
  }

  // 2) Top-level verified (primary path: tail assigned, flights[] populated).
  if (u.confidence === 'verified') {
    const positive = u.hasStarlink === true;
    return {
      hasStarlink: positive,
      probability: positive ? 0.95 : 0,
      confidence: 'verified',
      n_observations: segments.length,
      flights: segments,
    };
  }

  // 3) Statistical prediction — only with real evidence. n_observations of 0 or
  //    a fleet_prior_* method is a fleet-wide average, not an answer about this
  //    flight; upstream returns those as confident-looking 200s.
  const p = u.prediction;
  if (p && typeof p.probability === 'number') {
    const n = Number(p.n_observations) || 0;
    const isPrior = n === 0 || /^fleet_prior/.test(String(u.method ?? ''));
    if (!isPrior) {
      return {
        hasStarlink: false,
        probability: p.probability,
        confidence: 'predicted',
        n_observations: n,
        flights: segments,
      };
    }
    return { hasStarlink: false, probability: 0, confidence: 'none', n_observations: 0, flights: segments };
  }

  // 4) Legacy documented shape: an explicit top-level 'likely'.
  if (u.hasStarlink === true && u.confidence === 'likely') {
    return {
      hasStarlink: true,
      probability: 0.7,
      confidence: 'likely',
      n_observations: segments.length,
      flights: segments,
    };
  }

  return { hasStarlink: false, probability: 0, confidence: 'none', n_observations: segments.length, flights: segments };
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
