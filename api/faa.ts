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

// --- Cached hub-disruption lookup (internal server consumers) ---
// api/schedule.ts (board meta.hubDisruptionMinutes) and api/cron/warm-schedules.ts (IROPS-aware
// warm priority) need "does hub X currently have an active FAA program, and how bad is it?"
// WITHOUT adding an upstream FAA call per board request. This reuses the same nasstatus JSON
// endpoint the handler above fetches, behind a small in-memory TTL cache with in-flight dedupe.

// 10-minute TTL (positive AND negative): fresh enough for grace/warm decisions (FAA programs run
// for hours), cheap enough that a board-serving lambda fetches FAA at most once per 10 minutes.
// Deliberately generous so serve paths are effectively fetch-free after the first lookup.
const FAA_DISRUPTION_CACHE_TTL_MS = 10 * 60 * 1000;
const FAA_DISRUPTION_NEGATIVE_TTL_MS = 10 * 60 * 1000;
const FAA_DISRUPTION_FETCH_TIMEOUT_MS = 5000;

let disruptionCache: { byAirport: Map<string, number>; expires: number } | null = null;
let disruptionInFlight: Promise<Map<string, number>> | null = null;

/** Test-only: clear the disruption cache so tests control the fetch outcome. */
export function __resetFaaDisruptionCacheForTests(): void {
  disruptionCache = null;
  disruptionInFlight = null;
}

/**
 * Disruption magnitude for one FAA airport record, in minutes. 0 = no active program.
 * Pure — exported for tests.
 * - "Active" means a real traffic-management PROGRAM: ground stop, ground delay (GDP) or
 *   closure. Routine departure/arrival delay advisories ("departure delays 31-45 min") are
 *   normal-ops noise and deliberately do NOT count — they used to trigger IROPS warm priority
 *   and the extended inference grace, contradicting the documented GDP/GS/closure contract.
 * - Uses the worst published delay figure (avg preferred, then min) of the active programs.
 * - A ground stop or closure with no published figure still means nothing is moving: floor 60.
 * - Any other active program with no published figure gets a nominal 15 so it still reads as
 *   "disrupted" (warm priority) without wildly inflating the departed-inference grace.
 */
export function computeHubDisruptionMinutes(airport: FAAAirport | null | undefined): number {
  if (!airport) return 0;
  const active = airport.groundStop || airport.groundDelay || airport.closure;
  if (!active) return 0;
  const worst = Math.max(airport.avgDelay ?? 0, airport.minDelay ?? 0);
  if (worst > 0) return worst;
  if (airport.groundStop || airport.closure) return 60;
  return 15;
}

async function fetchDisruptionMap(): Promise<Map<string, number>> {
  const byAirport = new Map<string, number>();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FAA_DISRUPTION_FETCH_TIMEOUT_MS);
    let upstream: Response;
    try {
      upstream = await fetch('https://nasstatus.faa.gov/api/airport-events', { signal: controller.signal });
    } finally {
      // finally, not the post-await pattern used elsewhere in this file: a rejected fetch would
      // skip a trailing clearTimeout and leave the abort timer holding the controller up to 5s.
      clearTimeout(timeout);
    }
    if (!upstream.ok) throw new Error(`HTTP ${upstream.status}`);
    const json = await upstream.json();
    if (!validateJsonResponse(json)) throw new Error('schema validation failed');
    for (const airport of parseJsonResponse(json)) {
      const minutes = computeHubDisruptionMinutes(airport);
      if (minutes > 0) byAirport.set(airport.airportCode.toUpperCase(), minutes);
    }
    disruptionCache = { byAirport, expires: Date.now() + FAA_DISRUPTION_CACHE_TTL_MS };
  } catch (e: any) {
    console.warn('FAA disruption lookup failed (treating all hubs as undisrupted):', e?.message || e);
    // Negative-cache the empty map briefly so a dead FAA endpoint doesn't add a fetch per board.
    disruptionCache = { byAirport, expires: Date.now() + FAA_DISRUPTION_NEGATIVE_TTL_MS };
  }
  return byAirport;
}

/** Cached map of airportCode -> disruption minutes for every airport with an active program. */
export async function getDisruptedAirportsMap(): Promise<Map<string, number>> {
  if (disruptionCache && Date.now() < disruptionCache.expires) return disruptionCache.byAirport;
  if (disruptionInFlight) return disruptionInFlight;
  disruptionInFlight = fetchDisruptionMap().finally(() => { disruptionInFlight = null; });
  return disruptionInFlight;
}

/**
 * Synchronous, never-fetching peek at the cached disruption magnitude for one hub, in minutes.
 * Returns the last-known cached value — even one past its TTL (a slightly stale magnitude beats
 * a false 0 mid-GDP) — or 0 when nothing has been fetched yet. Serve paths use this instead of
 * awaiting getHubDisruptionMinutes so a cache-hit board response never blocks up to 5s on a cold
 * FAA fetch; pair with kickDisruptionRefresh() to warm a cold/expired cache in the background.
 */
export function peekHubDisruptionMinutes(hub: string): number {
  if (!disruptionCache) return 0;
  return disruptionCache.byAirport.get(String(hub || '').toUpperCase()) || 0;
}

/**
 * Start (or join) a background refresh of the disruption map when the cache is cold or expired.
 * Returns the in-flight promise — hand it to waitUntil so the lambda stays alive long enough —
 * or null when the cache is fresh and nothing needs doing. Never rejects: fetchDisruptionMap
 * catches internally and negative-caches failures.
 */
export function kickDisruptionRefresh(): Promise<Map<string, number>> | null {
  if (disruptionCache && Date.now() < disruptionCache.expires) return null;
  if (!disruptionInFlight) {
    disruptionInFlight = fetchDisruptionMap().finally(() => { disruptionInFlight = null; });
  }
  return disruptionInFlight;
}

/** Current FAA disruption magnitude for one hub, in minutes (0 = none / lookup unavailable). */
export async function getHubDisruptionMinutes(hub: string): Promise<number> {
  try {
    const map = await getDisruptedAirportsMap();
    return map.get(String(hub || '').toUpperCase()) || 0;
  } catch {
    return 0;
  }
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
