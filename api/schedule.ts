import type { VercelRequest, VercelResponse } from './types.js';
import { createRateLimiter } from './_rate-limit.js';
import { loadScheduleSnapshot, saveScheduleSnapshot } from './_schedule-snapshots.js';
import { hydrateQuotaBlock, getMirroredQuotaBlockedUntil, persistQuotaBlock, resetMirroredQuotaBlock } from './_cost-state.js';
import { fetchViaAeroDataBox } from './_schedule-aerodatabox.js';
import {
  FR24_SCHEDULE_HEADERS,
  fetchFr24ScheduleViaScraperTransport,
  hasConfiguredFr24ScraperTransport,
} from './_fr24-scraper-transport.js';
import { getStartOfDayForHub } from './irops.js';
import { waitUntil } from '@vercel/functions';
import { icaoToIata, isInternationalRoute } from '../src/lib/airport-metadata.js';
import { getStartOfHubDay } from '../src/lib/hubTz.js';

const isRateLimited = createRateLimiter('schedule', 30);

type ScheduleFetchOptions = {
  allowTargetedOfficialRescue?: boolean;
  disableOfficialSource?: boolean;
  disableProviderFallback?: boolean;
  disableScraperFallback?: boolean;
};

// In-memory LRU cache for FR24 schedule data
const cache = new Map<string, { data: any; expires: number; time: number }>();
const MAX_CACHE_SIZE = 400;

// Separate cache for last-known-complete aggregates (fallback when fresh fetch is partial)
const lastCompleteCache = new Map<string, { data: any; time: number }>();
// Broader fallback cache keyed by hub+direction (survives day-key misses)
const lastCompleteByHubDir = new Map<string, { data: any; time: number; sourceKey: string }>();
const MAX_COMPLETE_CACHE_SIZE = 128;
const COMPLETE_CACHE_MAX_AGE = 21600000; // 6 hours
const BATCH_DELAY = 500; // 500ms pause between parallel batches
const STALE_GRACE = 120000; // serve stale data for up to 2min past expiry
const TARGETED_OFFICIAL_RESCUE_HUBS = new Set(['ORD', 'DEN', 'IAH', 'EWR', 'SFO', 'IAD', 'LAX', 'NRT', 'GUM']);

// Busy hubs get more time to fetch all pages (capped at 55s for Vercel's 60s maxDuration)
const HUB_TIMEOUT_MS: Record<string, number> = { ORD: 55000, EWR: 55000, IAH: 55000, SFO: 55000, LAX: 55000, DEN: 55000, IAD: 55000, NRT: 55000, GUM: 55000 };
const MAX_FR24_RETRY_AFTER_MS = 3000;
const MAX_RATE_LIMITED_PAGES_PER_SCRAPE = 6;
const MAX_CONSECUTIVE_RATE_LIMIT_BATCHES = 2;
const MIN_REMAINING_MS_TO_KEEP_PAGING = 8000;
const MIN_REMAINING_MS_FOR_OFFICIAL_RESCUE = 6000;

// Known United Airlines terminal assignments at each hub (used when API doesn't provide terminal data)
const UNITED_HUB_TERMINALS: Record<string, { domestic: string; international: string }> = {
  ORD: { domestic: '1', international: '1' },       // Terminal 1 (Concourses B & C); Express uses T2
  DEN: { domestic: 'B', international: 'B' },       // Concourse B
  EWR: { domestic: 'C', international: 'C' },       // Terminal C (primary); some flights use Terminal A
  IAH: { domestic: 'C', international: 'E' },       // Terminal C (domestic), Terminal E (international)
  SFO: { domestic: '3', international: 'G' },       // Terminal 3 (domestic), International Terminal G
  LAX: { domestic: '7', international: '7' },       // Terminals 7 & 8
  IAD: { domestic: 'C', international: 'D' },       // Concourse C (domestic), Concourse D (international)
  NRT: { domestic: '1', international: '1' },       // Terminal 1
  GUM: { domestic: '1', international: '1' },       // Single terminal
};

function getHubTerminal(iata: string, isIntl: boolean): string {
  const hub = UNITED_HUB_TERMINALS[iata.toUpperCase()];
  if (!hub) return '';
  return isIntl ? hub.international : hub.domestic;
}

// Global concurrency limiter for FR24 outbound requests
const MAX_CONCURRENT_FR24 = 6;
let activeFR24 = 0;
const fr24Queue: (() => void)[] = [];

function acquireFR24Slot(): Promise<void> {
  if (activeFR24 < MAX_CONCURRENT_FR24) {
    activeFR24++;
    return Promise.resolve();
  }
  return new Promise(resolve => fr24Queue.push(resolve));
}

function releaseFR24Slot(): void {
  activeFR24--;
  if (fr24Queue.length > 0) {
    activeFR24++;
    fr24Queue.shift()!();
  }
}

function cacheGet(key: string) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expires) return null;
  return entry;
}

function cacheGetStale(key: string) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expires + STALE_GRACE) {
    cache.delete(key);
    return null;
  }
  return entry;
}

function saveComplete(key: string, data: any, savedAtMs = Date.now()): void {
  if (data.partial) return;
  // Never record an empty board (total===0) as authoritative "complete" truth. A transient
  // empty 200 (FR24 throttle interstitial, clean-empty scrape, or the official-priority empty
  // path) would otherwise be pinned for COMPLETE_CACHE_MAX_AGE, re-served as the "good" degraded
  // fallback, and reloaded into memory on every cold start via getPersistentFallback — a
  // self-sustaining 0-flight board. United hubs are never legitimately empty same-day, so
  // recomputing an empty board is far cheaper than serving a poisoned one.
  // (Audit P0: empty-complete-poisons-fallback)
  if (Number(data?.total || 0) === 0) return;
  if (lastCompleteCache.size >= MAX_COMPLETE_CACHE_SIZE) {
    lastCompleteCache.delete(lastCompleteCache.keys().next().value!);
  }
  lastCompleteCache.set(key, { data, time: savedAtMs });

  // Also populate hub+direction+day level cache for broader fallback
  const aggMatch = /^agg:([A-Z]{3,4}):(departures|arrivals):(\d+)$/i.exec(key);
  if (aggMatch) {
    const hdKey = `${aggMatch[1].toUpperCase()}:${aggMatch[2]}:${aggMatch[3]}`;
    if (lastCompleteByHubDir.size >= MAX_COMPLETE_CACHE_SIZE) {
      lastCompleteByHubDir.delete(lastCompleteByHubDir.keys().next().value!);
    }
    lastCompleteByHubDir.set(hdKey, { data, time: savedAtMs, sourceKey: key });
  }
}

function getLastComplete(key: string) {
  const entry = lastCompleteCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.time > COMPLETE_CACHE_MAX_AGE) {
    lastCompleteCache.delete(key);
    return null;
  }
  return entry;
}

function getLastCompleteByHubDir(hub: string, dir: string, ts: number) {
  const hdKey = `${hub.toUpperCase()}:${dir}:${ts}`;
  const entry = lastCompleteByHubDir.get(hdKey);
  if (!entry) return null;
  if (Date.now() - entry.time > COMPLETE_CACHE_MAX_AGE) {
    lastCompleteByHubDir.delete(hdKey);
    return null;
  }
  return entry;
}

async function getPersistentFallback(key: string) {
  const snapshot = await loadScheduleSnapshot(key);
  if (!snapshot) return null;
  if (!snapshot.data?.partial) {
    saveComplete(key, snapshot.data, snapshot.refreshedAt);
  }
  return {
    data: snapshot.data,
    time: snapshot.refreshedAt,
    fallbackScope: snapshot.data?.partial ? 'persistent_partial' as const : 'persistent' as const,
  };
}

function buildDegradedResponse(
  entry: { data: any; time: number },
  fallbackScope: 'exact' | 'hub_dir' | 'persistent' | 'persistent_partial'
) {
  const dataAge = Math.max(0, Math.round((Date.now() - entry.time) / 1000));
  const isBestKnownPartial = entry.data?.partial === true;
  return {
    ...entry.data,
    cached: true,
    stale: true,
    degraded: true,
    meta: {
      ...(entry.data?.meta || {}),
      dataAge,
      fallbackScope,
      bestKnownPartial: isBestKnownPartial,
    }
  };
}

function shouldAttemptTargetedOfficialRescue(hub: string, ts: number, options?: ScheduleFetchOptions): boolean {
  if (!options?.allowTargetedOfficialRescue || !process.env.FR24_API_TOKEN) return false;
  const fallbackSetting = String(process.env.SCHEDULE_OFFICIAL_FALLBACK_ENABLED || 'true').toLowerCase();
  if (['0', 'false', 'off', 'no'].includes(fallbackSetting)) {
    return false;
  }
  const hubUpper = hub.toUpperCase();
  if (!TARGETED_OFFICIAL_RESCUE_HUBS.has(hubUpper)) return false;

  // Accept BOTH the IROPS display value (getStartOfDayForHub rolls back to yesterday before 6 AM
  // hub-local) AND the canonical hub-local start-of-today the dashboard actually sends
  // (getStartOfHubDay(hub, 0)). Before 6 AM the two differ, which previously disabled this
  // same-day official rescue for the genuinely-current board — and because the 9 hubs span 6
  // timezones, some hub is always in that dead-zone. Widening only: never suppresses a rescue.
  // (Audit P1: client/server start-of-day divergence.)
  const startOfToday = getStartOfDayForHub(hubUpper);
  return ts === startOfToday || ts === getStartOfHubDay(hubUpper, 0);
}

