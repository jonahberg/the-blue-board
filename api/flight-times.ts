// Flight Times API — scrapes FlightAware for departure/arrival times
// Usage: /api/flight-times?flight=UA2221
// Returns scheduled, estimated, and actual gate/takeoff/landing times

import type { VercelRequest, VercelResponse } from './types.js';
import { icaoToIata } from '../src/lib/airport-metadata.js';

const CACHE_TTL_MS = 60_000; // 1 minute
const cache = new Map<string, { data: any; ts: number }>();

function getCached(key: string): any | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) { cache.delete(key); return null; }
  return entry.data;
}
function setCache(key: string, data: any): void {
  if (cache.size > 200) { const oldest = cache.keys().next().value; if (oldest !== undefined) cache.delete(oldest); }
  cache.set(key, { data, ts: Date.now() });
}

// Rate limiting: 30 req/min per IP
const rateLimitByIp = new Map<string, number[]>();

// Internal callers (the risk-monitor cron) include the Bearer cron secret to
// bypass the per-IP rate limit. We import isAuthorizedCronRequest lazily to
// avoid pulling crypto.timingSafeEqual into edge-cold-start path for normal
// public requests.
function hasCronAuth(req: VercelRequest): boolean {
  try {
    const auth = req.headers?.authorization;
    const value = Array.isArray(auth) ? auth[0] : auth;
    if (typeof value !== 'string' || !value.startsWith('Bearer ')) return false;
    // Reuse the cron-auth helper for timing-safe compare.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { isAuthorizedCronRequest } = require('./_cron-auth.js');
    return isAuthorizedCronRequest(req);
  } catch (_e) {
    return false;
  }
}
export function getClientIp(req: VercelRequest): string {
  const realIp = req.headers?.['x-real-ip'];
  if (realIp) return Array.isArray(realIp) ? realIp[0] : realIp;
  const xff = req.headers?.['x-forwarded-for'];
  const raw = Array.isArray(xff) ? xff[0] : (typeof xff === 'string' ? xff : '');
  return raw.split(',')[0]?.trim() || 'unknown';
}
let lastRateLimitCleanup = Date.now();
function isRateLimited(req: VercelRequest): boolean {
  const now = Date.now();
  const ip = getClientIp(req);
  if (!rateLimitByIp.has(ip)) rateLimitByIp.set(ip, []);
  const ipLog = rateLimitByIp.get(ip)!;
  while (ipLog.length && ipLog[0] < now - 60_000) ipLog.shift();
  if (ipLog.length >= 30) return true;
  ipLog.push(now);
  // Evict stale IPs every 5 minutes
  if (now - lastRateLimitCleanup > 300_000) {
    lastRateLimitCleanup = now;
    for (const [k, v] of rateLimitByIp) {
      while (v.length && v[0] < now - 60_000) v.shift();
      if (!v.length) rateLimitByIp.delete(k);
    }
  }
  return false;
}

