import { XMLParser } from 'fast-xml-parser';
import type { VercelRequest, VercelResponse } from './types.js';
import { createRateLimiter } from './_rate-limit.js';

const isRateLimited = createRateLimiter('faa', 60);

// --- Types ---

interface FAAProgram {
  type: 'ground_stop' | 'ground_delay' | 'departure_delay' | 'arrival_delay' | 'closure';
  reason: string;
  avgDelay?: number | null;
  minDelay?: number | null;
  maxDelay?: number | null;
  endTime?: string | null;
  trend?: string | null;
  probabilityOfExtension?: string | null;
  advisoryUrl?: string | null;
  center?: string | null;
}

interface FAARunwayConfig {
  arrivalRunways: string;
  departureRunways: string;
  arrivalRate: number;
}

interface FAAAirport {
  airportCode: string;
  programs: FAAProgram[];
  runwayConfig?: FAARunwayConfig | null;
  deicing: boolean;
  notam?: string | null;
  groundStop: boolean;
  groundDelay: boolean;
  departureDelay: boolean;
  arrivalDelay: boolean;
  closure: boolean;
  avgDelay: number | null;
  minDelay: number | null;
  maxDelay: number | null;
  // Legacy compat: flat delays array for existing client code
  delays: { reason: string; type: string; avgDelay?: number | null; minDelay?: number | null; maxDelay?: number | null; trend?: string | null; endTime?: string | null }[];
}

// --- Helpers ---

/** Parse numeric minutes from strings like "31 minutes", "5 hours and 45 minutes", or plain numbers */
export function parseDelayMinutes(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  if (typeof val === 'number') return Number.isFinite(val) ? Math.round(val) : null;
  const s = String(val).trim();
  if (!s) return null;
  // Try plain number first
  const plain = Number(s);
  if (Number.isFinite(plain)) return Math.round(plain);
  // Parse "X hours and Y minutes" or "X minutes"
  let total = 0;
  const hours = s.match(/(\d+)\s*hour/i);
  const mins = s.match(/(\d+)\s*min/i);
  if (hours) total += parseInt(hours[1], 10) * 60;
  if (mins) total += parseInt(mins[1], 10);
  return total > 0 ? total : null;
}

function safeUrl(url: unknown): string | null {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  return trimmed.startsWith('https://') ? trimmed : null;
}

function str(val: unknown): string {
  return val != null ? String(val).trim() : '';
}

// --- JSON path: /api/airport-events ---