function cacheSet(key: string, data: any, ttlMs: number): void {
  if (cache.size >= MAX_CACHE_SIZE) {
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) cache.delete(firstKey);
  }
  cache.set(key, { data, expires: Date.now() + ttlMs, time: Date.now() });
}

function setAggregateCacheHeader(res: VercelResponse, data: any, cdnMaxAge: number, swr: number): void {
  const isPartial = data?.partial === true;
  const total = Number(data?.total || 0);
  // A degraded-but-NON-EMPTY board is still useful to show; re-validating it every 30s at the CDN
  // just hammers FR24 and burns paid fallback credits during a block. Serve it for 120s and only
  // fall back to the aggressive 30s window when the partial board is also EMPTY (total===0), where
  // fast recovery matters more than cost. (Audit P7: partial-response-short-cdn-ttl-rescrape-loop.)
  const maxAge = isPartial ? (total > 0 ? 120 : 30) : cdnMaxAge;
  const stale = isPartial ? (total > 0 ? 120 : 60) : swr;
  res.setHeader('Cache-Control', `s-maxage=${maxAge}, stale-while-revalidate=${stale}`);
}

function getSingleQueryValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] || '' : value || '';
}

function shouldDisableOfficialFallback(req: VercelRequest): boolean {
  const queryValue = getSingleQueryValue((req.query as Record<string, string | string[] | undefined>)?.officialFallback).toLowerCase();
  const headerValue = getSingleQueryValue(req.headers?.['x-blueboard-official-fallback'] as string | string[] | undefined).toLowerCase();
  return ['0', 'false', 'off', 'no'].includes(queryValue) || ['0', 'false', 'off', 'no'].includes(headerValue);
}

function shouldDisableProviderFallback(req: VercelRequest): boolean {
  const queryValue = getSingleQueryValue((req.query as Record<string, string | string[] | undefined>)?.providerFallback).toLowerCase();
  const headerValue = getSingleQueryValue(req.headers?.['x-blueboard-provider-fallback'] as string | string[] | undefined).toLowerCase();
  return ['0', 'false', 'off', 'no'].includes(queryValue) || ['0', 'false', 'off', 'no'].includes(headerValue);
}

function shouldDisableScraperFallback(req: VercelRequest): boolean {
  const queryValue = getSingleQueryValue((req.query as Record<string, string | string[] | undefined>)?.scraperFallback).toLowerCase();
  const headerValue = getSingleQueryValue(req.headers?.['x-blueboard-scraper-fallback'] as string | string[] | undefined).toLowerCase();
  return ['0', 'false', 'off', 'no'].includes(queryValue) || ['0', 'false', 'off', 'no'].includes(headerValue);
}

async function fetchWithTimeout(url: string, deadlineMs?: number): Promise<Response> {
  const remaining = deadlineMs ? Math.max(500, deadlineMs - Date.now()) : 45000;
  const fetchTimeout = Math.min(remaining, 45000);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), fetchTimeout);
  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: FR24_SCHEDULE_HEADERS
    });
    clearTimeout(timeout);
    return resp;
  } catch (e) {
    clearTimeout(timeout);
    throw e;
  }
}

function extractFr24SchedulePayload(data: any, dir: string, page: number): any | null {
  const airportData = data?.result?.response?.airport;
  const sched = airportData?.pluginData?.schedule?.[dir];
  if (!sched) {
    if (airportData && page === 1) {
      return { page: { current: page, total: 1 }, data: [] };
    }
    return null;
  }
  return sched;
}

function isDirectFr24Block(resp: Response): boolean {
  const cfMitigated = String(resp.headers?.get?.('cf-mitigated') || '').toLowerCase();
  return resp.status === 403 || resp.status === 429 || cfMitigated === 'challenge';
}

async function fetchOnePageViaScraperTransport(url: string, dir: string, page: number, deadlineMs?: number): Promise<any | null> {
  const result = await fetchFr24ScheduleViaScraperTransport(url, deadlineMs);
  if (!result) return null;

  const sched = extractFr24SchedulePayload(result.data, dir, page);
  if (!sched) return null;
  return {
    ...sched,
    _scrapeTransport: result.transport,
  };
}

// Resilient page fetch — returns null on failure instead of throwing (matches irops pattern)
async function fetchOnePage(
  hub: string,
  dir: string,
  timestamp: number,
  page: number,
  deadlineMs?: number,
  options: Pick<ScheduleFetchOptions, 'disableScraperFallback'> = {}
): Promise<any | null> {
  const url = `https://api.flightradar24.com/common/v1/airport.json?code=${encodeURIComponent(hub)}&plugin[]=schedule&plugin-setting[schedule][mode]=${encodeURIComponent(dir)}&plugin-setting[schedule][timestamp]=${timestamp}&page=${page}&limit=100`;
  const MAX_RETRIES = 2;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (deadlineMs && Date.now() > deadlineMs - 500) return null;
    await acquireFR24Slot();
    let slotReleased = false;
    try {
      const resp = await fetchWithTimeout(url, deadlineMs);
      if (resp.ok) {
        const data = await resp.json();
        const sched = extractFr24SchedulePayload(data, dir, page);
        return sched;
      }
      if (!options.disableScraperFallback && hasConfiguredFr24ScraperTransport() && isDirectFr24Block(resp)) {
        const recovered = await fetchOnePageViaScraperTransport(url, dir, page, deadlineMs);
        if (recovered) return recovered;
        if (resp.status === 403) {
          console.error(`FR24 direct scrape blocked for ${hub} page ${page}; configured scraper transport did not recover`);
          return { _rateLimited: true };
        }
      }
      if (resp.status === 403 && String(resp.headers?.get?.('cf-mitigated') || '').toLowerCase() === 'challenge') {
        console.error(`FR24 Cloudflare challenge for ${hub} page ${page}`);
        return { _rateLimited: true };
      }
      if ([403, 429, 502, 503].includes(resp.status) && attempt < MAX_RETRIES) {
        // Honor Retry-After header if present (capped at 30s)
        const retryAfter = resp.headers?.get?.('retry-after');
        const retryDelaySec = retryAfter ? parseInt(retryAfter, 10) : NaN;
        if (!isNaN(retryDelaySec) && retryDelaySec > 0 && retryDelaySec <= 30) {
          const remainingMs = deadlineMs ? Math.max(0, deadlineMs - Date.now() - 1000) : MAX_FR24_RETRY_AFTER_MS;
          const retryDelayMs = Math.min(retryDelaySec * 1000, MAX_FR24_RETRY_AFTER_MS, remainingMs);
          if (retryDelayMs < 250) {
            return { _rateLimited: true };
          }
          releaseFR24Slot();
          slotReleased = true;
          await new Promise(r => setTimeout(r, retryDelayMs));
          continue;
        }
        // fall through to retry with default backoff
      } else if ([403, 429].includes(resp.status)) {
        console.error(`FR24 rate limited ${resp.status} for ${hub} page ${page}`);
        return { _rateLimited: true };
      } else {
        console.error(`FR24 returned ${resp.status} for ${hub} page ${page}`);
        return null;
      }
    } catch (e: any) {
      if (attempt >= MAX_RETRIES || e.name === 'AbortError') {
        return null;
      }
      // fall through to retry
    } finally {
      if (!slotReleased) releaseFR24Slot();
    }
    const baseDelay = 1000 * Math.pow(2, attempt);
    const jitter = Math.floor(Math.random() * 500);
    await new Promise(r => setTimeout(r, baseDelay + jitter));
  }
  return null;
}

// ── Official FR24 API support ──
const FR24_API_BASE = 'https://fr24api.flightradar24.com';

