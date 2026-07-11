// Aircraft History API — Fetch recent flight segments for a tail number
// Usage: /api/aircraft-history?reg=N12345
//
// Uses FR24 Official API flight-summary endpoint with `regs` parameter
// Returns the last 5 flight segments for the aircraft within a 36-hour window

import type { VercelRequest, VercelResponse } from './types.js';
import { createRateLimiter } from './_rate-limit.js';
import { isOfficialFr24Enabled, isOfficialApiQuotaBlocked, recordOfficialApi402 } from './_official-fr24.js';
import { icaoToIata } from '../src/lib/airport-metadata.js';

const isRateLimited = createRateLimiter('aircraft-history', 15);

const FR24_BASE = 'https://fr24api.flightradar24.com';
const SUMMARY_PATH = '/api/flight-summary/light';
const API_VERSION = 'v1';

// 5-minute cache — historical data doesn't change fast
const cache = new Map<string, { data: any; ts: number }>();
const CACHE_TTL_MS = 5 * 60_000;

function getCached(key: string): any | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) { cache.delete(key); return null; }
  return entry.data;
}

function setCache(key: string, data: any): void {
  if (cache.size > 100) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { data, ts: Date.now() });
}

interface NormalizedSegment {
  flightNumber: string;
  origin: string;
  destination: string;
  status: string;
  departure: { scheduled: string; actual: string };
  arrival: { scheduled: string; actual: string; estimated: string };
  delayMin: number | null;
}