function parseJsonResponse(data: any[]): FAAAirport[] {
  const results: FAAAirport[] = [];

  for (const airport of data) {
    const code = str(airport.airportId);
    if (!code) continue;

    const programs: FAAProgram[] = [];
    let worstAvg: number | null = null;
    let worstMin: number | null = null;
    let worstMax: number | null = null;

    // Ground Stop
    if (airport.groundStop) {
      const gs = airport.groundStop;
      programs.push({
        type: 'ground_stop',
        reason: str(gs.impactingCondition),
        endTime: str(gs.endTime) || null,
        probabilityOfExtension: str(gs.probabilityOfExtension) || null,
        advisoryUrl: safeUrl(gs.advisoryUrl),
        center: str(gs.center) || null,
      });
    }

    // Ground Delay
    if (airport.groundDelay) {
      const gd = airport.groundDelay;
      const avg = parseDelayMinutes(gd.avgDelay);
      const max = parseDelayMinutes(gd.maxDelay);
      if (avg !== null) worstAvg = Math.max(worstAvg ?? 0, avg);
      if (max !== null) worstMax = Math.max(worstMax ?? 0, max);
      programs.push({
        type: 'ground_delay',
        reason: str(gd.impactingCondition),
        avgDelay: avg,
        maxDelay: max,
        endTime: str(gd.endTime) || null,
        advisoryUrl: safeUrl(gd.advisoryUrl),
        center: str(gd.center) || null,
      });
    }

    // Arrival Delay
    if (airport.arrivalDelay) {
      const ad = airport.arrivalDelay;
      const min = parseDelayMinutes(ad.arrivalDeparture?.min);
      const max = parseDelayMinutes(ad.arrivalDeparture?.max);
      if (min !== null) worstMin = Math.max(worstMin ?? 0, min);
      if (max !== null) worstMax = Math.max(worstMax ?? 0, max);
      programs.push({
        type: 'arrival_delay',
        reason: str(ad.reason),
        minDelay: min,
        maxDelay: max,
        trend: str(ad.arrivalDeparture?.trend) || str(ad.trend) || null,
      });
    }

    // Departure Delay
    if (airport.departureDelay) {
      const dd = airport.departureDelay;
      const min = parseDelayMinutes(dd.arrivalDeparture?.min);
      const max = parseDelayMinutes(dd.arrivalDeparture?.max);
      const avg = parseDelayMinutes(dd.averageDelay);
      if (avg !== null) worstAvg = Math.max(worstAvg ?? 0, avg);
      if (min !== null) worstMin = Math.max(worstMin ?? 0, min);
      if (max !== null) worstMax = Math.max(worstMax ?? 0, max);
      programs.push({
        type: 'departure_delay',
        reason: str(dd.reason),
        avgDelay: avg,
        minDelay: min,
        maxDelay: max,
        trend: str(dd.arrivalDeparture?.trend) || str(dd.trend) || null,
      });
    }

    // Airport Closure
    if (airport.airportClosure) {
      const ac = airport.airportClosure;
      programs.push({
        type: 'closure',
        reason: str(ac.reason || ac.simpleText),
      });
    }

    // Runway Config
    let runwayConfig: FAARunwayConfig | null = null;
    if (airport.airportConfig && airport.airportConfig.arrivalRate > 0) {
      runwayConfig = {
        arrivalRunways: str(airport.airportConfig.arrivalRunwayConfig),
        departureRunways: str(airport.airportConfig.departureRunwayConfig),
        arrivalRate: Number(airport.airportConfig.arrivalRate) || 0,
      };
    }

    // De-icing
    const deicing = airport.deicing != null && airport.deicing !== false;

    // NOTAM (freeForm)
    const notam = airport.freeForm ? str(airport.freeForm.text || airport.freeForm.simpleText) || null : null;

    // Build legacy flat delays array for backward compat
    // Include per-program timing fields that existing UI code reads
    const delays = programs.map(p => ({
      reason: p.reason || p.type,
      type: p.type,
      avgDelay: p.avgDelay ?? null,
      minDelay: p.minDelay ?? null,
      maxDelay: p.maxDelay ?? null,
      trend: p.trend ?? null,
      endTime: p.endTime ?? null,
    }));

    results.push({
      airportCode: code,
      programs,
      runwayConfig,
      deicing,
      notam,
      groundStop: programs.some(p => p.type === 'ground_stop'),
      groundDelay: programs.some(p => p.type === 'ground_delay'),
      departureDelay: programs.some(p => p.type === 'departure_delay'),
      arrivalDelay: programs.some(p => p.type === 'arrival_delay'),
      closure: programs.some(p => p.type === 'closure'),
      avgDelay: worstAvg,
      minDelay: worstMin,
      maxDelay: worstMax,
      delays,
    });
  }

  return results;
}

function validateJsonResponse(data: unknown): data is any[] {
  if (!Array.isArray(data)) return false;
  if (data.length === 0) return true; // Empty is valid (no active events)
  // Spot-check first element has expected shape
  const first = data[0];
  return typeof first === 'object' && first !== null && 'airportId' in first;
}

// --- XML fallback path: /api/airport-status-information ---

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  allowBooleanAttributes: true,
  parseTagValue: true,
  trimValues: true,
});