function formatForFR24(date: Date): string {
  // FR24 API expects YYYY-MM-DDTHH:MM:SSZ format (with trailing Z, no milliseconds)
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

const ICAO_TO_IATA_AIRLINE: Record<string, string> = { UAL:'UA', AAL:'AA', DAL:'DL', SWA:'WN', JBU:'B6', ASA:'AS', SKW:'OO', RPA:'YX', ENY:'MQ', GJS:'G7', ACA:'AC', BAW:'BA', DLH:'LH', AFR:'AF', KLM:'KL' };
function icaoFlightToIata(icaoFlight: string): string {
  if (!icaoFlight) return '';
  const match = /^([A-Z]{3})(\d+)$/.exec(icaoFlight);
  if (!match) return icaoFlight;
  const iataAirline = ICAO_TO_IATA_AIRLINE[match[1]];
  return iataAirline ? iataAirline + match[2] : icaoFlight;
}

function normalizeFlightId(value: any): string {
  if (!value) return '';
  return String(value).trim().replace(/\s+/g, '').toUpperCase();
}

function toUnix(val: any): number | null {
  if (!val) return null;
  if (typeof val === 'number') return val > 1e12 ? Math.floor(val / 1000) : val;
  if (typeof val === 'string') {
    const num = Number(val);
    if (Number.isFinite(num)) return num > 1e12 ? Math.floor(num / 1000) : Math.floor(num);
  }
  const ms = Date.parse(val);
  return isNaN(ms) ? null : Math.floor(ms / 1000);
}

function mapStatus(f: any) {
  const s = (f.status || '').toLowerCase();
  const ended = !!f.flight_ended;
  const hasTakeoff = !!(f.datetime_takeoff || f.departure?.actual);
  const hasLanding = !!(f.datetime_landed || f.arrival?.actual);

  let text = 'scheduled';
  let type = '';
  let diverted = false;
  let live = false;
  let icon = '';

  if (s === 'canceled' || s === 'cancelled' || s === 'c') {
    type = 'canceled';
    text = 'canceled';
    icon = 'red';
  } else if (s === 'diverted' || s === 'd') {
    diverted = true;
    text = 'landed';
    icon = 'red';
  } else if (hasLanding || ended || s === 'landed' || s === 'l') {
    text = 'landed';
    icon = 'green';
  } else if (hasTakeoff || s === 'active' || s === 'en-route' || s === 'a' || s === 'en route' || s === 'airborne') {
    text = 'departed';
    live = true;
    icon = 'green';
  } else if (s === 'estimated' || s === 'delayed') {
    text = 'estimated';
    icon = 'yellow';
  }

  if (f.dest_icao_actual && f.dest_icao && f.dest_icao !== f.dest_icao_actual) {
    diverted = true;
  }

  return {
    generic: { status: { text, diverted }, type },
    text: s,
    icon,
    live
  };
}

function normalizeSummaryFlight(f: any) {
  const rawFlightId = normalizeFlightId(f.flight_iata || f.flight_number?.iata || f.flight || f.flight_icao || f.callsign || f.flight_number?.icao || '');
  const flightNum = icaoFlightToIata(rawFlightId);
  const callsign = normalizeFlightId(f.callsign || f.flight_icao || f.flight_number?.icao || f.flight || '');

  const origIata = f.orig_iata || f.origin?.iata || icaoToIata(f.orig_icao || f.origin?.icao || '');
  const destIata = f.dest_iata || f.destination?.iata || icaoToIata(f.dest_icao_actual || f.dest_icao || f.destination?.icao || '');
  const origName = f.origin?.name || f.orig_name || '';
  const destName = f.destination?.name || f.dest_name || '';

  const rawSchedDep = toUnix(f.departure?.scheduled || f.scheduled_departure || f.datetime_scheduled_departure);
  const rawSchedArr = toUnix(f.arrival?.scheduled || f.scheduled_arrival || f.datetime_scheduled_arrival);
  const realDep = toUnix(f.departure?.actual || f.actual_departure || f.datetime_takeoff || f.datetime_actual_departure);
  const realArr = toUnix(f.arrival?.actual || f.actual_arrival || f.datetime_landed || f.datetime_actual_arrival);
  const estDep = toUnix(f.departure?.estimated || f.estimated_departure || f.datetime_estimated_departure);
  const estArr = toUnix(f.arrival?.estimated || f.estimated_arrival || f.datetime_estimated_arrival);
  const derivedScheduledDeparture = !rawSchedDep && !!realDep;
  const derivedScheduledArrival = !rawSchedArr && !!realArr;
  const schedDep = rawSchedDep || (derivedScheduledDeparture ? realDep : null);
  const schedArr = rawSchedArr || (derivedScheduledArrival ? realArr : null);

  const acType = f.aircraft?.type || f.aircraft_type || f.type || '';
  const acReg = f.aircraft?.registration || f.registration || f.reg || '';

  // Extract gate/terminal from API response if available (try multiple field name conventions)
  const origGate = f.origin?.gate || f.orig_gate || f.departure_gate || '';
  const origTerminal = f.origin?.terminal || f.orig_terminal || f.departure_terminal || '';
  const destGate = f.destination?.gate || f.dest_gate || f.arrival_gate || '';
  const destTerminal = f.destination?.terminal || f.dest_terminal || f.arrival_terminal || '';

  // Fall back to known United hub terminal if API didn't provide terminal data
  const isIntl = isInternationalRoute(origIata, destIata);
  const fallbackOrigTerminal = origTerminal || getHubTerminal(origIata, isIntl);
  const fallbackDestTerminal = destTerminal || getHubTerminal(destIata, isIntl);

  return {
    identification: { number: { default: flightNum }, callsign },
    airline: { code: { iata: 'UA' } },
    status: mapStatus(f),
    time: {
      scheduled: { departure: schedDep, arrival: schedArr },
      real: { departure: realDep, arrival: realArr },
      estimated: { departure: estDep, arrival: estArr }
    },
    airport: {
      origin: { code: { iata: origIata }, name: origName, info: { gate: origGate, terminal: fallbackOrigTerminal } },
      destination: { code: { iata: destIata }, name: destName, info: { gate: destGate, terminal: fallbackDestTerminal } }
    },
    aircraft: { model: { code: acType, text: '' }, registration: acReg },
    _source: {
      officialApi: true,
      hasOfficialScheduledTime: {
        departure: !!rawSchedDep,
        arrival: !!rawSchedArr
      },
      scheduleTimeDerivedFromActual: {
        departure: derivedScheduledDeparture,
        arrival: derivedScheduledArrival
      }
    }
  };
}

const OFFICIAL_API_PAGE_SIZE = 10000; // FR24 API allows up to 20,000 per request; use 10k to get most hubs in a single page
const OFFICIAL_QUOTA_BLOCK_MS = 30 * 60 * 1000;
let officialQuotaBlockedUntil = 0;

const LIVE_FEED_URL = 'https://data-cloud.flightradar24.com/zones/fcgi/feed.js?airline=UAL';
const LIVE_FEED_CACHE_TTL_MS = 15_000;
const LIVE_FEED_TIMEOUT_MS = 10_000;
const HUB_COORDS: Record<string, { lat: number; lon: number }> = {
  ORD: { lat: 41.974, lon: -87.907 },
  DEN: { lat: 39.856, lon: -104.674 },
  IAH: { lat: 29.99, lon: -95.336 },
  EWR: { lat: 40.693, lon: -74.169 },
  SFO: { lat: 37.621, lon: -122.379 },
  IAD: { lat: 38.953, lon: -77.456 },
  LAX: { lat: 33.942, lon: -118.408 },
  NRT: { lat: 35.764, lon: 140.386 },
  GUM: { lat: 13.484, lon: 144.797 },
};

let liveFeedCache: { data: any; expires: number } | null = null;
let liveFeedInFlight: Promise<any | null> | null = null;

function parseRetryAfterMs(headerValue: string | null): number {
  if (!headerValue) return 0;
  const numeric = Number.parseInt(headerValue, 10);
  if (Number.isFinite(numeric) && numeric > 0) return numeric * 1000;

  const retryAt = Date.parse(headerValue);
  if (Number.isFinite(retryAt)) {
    return Math.max(0, retryAt - Date.now());
  }
  return 0;
}

function isOfficialQuotaBlocked(): boolean {
  // Honour BOTH this instance's block and the global block mirrored from Supabase, so a 402 hit by
  // any other lambda also stops this one from calling the paid official API. (Audit: global guard.)
  return Date.now() < Math.max(officialQuotaBlockedUntil, getMirroredQuotaBlockedUntil());
}

function blockOfficialQuota(reason: string): void {
  officialQuotaBlockedUntil = Date.now() + OFFICIAL_QUOTA_BLOCK_MS;
  console.warn(`Official FR24 API quota blocked for 30m: ${reason}`);
  // Propagate the block to all other instances (fire-and-forget; never throws).
  void persistQuotaBlock(officialQuotaBlockedUntil, reason);
}

function isLiveFeedFallbackEnabled(): boolean {
  const setting = String(process.env.SCHEDULE_LIVE_FEED_FALLBACK_ENABLED || 'true').toLowerCase();
  return !['0', 'false', 'off', 'no'].includes(setting);
}

function shouldAttemptLiveFeedFallback(hub: string, ts: number): boolean {
  if (!isLiveFeedFallbackEnabled()) return false;
  const hubUpper = hub.toUpperCase();
  // Same start-of-day fix as the official rescue gate: also accept the dashboard's canonical
  // hub-local today, so the no-credit live-feed rescue isn't disabled before 6 AM hub-local.
  return ts === getStartOfDayForHub(hubUpper) || ts === getStartOfHubDay(hubUpper, 0);
}

function toFiniteNumber(value: any): number | null {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function haversineNm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (deg: number) => deg * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 3440.065 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function estimateLiveArrivalTime(flight: any, hub: string, lastSeen: number): number {
  if (flight.onGround) return lastSeen;
  const coords = HUB_COORDS[hub.toUpperCase()];
  const lat = toFiniteNumber(flight.lat);
  const lon = toFiniteNumber(flight.lon);
  const speedKt = toFiniteNumber(flight.spdKt);
  if (!coords || lat === null || lon === null || !speedKt || speedKt < 120) {
    return lastSeen;
  }
  const distanceNm = haversineNm(lat, lon, coords.lat, coords.lon);
  const etaMinutes = Math.max(5, Math.min(18 * 60, (distanceNm / speedKt) * 60 + 12));
  return lastSeen + Math.round(etaMinutes * 60);
}

async function fetchUnitedLiveFeed(deadlineMs?: number): Promise<any | null> {
  if (liveFeedCache && Date.now() < liveFeedCache.expires) {
    return liveFeedCache.data;
  }
  if (liveFeedInFlight) return liveFeedInFlight;

  liveFeedInFlight = (async () => {
    const remaining = deadlineMs ? Math.max(500, deadlineMs - Date.now()) : LIVE_FEED_TIMEOUT_MS;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.min(remaining, LIVE_FEED_TIMEOUT_MS));
    try {
      const resp = await fetch(LIVE_FEED_URL, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'TheBlueBoardDashboard/1.0 (https://theblueboard.co)',
          'Accept': 'application/json',
        },
      });
      if (!resp.ok) {
        console.warn(`FR24 live feed fallback returned ${resp.status}`);
        return null;
      }
      const data = await resp.json();
      liveFeedCache = { data, expires: Date.now() + LIVE_FEED_CACHE_TTL_MS };
      return data;
    } catch (error: any) {
      console.warn('FR24 live feed fallback failed:', error?.message || error);
      return null;
    } finally {
      clearTimeout(timeout);
      liveFeedInFlight = null;
    }
  })();

  return liveFeedInFlight;
}