export function normalizeSegments(data: any): NormalizedSegment[] {
  const flights = data?.data || [];
  if (!flights.length) return [];

  return flights.map((f: any) => {
    // The live FR24 /api/flight-summary/light response is FLAT (orig_icao / dest_icao /
    // datetime_takeoff / datetime_scheduled_departure) — the same endpoint schedule.ts
    // (normalizeSummaryFlight) and flight-times.ts parse. Read those flat fields too or every
    // real segment is silently dropped by the origin/destination filter below.
    const depSched = f.departure?.scheduled || f.scheduled_departure || f.datetime_scheduled_departure || '';
    const depActual = f.departure?.actual || f.actual_departure || f.datetime_takeoff || '';
    const arrSched = f.arrival?.scheduled || f.scheduled_arrival || f.datetime_scheduled_arrival || '';
    const arrActual = f.arrival?.actual || f.actual_arrival || f.datetime_landed || '';
    const arrEst = f.arrival?.estimated || f.estimated_arrival || f.datetime_estimated_arrival || '';

    // Compute departure delay in minutes
    let delayMin: number | null = null;
    if (depSched && depActual) {
      const schedMs = new Date(depSched).getTime();
      const actualMs = new Date(depActual).getTime();
      if (!isNaN(schedMs) && !isNaN(actualMs)) {
        delayMin = Math.round((actualMs - schedMs) / 60000);
      }
    }

    // Determine status
    let status = f.status || 'unknown';
    if (typeof status === 'string') status = status.toLowerCase();

    return {
      flightNumber: f.flight_iata || f.flight_number?.iata || f.flight || f.callsign || '',
      origin: f.origin?.iata || f.airport?.origin?.code?.iata || f.orig_iata || icaoToIata(f.orig_icao || f.origin?.icao || ''),
      destination: f.destination?.iata || f.airport?.destination?.code?.iata || f.dest_iata || icaoToIata(f.dest_icao_actual || f.dest_icao || f.destination?.icao || ''),
      status,
      departure: { scheduled: depSched, actual: depActual },
      arrival: { scheduled: arrSched, actual: arrActual, estimated: arrEst },
      delayMin,
    };
  })
  .filter((s: NormalizedSegment) => s.origin && s.destination) // Drop segments with missing airports
  .sort((a: NormalizedSegment, b: NormalizedSegment) => {
    // Sort by departure time descending (most recent first)
    const tA = new Date(a.departure.actual || a.departure.scheduled || 0).getTime();
    const tB = new Date(b.departure.actual || b.departure.scheduled || 0).getTime();
    return tB - tA;
  })
  .slice(0, 5); // Return up to 5 segments
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const origin = req.headers?.origin || '';
  const allowed = origin === 'https://theblueboard.co' || /^http:\/\/localhost(:\d+)?$/.test(origin as string);
  res.setHeader('Access-Control-Allow-Origin', allowed ? origin : 'https://theblueboard.co');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  if (!process.env.FR24_API_TOKEN) {
    return res.status(500).json({ success: false, error: 'FR24 API not configured' });
  }

  if (!isOfficialFr24Enabled()) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(503).json({ success: false, error: 'Aircraft history temporarily unavailable' });
  }

  // F038: honour the shared cross-instance 402 quota block — this endpoint used to gate solely on
  // the kill switch and kept hitting the paid official API even after another lambda recorded a
  // credit-exhaustion 402. This is the endpoint's only official-API tier.
  if (await isOfficialApiQuotaBlocked()) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(503).json({ success: false, error: 'Aircraft history temporarily unavailable' });
  }

  const reg = ((req.query.reg as string) || '').trim().toUpperCase().replace(/-/g, '');
  if (!reg || !/^[A-Z0-9]{4,8}$/.test(reg)) {
    return res.status(400).json({ success: false, error: 'Invalid registration format' });
  }

  // Check cache
  const cacheKey = `history:${reg}`;
  const cached = getCached(cacheKey);
  if (cached) {
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.status(200).json({ ...cached, cached: true });
  }

  if (isRateLimited(req)) {
    return res.status(429).json({ success: false, error: 'Rate limited — try again shortly' });
  }

  try {
    const now = new Date();
    const from = new Date(now.getTime() - 36 * 60 * 60 * 1000); // 36h ago
    const to = new Date(now.getTime() + 6 * 60 * 60 * 1000); // 6h ahead

    const url = new URL(FR24_BASE + SUMMARY_PATH);
    url.searchParams.set('regs', reg);
    url.searchParams.set('flight_datetime_from', from.toISOString());
    url.searchParams.set('flight_datetime_to', to.toISOString());

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const resp = await fetch(url.toString(), {
      signal: controller.signal,
      headers: {
        'Authorization': `Bearer ${process.env.FR24_API_TOKEN}`,
        'Accept': 'application/json',
        'Accept-Version': API_VERSION,
        'User-Agent': 'TheBlueBoardDashboard/1.0 (https://theblueboard.co)',
      },
    });
    clearTimeout(timeout);

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      console.error(`FR24 aircraft history error for ${reg}: status=${resp.status} ${text.slice(0, 200)}`);
      if (resp.status === 402) recordOfficialApi402(text || 'aircraft-history 402');
      // Echo the upstream status so the failure is diagnosable from the response
      // alone (e.g. 402/403 = credit-blocked vs 5xx = outage). The frontend only
      // reads `success`, so this extra field is inert for consumers.
      //
      // A BILLING/auth/rate decline (402 credit-blocked, 403 forbidden, 429 throttled) is not a
      // gateway fault — answering 5xx for it violates HTTP semantics, is the only 5xx class this
      // service emits in prod, and would trip any 5xx uptime canary. Map those to 200 + success:false
      // (the frontend degrades identically); reserve 502 for a genuine upstream 5xx / outage.
      const billingDeclined = resp.status === 402 || resp.status === 403 || resp.status === 429;
      return res
        .status(billingDeclined ? 200 : 502)
        .json({ success: false, error: 'FR24 API error', upstreamStatus: resp.status });
    }

    const data = await resp.json();
    const segments = normalizeSegments(data);

    const result = { success: true, reg, segments };
    setCache(cacheKey, result);
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.status(200).json(result);
  } catch (e: any) {
    console.error('Aircraft history error:', e);
    if (e.name === 'AbortError') return res.status(504).json({ success: false, error: 'FR24 API timeout' });
    return res.status(502).json({ success: false, error: 'FR24 API unavailable' });
  }
}