function parseXmlFallback(xml: string): FAAAirport[] {
  let parsed: any;
  try {
    parsed = xmlParser.parse(xml);
  } catch (parseErr: any) {
    console.error('FAA XML parse error:', parseErr.message);
    return [];
  }

  // Collect all delays by airport, then group into FAAAirport objects
  const byAirport = new Map<string, FAAProgram[]>();

  function ensure(code: string): FAAProgram[] {
    if (!byAirport.has(code)) byAirport.set(code, []);
    return byAirport.get(code)!;
  }

  // Ground Delays
  for (const entry of toArray(
    parsed?.AIRPORT_STATUS_INFORMATION?.Delay_type?.Ground_Delay?.Delay ??
    parsed?.Delay_type?.Ground_Delay?.Delay
  )) {
    const arpt = str(entry?.ARPT);
    if (!arpt) continue;
    ensure(arpt).push({
      type: 'ground_delay',
      reason: str(entry?.Reason),
      avgDelay: parseDelayMinutes(entry?.Avg),
      maxDelay: parseDelayMinutes(entry?.Max),
    });
  }

  // Ground Stops
  for (const entry of toArray(
    parsed?.AIRPORT_STATUS_INFORMATION?.Delay_type?.Ground_Stop?.Delay ??
    parsed?.Delay_type?.Ground_Stop?.Delay
  )) {
    const arpt = str(entry?.ARPT);
    if (!arpt) continue;
    ensure(arpt).push({
      type: 'ground_stop',
      reason: str(entry?.Reason),
      endTime: str(entry?.End_Time || entry?.EndTime) || null,
    });
  }

  // Arrival/Departure Delays
  for (const entry of toArray(
    parsed?.AIRPORT_STATUS_INFORMATION?.Delay_type?.Arrival_Departure_Delay?.Delay ??
    parsed?.Delay_type?.Arrival_Departure_Delay?.Delay
  )) {
    const arpt = str(entry?.ARPT);
    const reason = str(entry?.Reason);
    if (!arpt) continue;
    const isDep = reason.toLowerCase().includes('depart');
    ensure(arpt).push({
      type: isDep ? 'departure_delay' : 'arrival_delay',
      reason,
      minDelay: parseDelayMinutes(entry?.Min),
      maxDelay: parseDelayMinutes(entry?.Max),
    });
  }

  // Airport Closures
  for (const entry of toArray(
    parsed?.AIRPORT_STATUS_INFORMATION?.Delay_type?.Airport_Closure?.Airport ??
    parsed?.Delay_type?.Airport_Closure?.Airport
  )) {
    const arpt = str(entry?.ARPT);
    if (!arpt) continue;
    ensure(arpt).push({
      type: 'closure',
      reason: str(entry?.Reason).split(' ').slice(0, 8).join(' '),
    });
  }

  // Build FAAAirport objects from grouped programs
  const results: FAAAirport[] = [];
  for (const [code, programs] of byAirport) {
    let worstAvg: number | null = null;
    let worstMin: number | null = null;
    let worstMax: number | null = null;
    for (const p of programs) {
      if (p.avgDelay != null) worstAvg = Math.max(worstAvg ?? 0, p.avgDelay);
      if (p.minDelay != null) worstMin = Math.max(worstMin ?? 0, p.minDelay);
      if (p.maxDelay != null) worstMax = Math.max(worstMax ?? 0, p.maxDelay);
    }

    results.push({
      airportCode: code,
      programs,
      runwayConfig: null, // Not available in XML
      deicing: false,     // Not available in XML
      notam: null,        // Not available in XML
      groundStop: programs.some(p => p.type === 'ground_stop'),
      groundDelay: programs.some(p => p.type === 'ground_delay'),
      departureDelay: programs.some(p => p.type === 'departure_delay'),
      arrivalDelay: programs.some(p => p.type === 'arrival_delay'),
      closure: programs.some(p => p.type === 'closure'),
      avgDelay: worstAvg,
      minDelay: worstMin,
      maxDelay: worstMax,
      delays: programs.map(p => ({
        reason: p.reason || p.type, type: p.type,
        avgDelay: p.avgDelay ?? null, minDelay: p.minDelay ?? null,
        maxDelay: p.maxDelay ?? null, endTime: p.endTime ?? null,
      })),
    });
  }

  return results;
}

// --- Handler ---

// Track consecutive JSON failures for exponential backoff
let jsonFailCount = 0;
let lastJsonFailTime = 0;

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
    // Try JSON primary with exponential backoff
    const now = Date.now();
    const backoffMs = jsonFailCount > 0
      ? Math.min(1000 * Math.pow(2, jsonFailCount - 1), 8000)
      : 0;
    const skipJson = jsonFailCount > 0 && (now - lastJsonFailTime) < backoffMs;

    let airports: FAAAirport[] | null = null;

    if (!skipJson) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        const upstream = await fetch('https://nasstatus.faa.gov/api/airport-events', {
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (upstream.ok) {
          const json = await upstream.json();
          if (validateJsonResponse(json)) {
            airports = parseJsonResponse(json);
            jsonFailCount = 0; // Reset on success
          } else {
            console.warn('FAA JSON schema validation failed, falling back to XML');
            jsonFailCount++;
            lastJsonFailTime = now;
          }
        } else {
          console.warn(`FAA JSON primary returned ${upstream.status}, falling back to XML`);
          jsonFailCount++;
          lastJsonFailTime = now;
        }
      } catch (jsonErr: any) {
        console.warn('FAA JSON primary failed:', jsonErr.message || jsonErr);
        jsonFailCount++;
        lastJsonFailTime = now;
      }
    }

    // XML fallback
    if (!airports) {
      console.warn(`FAA using XML fallback (JSON fail count: ${jsonFailCount})`);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const upstream = await fetch('https://nasstatus.faa.gov/api/airport-status-information', {
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!upstream.ok) return res.status(502).json({ error: 'Upstream service unavailable' });
      const xml = await upstream.text();
      if (!xml || !xml.trim()) {
        res.setHeader('Cache-Control', 's-maxage=60');
        return res.status(200).json([]);
      }
      airports = parseXmlFallback(xml);
    }

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    res.setHeader('Content-Type', 'application/json');
    return res.status(200).json(airports);
  } catch (e: any) {
    console.error('FAA API error:', e);
    if (e.name === 'AbortError') return res.status(504).json({ error: 'Upstream timeout' });
    return res.status(502).json({ error: 'Upstream service unavailable' });
  }
}

/** Normalize a value to an array (handles undefined, single object, or array) */
export function toArray<T>(val: T | T[] | undefined | null): T[] {
  if (!val) return [];
  return Array.isArray(val) ? val : [val];
}