function normalizeLiveFeedFlight(id: string, arr: any[], hub: string, dir: string, ts: number): any | null {
  if (!Array.isArray(arr) || arr.length < 19) return null;

  const origin = String(arr[11] || '').toUpperCase();
  const destination = String(arr[12] || '').toUpperCase();
  const hubUpper = hub.toUpperCase();
  if (dir === 'departures' && origin !== hubUpper) return null;
  if (dir === 'arrivals' && destination !== hubUpper) return null;

  const rawFlightId = normalizeFlightId(arr[13] || arr[16] || '');
  const flightNum = icaoFlightToIata(rawFlightId);
  const callsign = normalizeFlightId(arr[16] || rawFlightId);
  if (!flightNum && !callsign) return null;

  const lastSeen = toFiniteNumber(arr[10]) || Math.floor(Date.now() / 1000);
  const dayEnd = ts + 86400;
  if (lastSeen < ts - 6 * 3600 || lastSeen >= dayEnd + 6 * 3600) return null;

  const onGround = arr[14] === 1;
  const acType = String(arr[8] || '');
  const acReg = String(arr[9] || '');
  const arrivalEstimate = dir === 'arrivals'
    ? estimateLiveArrivalTime({
        lat: arr[1],
        lon: arr[2],
        spdKt: arr[5],
        onGround,
      }, hubUpper, lastSeen)
    : null;

  const statusText = onGround
    ? (dir === 'arrivals' ? 'landed' : 'scheduled')
    : (dir === 'arrivals' ? 'en-route' : 'departed');

  const isIntl = isInternationalRoute(origin, destination);
  const scheduledDeparture = dir === 'departures' ? lastSeen : null;
  const scheduledArrival = dir === 'arrivals' ? arrivalEstimate : null;

  return {
    identification: { number: { default: flightNum }, callsign },
    airline: { code: { iata: 'UA' } },
    status: {
      generic: { status: { text: statusText, diverted: false }, type: '' },
      text: statusText,
      icon: onGround && dir === 'departures' ? '' : 'green',
      live: !onGround,
    },
    time: {
      scheduled: { departure: scheduledDeparture, arrival: scheduledArrival },
      real: {
        departure: dir === 'departures' && !onGround ? lastSeen : null,
        arrival: dir === 'arrivals' && onGround ? lastSeen : null,
      },
      estimated: {
        departure: dir === 'departures' && onGround ? lastSeen : null,
        arrival: dir === 'arrivals' && !onGround ? arrivalEstimate : null,
      },
    },
    airport: {
      origin: {
        code: { iata: origin },
        name: '',
        info: { gate: '', terminal: getHubTerminal(origin, isIntl) },
      },
      destination: {
        code: { iata: destination },
        name: '',
        info: { gate: '', terminal: getHubTerminal(destination, isIntl) },
      },
    },
    aircraft: { model: { code: acType, text: '' }, registration: acReg },
    _source: {
      liveFeedFallback: true,
      fr24Id: id,
      lastSeen,
      scheduleTimeDerivedFromActual: {
        departure: dir === 'departures' && !onGround,
        arrival: dir === 'arrivals' && onGround,
      },
      scheduleTimeDerivedFromLiveEstimate: {
        departure: false,
        arrival: dir === 'arrivals' && !onGround,
      },
    },
  };
}

async function fetchViaLiveFeedFallback(hub: string, dir: string, ts: number, effectiveDeadline: number): Promise<any | null> {
  const logHub = hub.toUpperCase();
  if (!shouldAttemptLiveFeedFallback(logHub, ts)) return null;
  const feed = await fetchUnitedLiveFeed(effectiveDeadline);
  if (!feed) return null;

  const flights: any[] = [];
  let totalFetched = 0;
  for (const [id, arr] of Object.entries(feed)) {
    if (!Array.isArray(arr)) continue;
    totalFetched++;
    const normalized = normalizeLiveFeedFlight(id, arr, logHub, dir, ts);
    if (normalized) flights.push(normalized);
  }

  if (!flights.length) return null;
  const dirTimeKey = dir === 'departures' ? 'departure' : 'arrival';
  flights.sort((a, b) => {
    const aTime = a.time?.scheduled?.[dirTimeKey] || 0;
    const bTime = b.time?.scheduled?.[dirTimeKey] || 0;
    return aTime - bTime;
  });

  return {
    flights,
    total: flights.length,
    totalFetched,
    pagesScanned: 1,
    totalPages: 1,
    cached: false,
    partial: true,
    hub: logHub,
    dir,
    meta: {
      partialReason: 'live_feed_fallback',
      pagesRequested: 1,
      pagesSucceeded: 1,
      pagesFailed: 0,
      missingPages: [] as number[],
      completeness: 0.35,
      elapsedMs: 0,
      source: 'live-feed',
      liveFeedFallbackTotal: flights.length,
      liveFeedFetched: totalFetched,
    },
  };
}

function scheduleFlightKey(flight: any): string {
  const ident = normalizeFlightId(flight?.identification?.number?.default || flight?.identification?.callsign || '');
  const origin = String(flight?.airport?.origin?.code?.iata || '').toUpperCase();
  const dest = String(flight?.airport?.destination?.code?.iata || '').toUpperCase();
  return `${ident}|${origin}|${dest}`;
}

function mergeLiveFeedFallback(base: any, live: any): any {
  const existing = new Set((base.flights || []).map(scheduleFlightKey).filter(Boolean));
  const additions = (live.flights || []).filter((flight: any) => {
    const key = scheduleFlightKey(flight);
    if (!key || existing.has(key)) return false;
    existing.add(key);
    return true;
  });
  if (!additions.length) return base;

  const dirTimeKey = base.dir === 'departures' ? 'departure' : 'arrival';
  const flights = [...(base.flights || []), ...additions].sort((a, b) => {
    const aTime = a.time?.scheduled?.[dirTimeKey] || 0;
    const bTime = b.time?.scheduled?.[dirTimeKey] || 0;
    return aTime - bTime;
  });

  return {
    ...base,
    flights,
    total: flights.length,
    totalFetched: Number(base.totalFetched || base.total || 0) + additions.length,
    partial: true,
    meta: {
      ...(base.meta || {}),
      partialReason: base.meta?.partialReason || 'live_feed_augmented',
      liveFeedFallbackAdded: additions.length,
      liveFeedFallbackTotal: live.total,
      liveFeedFallbackSource: live.meta?.source || 'live-feed',
    },
  };
}

async function maybeAugmentWithLiveFeedFallback(result: any, hub: string, dir: string, ts: number, effectiveDeadline: number): Promise<any> {
  if (!result?.partial) return result;
  const live = await fetchViaLiveFeedFallback(hub, dir, ts, effectiveDeadline);
  if (!live) return result;
  if (Number(result.total || 0) === 0) {
    return {
      ...live,
      meta: {
        ...live.meta,
        fallbackFrom: result.meta?.source || 'schedule',
        fallbackFromReason: result.meta?.partialReason || null,
      },
    };
  }
  return mergeLiveFeedFallback(result, live);
}