function corsHeaders(req: VercelRequest): Record<string, string> {
  const origin = req.headers?.origin || '';
  const allowed = origin === 'https://theblueboard.co' || /^http:\/\/localhost(:\d+)?$/.test(origin as string);
  return {
    'Access-Control-Allow-Origin': allowed ? (origin as string) : 'https://theblueboard.co',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

export function normalizeFlightNumber(raw: string | string[]): string {
  const str = Array.isArray(raw) ? raw[0] : (raw || '');
  let q = String(str).trim().toUpperCase().replace(/\s+/g, '');
  if (q.startsWith('UA') && !q.startsWith('UAL')) q = 'UAL' + q.slice(2);
  if (/^\d{1,4}$/.test(q)) q = 'UAL' + q;
  return q;
}

export function epochToISO(epoch: number | undefined | null): string {
  if (!epoch) return '';
  return new Date(epoch * 1000).toISOString();
}

async function tryFR24Summary(req: VercelRequest, res: VercelResponse, flight: string, cacheKey: string) {
  if (!process.env.FR24_API_TOKEN) {
    return res.status(404).json({ success: false, error: 'No flight data available' });
  }
  try {
    // Convert UAL2221 -> UA2221 for FR24
    const fr24Flight = flight.replace('UAL', 'UA');
    const now = new Date();
    const from = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const to = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const resp = await fetch(
      `https://fr24api.flightradar24.com/api/flight-summary/light?flights=${encodeURIComponent(fr24Flight)}&flight_datetime_from=${from.toISOString()}&flight_datetime_to=${to.toISOString()}`,
      {
        signal: controller.signal,
        headers: {
          'Authorization': `Bearer ${process.env.FR24_API_TOKEN}`,
          'Accept': 'application/json',
          'Accept-Version': 'v1',
        },
      }
    );
    clearTimeout(timeout);
    if (!resp.ok) {
      return res.status(404).json({ success: false, error: 'No flight data available' });
    }
    const data = await resp.json();
    const flights = (data as any)?.data || [];
    // Find the most relevant flight — prefer in-air (has takeoff but no landing) over others
    const f = flights.find((fl: any) => fl.datetime_takeoff && !fl.datetime_landed && !fl.flight_ended)
      || flights.find((fl: any) => !fl.flight_ended)
      || flights[0];
    if (!f) {
      return res.status(404).json({ success: false, error: 'No flight data available' });
    }
    const result = {
      success: true,
      flight: fr24Flight,
      origin: { iata: '', name: '', terminal: '', gate: '', tz: '' },
      destination: { iata: '', name: '', terminal: '', gate: '', tz: '' },
      departure: {
        gate: { scheduled: '', estimated: '', actual: '' },
        takeoff: {
          scheduled: '',
          estimated: '',
          actual: f.datetime_takeoff || '',
        },
      },
      arrival: {
        landing: {
          scheduled: '',
          estimated: '',
          actual: f.datetime_landed || '',
        },
        gate: { scheduled: '', estimated: '', actual: '' },
      },
      aircraft: f.type || '',
      status: f.flight_ended ? 'landed' : 'en-route',
      cancelled: false,
      diverted: !!(f.dest_icao_actual && f.dest_icao && f.dest_icao !== f.dest_icao_actual),
      source: 'fr24-summary',
      cached: false,
    };
    if (f.orig_icao) result.origin.iata = icaoToIata(f.orig_icao);
    if (f.dest_icao_actual || f.dest_icao) result.destination.iata = icaoToIata(f.dest_icao_actual || f.dest_icao);
    setCache(cacheKey, result);
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    return res.status(200).json(result);
  } catch (e) {
    return res.status(404).json({ success: false, error: 'No flight data available' });
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const cors = corsHeaders(req);
  for (const [k, v] of Object.entries(cors)) res.setHeader(k, v);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const rawFlight = req.query.flight as string;
  if (!rawFlight) return res.status(400).json({ success: false, error: 'Missing flight parameter' });

  const flight = normalizeFlightNumber(rawFlight);
  if (!/^UAL\d{1,5}[A-Z]?$/i.test(flight)) {
    return res.status(400).json({ success: false, error: 'Invalid flight number' });
  }

  const cacheKey = `fa:${flight}`;
  const cached = getCached(cacheKey);
  if (cached) {
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    return res.status(200).json({ ...cached, cached: true });
  }

  // Internal cron callers bypass the per-IP limiter (proven via CRON_SECRET
  // Bearer header). Without this, /api/cron/risk-monitor would 429 for every
  // flight after the 30th in a single tick because the cron's outbound calls
  // share its single Vercel-region IP.
  if (!hasCronAuth(req) && isRateLimited(req)) {
    return res.status(429).json({ success: false, error: 'Rate limited' });
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const faFlight = flight.replace('UAL', 'UA');
    const resp = await fetch(`https://www.flightaware.com/live/flight/${encodeURIComponent(faFlight)}`, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'text/html',
      },
    });
    clearTimeout(timeout);

    if (!resp.ok) {
      return await tryFR24Summary(req, res, flight, cacheKey);
    }

    // Cap response body size to prevent a misbehaving or malicious FlightAware
    // response from burning memory/time. The bootstrap blob is typically
    // <80KB; 500KB is generous without letting a runaway page loop consume
    // the Lambda.
    const rawHtml = await resp.text();
    const html = rawHtml.length > 500_000 ? rawHtml.slice(0, 500_000) : rawHtml;

    // Extract trackpollBootstrap JSON. Bound the {...} capture to avoid
    // catastrophic regex backtracking on unexpected input shapes.
    const match = html.match(/trackpollBootstrap\s*=\s*(\{[\s\S]{1,200000}?\});\s*(?:var|<\/script)/);
    if (!match) {
      // FlightAware blocked — try FR24 summary as fallback
      return await tryFR24Summary(req, res, flight, cacheKey);
    }

    let bootstrap: any;
    try {
      bootstrap = JSON.parse(match[1]);
    } catch (e) {
      return await tryFR24Summary(req, res, flight, cacheKey);
    }

    // Find the most relevant flight — scan ALL activity log entries, prefer in-air
    const flights = bootstrap?.flights || {};
    const candidates: { flight: any; key: string; priority: number; depTime: number }[] = [];

    for (const [key, val] of Object.entries(flights) as [string, any][]) {
      const actLog = val?.activityLog?.flights || [];
      for (const f of actLog) {
        const hasActualDep = !!(f.takeoffTimes?.actual || f.gateDepartureTimes?.actual);
        const hasLanded = !!f.landingTimes?.actual;
        const depTime = f.gateDepartureTimes?.scheduled || f.gateDepartureTimes?.estimated || f.gateDepartureTimes?.actual || f.takeoffTimes?.scheduled || 0;
        // Priority: in-air (departed but not landed) > landed > scheduled
        const priority = (hasActualDep && !hasLanded) ? 2 : hasActualDep ? 1 : 0;
        candidates.push({ flight: f, key, priority, depTime });
      }
    }
    // Sort by priority desc, then by most recent departure
    candidates.sort((a, b) => b.priority - a.priority || b.depTime - a.depTime);
    const bestFlight = candidates[0]?.flight || null;

    if (!bestFlight) {
      return res.status(404).json({ success: false, error: 'No active flight found' });
    }

    const f = bestFlight;
    const result = {
      success: true,
      flight: flight.replace('UAL', 'UA'),
      origin: {
        iata: f.origin?.iata || '',
        name: f.origin?.friendlyName || '',
        terminal: f.origin?.terminal || '',
        gate: f.origin?.gate || '',
        tz: (f.origin?.TZ || '').replace(/^:/, ''),
      },
      destination: {
        iata: f.destination?.iata || '',
        name: f.destination?.friendlyName || '',
        terminal: f.destination?.terminal || '',
        gate: f.destination?.gate || '',
        tz: (f.destination?.TZ || '').replace(/^:/, ''),
      },
      departure: {
        gate: {
          scheduled: epochToISO(f.gateDepartureTimes?.scheduled),
          estimated: epochToISO(f.gateDepartureTimes?.estimated),
          actual: epochToISO(f.gateDepartureTimes?.actual),
        },
        takeoff: {
          scheduled: epochToISO(f.takeoffTimes?.scheduled),
          estimated: epochToISO(f.takeoffTimes?.estimated),
          actual: epochToISO(f.takeoffTimes?.actual),
        },
      },
      arrival: {
        landing: {
          scheduled: epochToISO(f.landingTimes?.scheduled),
          estimated: epochToISO(f.landingTimes?.estimated),
          actual: epochToISO(f.landingTimes?.actual),
        },
        gate: {
          scheduled: epochToISO(f.gateArrivalTimes?.scheduled),
          estimated: epochToISO(f.gateArrivalTimes?.estimated),
          actual: epochToISO(f.gateArrivalTimes?.actual),
        },
      },
      aircraft: f.aircraftTypeFriendly || '',
      status: f.flightStatus || '',
      cancelled: !!f.cancelled,
      diverted: !!f.diverted,
      source: 'flightaware',
      cached: false,
    };

    setCache(cacheKey, result);
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    return res.status(200).json(result);
  } catch (e) {
    console.error('FlightAware scrape error:', e);
    return await tryFR24Summary(req, res, flight, cacheKey);
  }
}
