// Flight Times API — scrapes FlightAware for departure/arrival times
// Usage: /api/flight-times?flight=UA2221
// Returns scheduled, estimated, and actual gate/takeoff/landing times
//
// Source chain (Jul 3 2026 audit: FlightAware's bot-wall serves a parseable trackpollBootstrap
// with ZERO flights, which the old code treated as authoritative "No active flight found" —
// killing the endpoint for every flight):
//   1. FlightAware scrape (source: 'flightaware')
//   2. FR24 Official API flight-summary (source: 'fr24') — HARD-GATED on isOfficialFr24Enabled():
//      the kill switch is OFF in prod while credits are exhausted, so this tier must be skippable
//   3. Schedule snapshot layer (source: 'schedule-cache') — the boards already hold sched/est/real
//      times server-side; look the flight number up across the persisted hub board snapshots
// Only when ALL tiers fail does the endpoint return success:false with a reason.

import type { VercelRequest, VercelResponse } from './types.js';
import { icaoToIata } from '../src/lib/airport-metadata.js';
import { isOfficialFr24Enabled } from './_official-fr24.js';
import { loadScheduleSnapshot } from './_schedule-snapshots.js';
import { UNITED_HUBS } from './_hubs.js';
import { getStartOfHubDay } from '../src/lib/hubTz.js';

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

// FR24 Official API flight-summary tier. Returns a result payload or null — never writes the
// response itself, so the caller can continue down the fallback chain.
async function fetchFr24Summary(flight: string): Promise<any | null> {
  if (!process.env.FR24_API_TOKEN) return null;
  // Paid official API: honour the operator kill switch (credits exhausted → OFF in prod).
  if (!isOfficialFr24Enabled()) return null;
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
      return null;
    }
    const data = await resp.json();
    const flights = (data as any)?.data || [];
    // Find the most relevant flight — prefer in-air (has takeoff but no landing) over others
    const f = flights.find((fl: any) => fl.datetime_takeoff && !fl.datetime_landed && !fl.flight_ended)
      || flights.find((fl: any) => !fl.flight_ended)
      || flights[0];
    if (!f) {
      return null;
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
      source: 'fr24',
      cached: false,
    };
    if (f.orig_icao) result.origin.iata = icaoToIata(f.orig_icao);
    if (f.dest_icao_actual || f.dest_icao) result.destination.iata = icaoToIata(f.dest_icao_actual || f.dest_icao);
    return result;
  } catch (e) {
    return null;
  }
}

// Schedule snapshot tier: the hub boards already carry scheduled/estimated/real times server-side
// (api/schedule.ts caches + api/_schedule-snapshots.ts persistence). Look the flight number up
// across today's persisted hub boards — departures first (richer origin-side data), then
// arrivals. Reads only the durable snapshot layer (shared across lambdas); no upstream calls.
async function fetchScheduleCacheTimes(flight: string): Promise<any | null> {
  const flightNum = flight.replace('UAL', 'UA');
  try {
    for (const dir of ['departures', 'arrivals'] as const) {
      const snapshots = await Promise.all(
        UNITED_HUBS.map(async (hub) => {
          const ts = getStartOfHubDay(hub, 0);
          return loadScheduleSnapshot(`agg:${hub}:${dir}:${ts}`);
        })
      );
      for (const snapshot of snapshots) {
        const flights = snapshot?.data?.flights;
        if (!Array.isArray(flights)) continue;
        const match = flights.find(
          (f: any) => String(f?.identification?.number?.default || '').toUpperCase() === flightNum
        );
        if (!match) continue;

        const time = match.time || {};
        const generic = match.status?.generic?.status || {};
        return {
          success: true,
          flight: flightNum,
          origin: {
            iata: match.airport?.origin?.code?.iata || '',
            name: match.airport?.origin?.name || '',
            terminal: match.airport?.origin?.info?.terminal || '',
            gate: match.airport?.origin?.info?.gate || '',
            tz: '',
          },
          destination: {
            iata: match.airport?.destination?.code?.iata || '',
            name: match.airport?.destination?.name || '',
            terminal: match.airport?.destination?.info?.terminal || '',
            gate: match.airport?.destination?.info?.gate || '',
            tz: '',
          },
          departure: {
            gate: {
              scheduled: epochToISO(time.scheduled?.departure),
              estimated: epochToISO(time.estimated?.departure),
              actual: epochToISO(time.real?.departure),
            },
            takeoff: { scheduled: '', estimated: '', actual: '' },
          },
          arrival: {
            landing: { scheduled: '', estimated: '', actual: '' },
            gate: {
              scheduled: epochToISO(time.scheduled?.arrival),
              estimated: epochToISO(time.estimated?.arrival),
              actual: epochToISO(time.real?.arrival),
            },
          },
          aircraft: match.aircraft?.model?.text || match.aircraft?.model?.code || '',
          status: generic.text || '',
          cancelled: match.status?.generic?.type === 'canceled' || generic.text === 'canceled',
          diverted: !!generic.diverted,
          source: 'schedule-cache',
          cached: false,
        };
      }
    }
  } catch (e: any) {
    console.warn('flight-times schedule-cache lookup failed:', e?.message || e);
  }
  return null;
}

// Run the FR24 → schedule-cache fallback chain and write the response. `reason` records WHY the
// primary (FlightAware) tier failed, and is only surfaced when every tier fails.
async function respondViaFallbacks(res: VercelResponse, flight: string, cacheKey: string, reason: string) {
  const fr24 = await fetchFr24Summary(flight);
  if (fr24) {
    setCache(cacheKey, fr24);
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    return res.status(200).json(fr24);
  }
  const schedCache = await fetchScheduleCacheTimes(flight);
  if (schedCache) {
    setCache(cacheKey, schedCache);
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    return res.status(200).json(schedCache);
  }
  return res.status(404).json({
    success: false,
    error: 'No flight data available',
    reason: `${reason}; fr24 and schedule-cache fallbacks unavailable`,
  });
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

  if (isRateLimited(req)) {
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
      return await respondViaFallbacks(res, flight, cacheKey, `flightaware HTTP ${resp.status}`);
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
      // FlightAware blocked — fall down the chain
      return await respondViaFallbacks(res, flight, cacheKey, 'flightaware blocked (no bootstrap)');
    }

    let bootstrap: any;
    try {
      bootstrap = JSON.parse(match[1]);
    } catch (e) {
      return await respondViaFallbacks(res, flight, cacheKey, 'flightaware bootstrap unparseable');
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
      // A bootstrap that parses but contains ZERO flights is FlightAware's bot-wall, not a
      // definitive "this flight does not exist" — treat it as a source failure and fall through
      // to FR24 / the schedule snapshot layer instead of 404ing every flight. (Jul 3 2026 audit.)
      return await respondViaFallbacks(res, flight, cacheKey, 'flightaware bootstrap empty (bot-wall)');
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
    return await respondViaFallbacks(res, flight, cacheKey, 'flightaware fetch error');
  }
}