async function fetchViaOfficialAPI(hub: string, dir: string, ts: number, timeoutMs?: number) {
  const logHub = String(hub);
  const token = process.env.FR24_API_TOKEN;
  if (!token) {
    console.log('Official FR24 API: no FR24_API_TOKEN configured');
    return null;
  }
  if (isOfficialQuotaBlocked()) {
    const secondsRemaining = Math.ceil((officialQuotaBlockedUntil - Date.now()) / 1000);
    console.warn(`Official FR24 API: quota block active for ${logHub}, skipping for ${secondsRemaining}s`);
    return null;
  }

  timeoutMs = timeoutMs || HUB_TIMEOUT_MS[logHub.toUpperCase()] || 45000;
  const startTime = Date.now();
  const deadline = startTime + timeoutMs;

  const dayStart = new Date(ts * 1000);
  const dayEnd = new Date((ts + 86400 - 1) * 1000);

  console.log(`Official FR24 API: fetching ${logHub} ${dir} (filter=${dir === 'departures' ? 'outbound' : 'inbound'}:${logHub}) from=${formatForFR24(dayStart)} to=${formatForFR24(dayEnd)} limit=${OFFICIAL_API_PAGE_SIZE}`);

  const allRawFlights: any[] = [];
  let page = 1;
  let totalPages = 1;
  let retried1 = false;
  let officialPartial = false;
  let partialReason: string | null = null;
  let pagesFailed = 0;
  const MAX_OFFICIAL_PAGES = 50;

  while (page <= MAX_OFFICIAL_PAGES) {
    if (Date.now() > deadline - 1000) {
      console.log(`Official FR24 API: deadline approaching for ${logHub}, stopping at page ${page}`);
      break;
    }

    // Use direction-aware airport filter: "outbound:ORD" for departures, "inbound:ORD" for arrivals
    const airportFilter = dir === 'departures' ? `outbound:${logHub}` : `inbound:${logHub}`;
    const params = new URLSearchParams({
      airports: airportFilter,
      operating_as: 'UAL',
      flight_datetime_from: formatForFR24(dayStart),
      flight_datetime_to: formatForFR24(dayEnd),
      limit: String(OFFICIAL_API_PAGE_SIZE),
      page: String(page)
    });

    const url = `${FR24_API_BASE}/api/flight-summary/light?${params}`;
    const controller = new AbortController();
    const remaining = Math.max(2000, deadline - Date.now());
    const timeout = setTimeout(() => controller.abort(), Math.min(remaining, 30000));

    try {
      const resp = await fetch(url, {
        signal: controller.signal,
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json',
          'Accept-Version': 'v1',
          'User-Agent': 'TheBlueBoardDashboard/1.0 (https://theblueboard.co)',
        },
      });
      clearTimeout(timeout);

      if (!resp.ok) {
        const body = await resp.text().catch(() => '');
        console.error(`Official FR24 API returned ${resp.status} for ${logHub} (page ${page}): ${body.slice(0, 200)}`);

        if (resp.status === 402) {
          blockOfficialQuota(body || `HTTP ${resp.status}`);
          return null;
        }

        if ([400, 401, 403].includes(resp.status)) {
          return null;
        }

        if ([429, 503].includes(resp.status) && Date.now() < deadline - 2500) {
          const retryAfterMs = parseRetryAfterMs(resp.headers.get('retry-after'));
          const waitMs = Math.max(1200, Math.min(retryAfterMs || 4000, 8000));
          await new Promise(r => setTimeout(r, waitMs));
        }

        if (page === 1) {
          // Retry page 1 once after a brief pause before giving up
          if (Date.now() < deadline - 5000 && !retried1) {
            retried1 = true;
            console.log(`Official FR24 API: retrying page 1 for ${logHub} after ${resp.status}`);
            await new Promise(r => setTimeout(r, 1500));
            continue;
          }
          return null;
        }
        pagesFailed++;
        officialPartial = true;
        partialReason = 'upstream_http_error';
        break;
      }

      const data = await resp.json();
      const flights = (data as any)?.data || [];

      if (page === 1) {
        console.log(`Official FR24 API [${logHub}] page 1: ${flights.length} flights, keys: ${flights.length > 0 ? Object.keys(flights[0]).join(',') : 'N/A'}`);
        if (flights.length > 0) {
          const s = flights[0];
          console.log(`Official FR24 API [${logHub}] sample: ${JSON.stringify(s).slice(0, 500)}`);
        }
      } else {
        console.log(`Official FR24 API [${logHub}] page ${page}: ${flights.length} flights`);
      }

      allRawFlights.push(...flights);

      if (flights.length < OFFICIAL_API_PAGE_SIZE) break;

      page++;

      if (page <= MAX_OFFICIAL_PAGES && Date.now() < deadline - 1000) {
        await new Promise(r => setTimeout(r, 50));
      }
    } catch (e: any) {
      clearTimeout(timeout);
      if (e.name === 'AbortError') {
        console.error(`Official FR24 API timeout for ${logHub} (page ${page})`);
      } else {
        console.error(`Official FR24 API error for ${logHub} (page ${page}):`, e.message);
      }
      if (page === 1) {
        if (Date.now() < deadline - 5000 && !retried1) {
          retried1 = true;
          console.log(`Official FR24 API: retrying page 1 for ${logHub} after error`);
          await new Promise(r => setTimeout(r, 1500));
          continue;
        }
        return null;
      }
      pagesFailed++;
      officialPartial = true;
      partialReason = e.name === 'AbortError' ? 'upstream_timeout' : 'upstream_fetch_error';
      break;
    }
  }

  totalPages = page;
  if (page > 1 && Date.now() > deadline - 1000) {
    officialPartial = true;
    partialReason = partialReason || 'deadline_exceeded';
  }

  if (!allRawFlights.length) {
    console.log(`Official FR24 API returned 0 flights for ${logHub} ${dir}`);
    return {
      flights: [],
      total: 0,
      totalFetched: 0,
      pagesScanned: totalPages,
      totalPages,
      cached: false,
      partial: false,
      hub: logHub,
      dir,
      meta: {
        partialReason,
        pagesRequested: totalPages,
        pagesSucceeded: Math.max(0, totalPages - pagesFailed),
        pagesFailed,
        missingPages: [] as number[],
        completeness: officialPartial ? 0.9 : 1,
        elapsedMs: Date.now() - startTime,
        source: 'official-api'
      }
    };
  }

  const hubUpper = logHub.toUpperCase();
  const hubIcao = logHub.length === 3 ? ('K' + logHub).toUpperCase() : logHub.toUpperCase();
  const allUAFlights: any[] = [];
  for (const f of allRawFlights) {
    const rawOrigIcao = (f.orig_icao || f.origin?.icao || '').toUpperCase();
    const rawDestIcao = (f.dest_icao || f.destination?.icao || '').toUpperCase();
    const rawOrigIata = (f.orig_iata || f.origin?.iata || icaoToIata(rawOrigIcao)).toUpperCase();
    const rawDestIata = (f.dest_iata || f.destination?.iata || icaoToIata(rawDestIcao)).toUpperCase();

    const origMatchesHub = rawOrigIata === hubUpper || rawOrigIcao === hubIcao || rawOrigIcao === hubUpper;
    const destMatchesHub = rawDestIata === hubUpper || rawDestIcao === hubIcao || rawDestIcao === hubUpper;

    if (dir === 'departures' && !origMatchesHub) continue;
    if (dir === 'arrivals' && !destMatchesHub) continue;

    allUAFlights.push(normalizeSummaryFlight(f));
  }

  // Quality gate: reject sparse payloads where most flights lack any usable time,
  // but keep FR24's actual-only summary rows as a degraded same-day fallback.
  const dirTimeKey = dir === 'departures' ? 'departure' : 'arrival';
  let sparseCount = 0;
  let derivedScheduleCount = 0;
  let officialScheduleCount = 0;
  const qualityFiltered: any[] = [];
  for (const fl of allUAFlights) {
    const schedTime = fl.time?.scheduled?.[dirTimeKey];
    if (schedTime && schedTime > 0) {
      qualityFiltered.push(fl);
      if (fl._source?.scheduleTimeDerivedFromActual?.[dirTimeKey]) derivedScheduleCount++;
      else officialScheduleCount++;
    } else {
      sparseCount++;
    }
  }

  if (allUAFlights.length > 0 && qualityFiltered.length === 0) {
    console.warn(`Official FR24 API: ${allUAFlights.length} flights for ${logHub} ${dir} lack usable ${dirTimeKey} times — rejecting as sparse`);
    return null;
  }

  if (allUAFlights.length > 0 && sparseCount / allUAFlights.length > 0.5 && derivedScheduleCount === 0) {
    console.warn(`Official FR24 API: ${sparseCount}/${allUAFlights.length} flights for ${logHub} ${dir} lack scheduled times — rejecting as sparse`);
    return null; // fall through to scraping fallback
  }

  const elapsedMs = Date.now() - startTime;
  const hasDerivedScheduleTimes = derivedScheduleCount > 0;
  const responsePartial = officialPartial || hasDerivedScheduleTimes;
  const responsePartialReason = partialReason || (hasDerivedScheduleTimes ? 'actual_only_official' : null);
  const completeness = hasDerivedScheduleTimes ? Math.max(0.25, Math.min(1, officialScheduleCount / qualityFiltered.length || 0.25)) : (officialPartial ? 0.9 : 1);
  console.log(`Official FR24 API: ${allRawFlights.length} total flights (${totalPages} pages), ${qualityFiltered.length} ${dir} for ${logHub} in ${elapsedMs}ms${sparseCount > 0 ? ` (${sparseCount} sparse filtered)` : ''}${derivedScheduleCount > 0 ? ` (${derivedScheduleCount} actual-time fallback)` : ''}`);

  return {
    flights: qualityFiltered,
    total: qualityFiltered.length,
    totalFetched: allRawFlights.length,
    pagesScanned: totalPages,
    totalPages,
    cached: false,
    partial: responsePartial,
    hub: logHub,
    dir,
    meta: {
      partialReason: responsePartialReason,
      pagesRequested: totalPages,
      pagesSucceeded: Math.max(0, totalPages - pagesFailed),
      pagesFailed,
      missingPages: [] as number[],
      completeness,
      elapsedMs,
      source: 'official-api',
      sparseFiltered: sparseCount,
      actualTimeFallbackCount: derivedScheduleCount,
      officialScheduleCount
    }
  };
}

