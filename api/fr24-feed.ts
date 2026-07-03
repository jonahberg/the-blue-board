import type { VercelRequest, VercelResponse } from './types.js';
import { createRateLimiter } from './_rate-limit.js';
import { CacheStore } from './_cache.js';

const isRateLimited = createRateLimiter('fr24-feed', 30);

const feedCache = new CacheStore('fr24-feed', { maxSize: 1, defaultTTL: 15_000 });
const feedFetching = new Map<string, Promise<any>>();

class EmptyFeedError extends Error {
  constructor() { super('Upstream returned empty feed'); this.name = 'EmptyFeedError'; }
}

// Aircraft entries are every key in the feed body that maps to a position array; the only
// non-aircraft keys FR24 sends are scalar metadata like full_count/version/stats.
export function countFeedAircraft(payload: any): number {
  if (!payload || typeof payload !== 'object') return 0;
  let count = 0;
  for (const value of Object.values(payload)) {
    if (Array.isArray(value)) count++;
  }
  return count;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const origin = req.headers?.origin || '';
  if (origin && origin !== 'https://theblueboard.co' && !/^http:\/\/localhost(:\d+)?$/.test(origin)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  if (isRateLimited(req)) {
    return res.status(429).json({ error: 'Rate limited — try again shortly' });
  }

  try {
    const airline = (req.query.airline as string) || 'UAL';
    // Validate airline: 2-4 letter ICAO code
    if (!/^[A-Z0-9]{2,4}$/i.test(airline)) {
      return res.status(400).json({ error: 'Invalid airline code' });
    }

    const normalizedAirline = airline.toUpperCase();
    const cacheKey = `feed:${normalizedAirline}`;

    // Return cached if fresh
    const hit = feedCache.get(cacheKey);
    if (hit) {
      res.setHeader('Cache-Control', 's-maxage=15, stale-while-revalidate=30');
      return res.status(200).json(hit);
    }

    // Dedup: if already fetching, wait for that
    const inFlight = feedFetching.get(cacheKey);
    if (inFlight) {
      const data = await inFlight;
      res.setHeader('Cache-Control', 's-maxage=15, stale-while-revalidate=30');
      return res.status(200).json(data);
    }

    const doFetch = async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      const upstream = await fetch(`https://data-cloud.flightradar24.com/zones/fcgi/feed.js?airline=${encodeURIComponent(normalizedAirline)}`, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'TheBlueBoardDashboard/1.0 (https://theblueboard.co)',
          'Accept': 'application/json'
        }
      });
      clearTimeout(timeout);
      if (!upstream.ok) throw new Error('Upstream service unavailable');
      const payload = await upstream.json();
      // The feed occasionally 200s with a meta-only body ({full_count, version} and zero
      // aircraft entries). Caching/serving that as success wipes the client's map and boards
      // ("NO DATA" cold-load bug, Jul 3 2026 audit). United always has aircraft airborne, so an
      // empty feed is an upstream glitch, never truth — surface it as an error so the client's
      // failure/retry path handles it and CDN/browser caches never store the empty body.
      if (countFeedAircraft(payload) === 0) throw new EmptyFeedError();
      return payload;
    };

    try {
      const inFlightRequest = doFetch();
      feedFetching.set(cacheKey, inFlightRequest);
      const data = await inFlightRequest;
      feedCache.set(cacheKey, data);
      res.setHeader('Cache-Control', 's-maxage=15, stale-while-revalidate=30');
      return res.status(200).json(data);
    } finally {
      feedFetching.delete(cacheKey);
    }
  } catch (e: any) {
    console.error('FR24 feed error:', e);
    if (e.name === 'AbortError') return res.status(504).json({ error: 'Upstream timeout' });
    if (e.name === 'EmptyFeedError') {
      res.setHeader('Cache-Control', 'no-store');
      return res.status(503).json({ error: 'Upstream returned empty feed' });
    }
    return res.status(502).json({ error: 'Upstream service unavailable' });
  }
}