const pendingAggs = new Map<string, Promise<any>>();
let warnedWaitUntilUnavailable = false;

function enqueueBackgroundTask(promise: Promise<any>): void {
  try {
    waitUntil(promise);
  } catch (error: any) {
    if (!warnedWaitUntilUnavailable) {
      console.warn('waitUntil unavailable; schedule background refresh is best-effort:', error?.message || error);
      warnedWaitUntilUnavailable = true;
    }
  }
}

function triggerBackgroundRefresh(
  hub: string,
  dir: string,
  ts: number,
  aggKey: string,
  ttl: number,
  options: ScheduleFetchOptions = {}
): void {
  if (pendingAggs.has(aggKey)) return;
  const refreshHub = String(hub);
  const promise = fetchAllPages(refreshHub, dir, ts, undefined, Date.now() + 55000, options).then(async result => {
    cacheSet(aggKey, result, result.partial ? 60000 : ttl);
    saveComplete(aggKey, result);
    await saveScheduleSnapshot({ cacheKey: aggKey, hub: refreshHub, dir, ts, data: result });
    return result;
  }).catch(e => {
    console.error(`Background refresh failed for ${refreshHub} [${aggKey}]:`, e.message);
  }).finally(() => {
    pendingAggs.delete(aggKey);
  });
  pendingAggs.set(aggKey, promise);
  enqueueBackgroundTask(promise);
}

// ── Circuit breaker: stop falling back to official API during sustained scraping outages ──
const fallbackLog: number[] = [];
const FALLBACK_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_FALLBACKS_PER_WINDOW = 5;

export function shouldAttemptOfficialFallback(): boolean {
  if (isOfficialQuotaBlocked()) {
    const secondsRemaining = Math.ceil((officialQuotaBlockedUntil - Date.now()) / 1000);
    console.warn(`Circuit breaker tripped: official API quota block active for ${secondsRemaining}s, skipping`);
    return false;
  }
  const now = Date.now();
  while (fallbackLog.length && fallbackLog[0] < now - FALLBACK_WINDOW_MS) fallbackLog.shift();
  if (fallbackLog.length >= MAX_FALLBACKS_PER_WINDOW) {
    console.warn(`Circuit breaker tripped: ${fallbackLog.length} official API fallbacks in 15min, skipping`);
    return false;
  }
  return true;
}

export function recordFallback(): void {
  fallbackLog.push(Date.now());
}

export function resetFallbackBreaker(): void {
  fallbackLog.length = 0;
  officialQuotaBlockedUntil = 0;
  liveFeedCache = null;
  liveFeedInFlight = null;
  resetMirroredQuotaBlock();
}

/**
 * Test helper: clear the in-memory schedule caches so a board cached by one test does not leak
 * into another that happens to use the same hub/dir/day cache key. Production never calls this.
 */
export function __resetScheduleCachesForTests(): void {
  cache.clear();
  lastCompleteCache.clear();
  lastCompleteByHubDir.clear();
  pendingAggs.clear();
}

async function tryOfficialFallback(
  logHub: string, dir: string, ts: number, effectiveDeadline: number
): Promise<any | null> {
  if (!process.env.FR24_API_TOKEN || !shouldAttemptOfficialFallback()) return null;
  recordFallback();
  try {
    const remaining = Math.max(2000, effectiveDeadline - Date.now() - 1000);
    const result = await fetchViaOfficialAPI(logHub, dir, ts, Math.min(remaining, 30000));
    if (result && result.total > 0) {
      result.meta = { ...(result.meta as any), fallbackFrom: 'scraping' };
      return result;
    }
  } catch (e: any) {
    console.error(`Official API fallback failed for ${logHub}:`, e.message);
  }
  return null;
}

async function tryScheduleProviderFallback(
  logHub: string, dir: string, ts: number, effectiveDeadline: number
): Promise<any | null> {
  if (!process.env.AERODATABOX_API_KEY) return null;
  try {
    const remaining = Math.max(0, effectiveDeadline - Date.now() - 1000);
    if (remaining < 2000) return null;
    const result = await fetchViaAeroDataBox(logHub, dir, ts, Math.min(remaining, 12000));
    if (result && result.total > 0) {
      result.meta = { ...(result.meta as any), fallbackFrom: 'scraping' };
      return result;
    }
  } catch (e: any) {
    console.error(`AeroDataBox schedule fallback failed for ${logHub}:`, e.message);
  }
  return null;
}

async function tryScheduleRescue(
  logHub: string,
  dir: string,
  ts: number,
  effectiveDeadline: number,
  allowProviderFallback: boolean,
  allowOfficialFallback: boolean
): Promise<any | null> {
  if (allowProviderFallback) {
    const providerFallback = await tryScheduleProviderFallback(logHub, dir, ts, effectiveDeadline);
    if (providerFallback) return providerFallback;
  }
  if (allowOfficialFallback) {
    const officialFallback = await tryOfficialFallback(logHub, dir, ts, effectiveDeadline);
    if (officialFallback) {
      return await maybeAugmentWithLiveFeedFallback(officialFallback, logHub, dir, ts, effectiveDeadline);
    }
  }
  const liveFallback = await fetchViaLiveFeedFallback(logHub, dir, ts, effectiveDeadline);
  if (liveFallback) {
    liveFallback.meta = {
      ...(liveFallback.meta || {}),
      fallbackFrom: 'scraping',
    };
  }
  return liveFallback;
}

async function fetchAllPages(
  hub: string,
  dir: string,
  ts: number,
  timeoutMs?: number,
  overallDeadline?: number,
  options: ScheduleFetchOptions = {}
) {
  const logHub = String(hub);
  const now = Date.now();
  const effectiveDeadline = overallDeadline || (now + (timeoutMs || HUB_TIMEOUT_MS[logHub.toUpperCase()] || 45000));
  const allowTargetedOfficialRescue = shouldAttemptTargetedOfficialRescue(logHub, ts, options);
  const allowProviderFallback = !options.disableProviderFallback;
  const allowScraperFallback = !options.disableScraperFallback;

  // ── Source routing decision tree ──
  const srcPriority = options.disableOfficialSource
    ? 'scrape-only'
    : (process.env.SCHEDULE_SOURCE_PRIORITY || 'scrape').toLowerCase();

  if (!['scrape', 'official', 'scrape-only'].includes(srcPriority)) {
    console.warn(`Unrecognized SCHEDULE_SOURCE_PRIORITY: '${srcPriority}', using scrape-only`);
  }

  if (srcPriority === 'official' && process.env.FR24_API_TOKEN) {
    try {
      const officialTimeout = Math.min(Math.floor((effectiveDeadline - Date.now()) * 0.7), 45000);
      const officialResult = await fetchViaOfficialAPI(logHub, dir, ts, officialTimeout);
      if (officialResult) {
        return await maybeAugmentWithLiveFeedFallback(officialResult, logHub, dir, ts, effectiveDeadline);
      }
    } catch (e: any) {
      console.error(`Official FR24 API failed for ${logHub}, falling back to scraping:`, e.message);
    }
  }

  // Primary path: scrape unauthenticated FR24 endpoint (paginated)
  const deadline = effectiveDeadline;
  const dayEnd = ts + 86400;
  const allUAFlights: any[] = [];
  let totalPages = 1;
  let totalFetched = 0;
  let partial = false;
  let pagesScanned = 0;
  const failedPages: number[] = [];
  const rateLimitedPages: number[] = [];
  let consecutiveRateLimitedBatches = 0;
  let stoppedForHeavyRateLimit = false;
  const BATCH_SIZE = 3;
  const MAX_PAGES = 50;
  const scraperTransports = new Set<string>();
  let scraperRecoveredPages = 0;

  function processPage(sched: any): boolean {
    if (sched?._scrapeTransport) {
      scraperTransports.add(String(sched._scrapeTransport));
      scraperRecoveredPages++;
    }
    if (!sched.data || sched.data.length === 0) return false;
    totalFetched += sched.data.length;
    for (const entry of sched.data) {
      const fl = entry.flight;
      if (!fl) continue;
      if (fl.airline?.code?.iata !== 'UA') continue;
      const schedDep = fl.time?.scheduled?.departure;
      const schedArr = fl.time?.scheduled?.arrival;
      const flightTime = dir === 'departures' ? schedDep : schedArr;
      if (flightTime && flightTime >= dayEnd) return true;
      allUAFlights.push(fl);
    }
    return false;
  }

  const startTime = Date.now();
  const firstPage = await fetchOnePage(logHub, dir, ts, 1, deadline, {
    disableScraperFallback: !allowScraperFallback,
  });
  if (!firstPage || firstPage._rateLimited) {
    if (srcPriority === 'scrape' && (allowProviderFallback || allowTargetedOfficialRescue)) {
      console.log(`Scraping failed on first page for ${logHub} ${dir}, trying schedule fallback`);
      const fallback = await tryScheduleRescue(logHub, dir, ts, effectiveDeadline, allowProviderFallback, allowTargetedOfficialRescue);
      if (fallback) return fallback;
    }
    const failedResult = { flights: [], total: 0, totalFetched: 0, pagesScanned: 0, totalPages: 1, cached: false, partial: true, hub: logHub, dir,
      meta: { partialReason: 'first_page_failed', pagesRequested: 1, pagesSucceeded: 0, pagesFailed: 1, missingPages: [1], completeness: 0, elapsedMs: Date.now() - startTime, source: 'scraping' as const }
    };
    return await maybeAugmentWithLiveFeedFallback(failedResult, logHub, dir, ts, effectiveDeadline);
  }
  totalPages = firstPage.page?.total || 1;
  pagesScanned = 1;
  const pastDay = processPage(firstPage);

  if (!pastDay && totalPages > 1) {
    const pagesToFetch = Math.min(totalPages, MAX_PAGES);
    let pageNum = 2;

    while (pageNum <= pagesToFetch) {
      if (Date.now() > deadline - 2000) { partial = true; break; }

      const batchEnd = Math.min(pageNum + BATCH_SIZE - 1, pagesToFetch);
      const batchPages: number[] = [];
      for (let p = pageNum; p <= batchEnd; p++) batchPages.push(p);

      const batchResults = await Promise.allSettled(
        batchPages.map(p => fetchOnePage(logHub, dir, ts, p, deadline, {
          disableScraperFallback: !allowScraperFallback,
        }))
      );

      let batchDone = false;
      let hitRateLimit = false;
      for (let i = 0; i < batchResults.length; i++) {
        const result = batchResults[i];
        pagesScanned++;
        if (result.status === 'rejected' || !result.value) {
          failedPages.push(batchPages[i]);
          continue;
        }
        if (result.value._rateLimited) {
          rateLimitedPages.push(batchPages[i]);
          hitRateLimit = true;
          continue;
        }
        const sched = result.value;
        if (!sched.data || sched.data.length === 0) { batchDone = true; break; }
        if (processPage(sched)) { batchDone = true; break; }
      }
      if (hitRateLimit && batchDone) break;
      if (hitRateLimit) {
        consecutiveRateLimitedBatches++;
        const remainingMs = deadline - Date.now();
        const shouldStopForHeavyRateLimit =
          rateLimitedPages.length >= MAX_RATE_LIMITED_PAGES_PER_SCRAPE ||
          consecutiveRateLimitedBatches >= MAX_CONSECUTIVE_RATE_LIMIT_BATCHES ||
          remainingMs < MIN_REMAINING_MS_TO_KEEP_PAGING;
        if (shouldStopForHeavyRateLimit) {
          stoppedForHeavyRateLimit = true;
          partial = true;
          break;
        }
        // Allow a single rate-limited batch to settle before continuing.
        await new Promise(r => setTimeout(r, 2000));
      } else {
        consecutiveRateLimitedBatches = 0;
      }
      if (batchDone) break;

      pageNum = batchEnd + 1;

      if (pageNum <= pagesToFetch && Date.now() < deadline - 2000) {
        await new Promise(r => setTimeout(r, BATCH_DELAY));
      }
    }
  }

  if (rateLimitedPages.length > 0) {
    partial = true;
  }

  if (failedPages.length > 0 && rateLimitedPages.length === 0 && Date.now() < deadline - 5000) {
    const cooldown = Math.min(1500, failedPages.length * 150);
    await new Promise(r => setTimeout(r, cooldown));
  }

  if (failedPages.length > 0 && rateLimitedPages.length === 0 && Date.now() < deadline - 3000) {
    const RETRY_BATCH = 2;
    const RETRY_DELAY = 800;
    const stillFailed: number[] = [];

    for (let i = 0; i < failedPages.length; i += RETRY_BATCH) {
      if (Date.now() > deadline - 2000) {
        stillFailed.push(...failedPages.slice(i));
        break;
      }

      const retryBatch = failedPages.slice(i, i + RETRY_BATCH);
      const retryResults = await Promise.allSettled(
        retryBatch.map(p => fetchOnePage(logHub, dir, ts, p, deadline, {
          disableScraperFallback: !allowScraperFallback,
        }))
      );

      for (let j = 0; j < retryResults.length; j++) {
        const result = retryResults[j];
        if (result.status === 'fulfilled' && result.value && !result.value._rateLimited) {
          processPage(result.value);
        } else {
          stillFailed.push(retryBatch[j]);
        }
      }

      if (i + RETRY_BATCH < failedPages.length && Date.now() < deadline - 2000) {
        await new Promise(r => setTimeout(r, RETRY_DELAY));
      }
    }

    failedPages.length = 0;
    failedPages.push(...stillFailed);
    if (stillFailed.length > 0) partial = true;
  } else if (failedPages.length > 0) {
    partial = true;
  }

  const allFailedPages = [...failedPages, ...rateLimitedPages];
  const elapsedMs = Date.now() - startTime;
  const pagesRequested = Math.min(totalPages, MAX_PAGES);
  let partialReason: string | null = null;
  if (partial) {
    if (rateLimitedPages.length > 0) partialReason = 'rate_limited';
    else if (Date.now() > deadline - 2000) partialReason = 'deadline_exceeded';
    else if (failedPages.length > 0) partialReason = 'page_fetch_failed';
    else partialReason = 'unknown';
  }

  const scrapeResult = {
    flights: allUAFlights,
    total: allUAFlights.length,
    totalFetched,
    pagesScanned,
    totalPages,
    cached: false,
    partial,
    hub: logHub,
    dir,
    meta: {
      partialReason,
      pagesRequested,
      pagesSucceeded: pagesScanned - allFailedPages.length,
      pagesFailed: allFailedPages.length,
      missingPages: allFailedPages,
      completeness: pagesRequested > 0 ? Math.round(((pagesScanned - allFailedPages.length) / pagesRequested) * 100) / 100 : 1,
      elapsedMs,
      source: 'scraping' as const,
      scrapeTransport: scraperTransports.size > 0 ? Array.from(scraperTransports).join(',') : 'direct',
      scraperRecoveredPages,
    }
  };

  // An empty-but-200 scrape for a same-day TARGETED United hub is never legitimate: United always
  // has a full day of flights, so a clean HTTP 200 with 0 rows (no 403/429/cf-mitigated) almost
  // always means FR24/Cloudflare returned a soft-blocked empty schedule page to our datacenter IP.
  // The official-rescue gate just below requires `partial`, but a clean empty page leaves
  // partial=false, so official was never attempted and the board fell through to a stale live-feed
  // snapshot. Mark it partial so it enters the rescue and fetches the FULL day from the paid FR24
  // official API. Scoped to allowTargetedOfficialRescue (the 9 hubs, FR24 token present, current
  // day, and USER requests only — the warm cron passes officialFallback=0 so allowTargetedOfficial-
  // Rescue is false there), keeping background credit spend untouched and the breaker/402 cap in
  // force. (Audit: empty-200 scrape treated as authoritative-empty, bypassing official rescue.)
  if (scrapeResult.total === 0 && !scrapeResult.partial && allowTargetedOfficialRescue) {
    scrapeResult.partial = true;
    scrapeResult.meta = {
      ...(scrapeResult.meta as any),
      partialReason: 'empty_200_suspected_block',
      completeness: 0,
    };
  }

  let attemptedOfficialRescue = false;
  if (
    srcPriority === 'scrape' &&
    allowTargetedOfficialRescue &&
    stoppedForHeavyRateLimit &&
    Date.now() < deadline - MIN_REMAINING_MS_FOR_OFFICIAL_RESCUE
  ) {
    attemptedOfficialRescue = true;
    console.log(`Scraping hit repeated FR24 rate limits for ${logHub} ${dir}, trying schedule fallback`);
    const fallback = await tryScheduleRescue(logHub, dir, ts, effectiveDeadline, allowProviderFallback, allowTargetedOfficialRescue);
    if (fallback) return fallback;
  }

  // Scrape-first fallback: if scraping failed completely, try official API (with circuit breaker)
  if (!attemptedOfficialRescue && srcPriority === 'scrape' && (allowProviderFallback || allowTargetedOfficialRescue) && scrapeResult.total === 0 && scrapeResult.partial) {
    console.log(`Scraping returned 0 flights for ${logHub} ${dir}, trying schedule fallback`);
    const fallback = await tryScheduleRescue(logHub, dir, ts, effectiveDeadline, allowProviderFallback, allowTargetedOfficialRescue);
    if (fallback) return fallback;
  }

  return await maybeAugmentWithLiveFeedFallback(scrapeResult, logHub, dir, ts, effectiveDeadline);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  let aggKey: string | null = null;
  let swr = 600;
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
    const functionDeadline = Date.now() + 57000;

    // Pull the latest cross-instance FR24 quota block (rate-limited to ~one read per 10s) so a 402
    // "credit limit reached" hit by ANY other lambda is honoured here before we decide to call the
    // paid official API. (Audit P1: per-lambda cost guards do not bound global spend.)
    await hydrateQuotaBlock();

    const { hub, dir = 'departures', timestamp, page } = req.query as Record<string, string>;
    if (!hub || !timestamp) {
      return res.status(400).json({ error: 'Missing required params: hub, timestamp' });
    }
    if (!['departures', 'arrivals'].includes(dir)) {
      return res.status(400).json({ error: 'dir must be departures or arrivals' });
    }
    if (!/^[A-Z]{3,4}$/i.test(hub)) {
      return res.status(400).json({ error: 'Invalid hub code' });
    }

    const ts = parseInt(timestamp, 10);
    const now = Math.floor(Date.now() / 1000);
    if (isNaN(ts) || ts < now - 86400 * 7 || ts > now + 86400 * 7) {
      return res.status(400).json({ error: 'Invalid timestamp' });
    }
    const isOld = (now - ts) > 86400;
    const ttl = isOld ? 600000 : 900000;
    const cdnMaxAge = isOld ? 3600 : 900;
    swr = 600;
    const allowOfficialFallback = !shouldDisableOfficialFallback(req);
    const allowProviderFallback = !shouldDisableProviderFallback(req);
    const allowScraperFallback = !shouldDisableScraperFallback(req);

    // Single page mode (backward compat)
    if (page !== undefined) {
      const pageNum = parseInt(page, 10) || 1;
      if (pageNum < 1 || pageNum > 100) {
        return res.status(400).json({ error: 'Invalid page number' });
      }
      const cacheKey = `sched:${hub}:${dir}:${ts}:${pageNum}`;
      const cached = cacheGet(cacheKey);
      if (cached) {
        res.setHeader('Cache-Control', `s-maxage=${cdnMaxAge}, stale-while-revalidate=${swr}`);
        return res.status(200).json({ ...cached.data, cached: true });
      }
      const sched = await fetchOnePage(hub, dir, ts, pageNum, functionDeadline, {
        disableScraperFallback: !allowScraperFallback,
      });
      if (!sched) {
        return res.status(502).json({ error: 'Upstream service unavailable' });
      }
      const scrapeTransport = sched._scrapeTransport || 'direct';
      delete sched._scrapeTransport;
      cacheSet(cacheKey, sched, ttl);
      res.setHeader('Cache-Control', `s-maxage=${cdnMaxAge}, stale-while-revalidate=${swr}`);
      return res.status(200).json({ ...sched, cached: false, meta: { ...(sched.meta || {}), source: 'scraping', scrapeTransport } });
    }

    // Aggregation mode
    const currentAggKey = `agg:${hub}:${dir}:${ts}`;
    aggKey = currentAggKey;

    const cached = cacheGet(currentAggKey);
    const hasImmediateScheduleRecovery =
      (allowScraperFallback && hasConfiguredFr24ScraperTransport()) ||
      (allowProviderFallback && !!process.env.AERODATABOX_API_KEY) ||
      shouldAttemptLiveFeedFallback(hub, ts);
    const shouldBypassEmptyPartialCache = cached?.data?.partial === true && Number(cached?.data?.total || 0) === 0 && hasImmediateScheduleRecovery;
    if (cached && !shouldBypassEmptyPartialCache) {
      setAggregateCacheHeader(res, cached.data, cdnMaxAge, swr);
      return res.status(200).json({ ...cached.data, cached: true });
    }

    const stale = cacheGetStale(currentAggKey);
    if (stale && !stale.data.partial) {
      triggerBackgroundRefresh(hub, dir, ts, currentAggKey, ttl, {
        allowTargetedOfficialRescue: false,
        disableOfficialSource: !allowOfficialFallback,
        disableProviderFallback: true,
        disableScraperFallback: true,
      });
      res.setHeader('Cache-Control', `s-maxage=60, stale-while-revalidate=${swr}`);
      return res.status(200).json({ ...stale.data, cached: true, stale: true });
    }

    const exactLastComplete = getLastComplete(currentAggKey);
    const fallbackComplete = exactLastComplete || getLastCompleteByHubDir(hub, dir, ts);
    if (fallbackComplete) {
      triggerBackgroundRefresh(hub, dir, ts, currentAggKey, ttl, {
        allowTargetedOfficialRescue: false,
        disableOfficialSource: !allowOfficialFallback,
        disableProviderFallback: true,
        disableScraperFallback: true,
      });
      res.setHeader('Cache-Control', `s-maxage=60, stale-while-revalidate=${swr}`);
      return res.status(200).json(buildDegradedResponse(fallbackComplete, exactLastComplete ? 'exact' : 'hub_dir'));
    }

    let partialPersistentFallback: Awaited<ReturnType<typeof getPersistentFallback>> | null = null;
    const persistentFallback = await getPersistentFallback(currentAggKey);
    if (persistentFallback) {
      const canAttemptRecoveryNow = persistentFallback.fallbackScope === 'persistent_partial' && hasImmediateScheduleRecovery;
      if (canAttemptRecoveryNow) {
        partialPersistentFallback = persistentFallback;
      } else {
        triggerBackgroundRefresh(hub, dir, ts, currentAggKey, ttl, {
          allowTargetedOfficialRescue: allowOfficialFallback && persistentFallback.fallbackScope === 'persistent_partial',
          disableOfficialSource: !allowOfficialFallback,
          disableProviderFallback: true,
          disableScraperFallback: true,
        });
        res.setHeader('Cache-Control', `s-maxage=60, stale-while-revalidate=${swr}`);
        return res.status(200).json(buildDegradedResponse(persistentFallback, persistentFallback.fallbackScope));
      }
    }

    if (pendingAggs.has(currentAggKey)) {
      const result = await pendingAggs.get(currentAggKey);
      if (result) {
        setAggregateCacheHeader(res, result, cdnMaxAge, swr);
        return res.status(200).json({ ...result, cached: true });
      }
    }

    const aggPromise = fetchAllPages(hub, dir, ts, undefined, functionDeadline, {
      allowTargetedOfficialRescue: allowOfficialFallback,
      disableOfficialSource: !allowOfficialFallback,
      disableProviderFallback: !allowProviderFallback,
      disableScraperFallback: !allowScraperFallback,
    }).then(async result => {
      cacheSet(currentAggKey, result, result.partial ? 60000 : ttl);
      saveComplete(currentAggKey, result);
      await saveScheduleSnapshot({ cacheKey: currentAggKey, hub, dir, ts, data: result });
      return result;
    });

    pendingAggs.set(currentAggKey, aggPromise);
    try {
      const result = await aggPromise;
      if (result.partial) {
        const exactLc = getLastComplete(currentAggKey);
        const lc = exactLc || getLastCompleteByHubDir(hub, dir, ts);
        if (lc) {
          res.setHeader('Cache-Control', `s-maxage=60, stale-while-revalidate=${swr}`);
          return res.status(200).json(buildDegradedResponse(lc, exactLc ? 'exact' : 'hub_dir'));
        }

        const persistentResult = await getPersistentFallback(currentAggKey);
        if (persistentResult && persistentResult.fallbackScope === 'persistent') {
          res.setHeader('Cache-Control', `s-maxage=60, stale-while-revalidate=${swr}`);
          return res.status(200).json(buildDegradedResponse(persistentResult, 'persistent'));
        }
        if (partialPersistentFallback) {
          res.setHeader('Cache-Control', `s-maxage=60, stale-while-revalidate=${swr}`);
          return res.status(200).json(buildDegradedResponse(partialPersistentFallback, 'persistent_partial'));
        }
      }
      setAggregateCacheHeader(res, result, cdnMaxAge, swr);
      return res.status(200).json(result);
    } finally {
      pendingAggs.delete(currentAggKey);
    }
  } catch (e) {
    console.error('Schedule API error:', e);
    if (aggKey) {
      const persistentFallback = await getPersistentFallback(aggKey);
      if (persistentFallback) {
        res.setHeader('Cache-Control', `s-maxage=60, stale-while-revalidate=${swr}`);
        return res.status(200).json(buildDegradedResponse(persistentFallback, persistentFallback.fallbackScope));
      }
    }
    return res.status(502).json({ error: 'Upstream service unavailable' });
  }
}
