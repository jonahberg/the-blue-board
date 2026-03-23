import type { VercelRequest, VercelResponse } from './types.js';
import { createRateLimiter } from './_rate-limit.js';
import { loadScheduleSnapshot, saveScheduleSnapshot } from './_schedule-snapshots.js';
import { getStartOfDayForHub } from './irops.js';
import { waitUntil } from '@vercel/functions';
import { icaoToIata, isInternationalRoute } from '../src/lib/airport-metadata.js';

const isRateLimited = createRateLimiter('schedule', 30);

type ScheduleFetchOptions = {
  allowTargetedOfficialRescue?: boolean;
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
const TARGETED_OFFICIAL_RESCUE_HUBS = new Set(['ORD', 'DEN', 'IAH', 'EWR', 'SFO', 'IAD', 'LAX']);

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
  const hubUpper = hub.toUpperCase();
  if (!TARGETED_OFFICIAL_RESCUE_HUBS.has(hubUpper)) return false;

  const startOfToday = getStartOfDayForHub(hubUpper);
  return ts === startOfToday || ts === startOfToday + 86400;
}

function cacheSet(key: string, data: any, ttlMs: number): void {
  if (cache.size >= MAX_CACHE_SIZE) {
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) cache.delete(firstKey);
  }
  cache.set(key, { data, expires: Date.now() + ttlMs, time: Date.now() });
}

async function fetchWithTimeout(url: string, deadlineMs?: number): Promise<Response> {
  const remaining = deadlineMs ? Math.max(500, deadlineMs - Date.now()) : 45000;
  const fetchTimeout = Math.min(remaining, 45000);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), fetchTimeout);
  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://www.flightradar24.com/',
        'Origin': 'https://www.flightradar24.com'
      }
    });
    clearTimeout(timeout);
    return resp;
  } catch (e) {
    clearTimeout(timeout);
    throw e;
  }
}

// Resilient page fetch — returns null on failure instead of throwing (matches irops pattern)
async function fetchOnePage(hub: string, dir: string, timestamp: number, page: number, deadlineMs?: number): Promise<any | null> {
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
        const airportData = (data as any)?.result?.response?.airport;
        const sched = airportData?.pluginData?.schedule?.[dir];
        if (!sched) {
          if (airportData && page === 1) {
            return { page: { current: page, total: 1 }, data: [] };
          }
          return null;
        }
        return sched;
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
  const flightNum = f.flight_iata || f.flight_number?.iata || icaoFlightToIata(f.flight_icao || f.callsign || f.flight_number?.icao || '') || '';
  const callsign = f.callsign || f.flight_icao || f.flight_number?.icao || '';

  const origIata = f.orig_iata || f.origin?.iata || icaoToIata(f.orig_icao || f.origin?.icao || '');
  const destIata = f.dest_iata || f.destination?.iata || icaoToIata(f.dest_icao_actual || f.dest_icao || f.destination?.icao || '');
  const origName = f.origin?.name || f.orig_name || '';
  const destName = f.destination?.name || f.dest_name || '';

  const schedDep = toUnix(f.departure?.scheduled || f.scheduled_departure || f.datetime_scheduled_departure);
  const schedArr = toUnix(f.arrival?.scheduled || f.scheduled_arrival || f.datetime_scheduled_arrival);
  const realDep = toUnix(f.departure?.actual || f.actual_departure || f.datetime_takeoff || f.datetime_actual_departure);
  const realArr = toUnix(f.arrival?.actual || f.actual_arrival || f.datetime_landed || f.datetime_actual_arrival);
  const estDep = toUnix(f.departure?.estimated || f.estimated_departure || f.datetime_estimated_departure);
  const estArr = toUnix(f.arrival?.estimated || f.estimated_arrival || f.datetime_estimated_arrival);

  const acType = f.aircraft?.type || f.aircraft_type || f.type || '';
  const acReg = f.aircraft?.registration || f.registration || '';

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
    aircraft: { model: { code: acType, text: '' }, registration: acReg }
  };
}

const OFFICIAL_API_PAGE_SIZE = 10000; // FR24 API allows up to 20,000 per request; use 10k to get most hubs in a single page

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

async function fetchViaOfficialAPI(hub: string, dir: string, ts: number, timeoutMs?: number) {
  const logHub = String(hub);
  const token = process.env.FR24_API_TOKEN;
  if (!token) {
    console.log('Official FR24 API: no FR24_API_TOKEN configured');
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

  // Quality gate: reject sparse payloads where most flights lack scheduled times
  const dirTimeKey = dir === 'departures' ? 'departure' : 'arrival';
  let sparseCount = 0;
  const qualityFiltered: any[] = [];
  for (const fl of allUAFlights) {
    const schedTime = fl.time?.scheduled?.[dirTimeKey];
    if (schedTime && schedTime > 0) {
      qualityFiltered.push(fl);
    } else {
      sparseCount++;
    }
  }

  if (allUAFlights.length > 0 && sparseCount / allUAFlights.length > 0.5) {
    console.warn(`Official FR24 API: ${sparseCount}/${allUAFlights.length} flights for ${logHub} ${dir} lack scheduled times — rejecting as sparse`);
    return null; // fall through to scraping fallback
  }

  const elapsedMs = Date.now() - startTime;
  console.log(`Official FR24 API: ${allRawFlights.length} total flights (${totalPages} pages), ${qualityFiltered.length} ${dir} for ${logHub} in ${elapsedMs}ms${sparseCount > 0 ? ` (${sparseCount} sparse filtered)` : ''}`);

  return {
    flights: qualityFiltered,
    total: qualityFiltered.length,
    totalFetched: allRawFlights.length,
    pagesScanned: totalPages,
    totalPages,
    cached: false,
    partial: officialPartial,
    hub: logHub,
    dir,
    meta: {
      partialReason,
      pagesRequested: totalPages,
      pagesSucceeded: Math.max(0, totalPages - pagesFailed),
      pagesFailed,
      missingPages: [] as number[],
      completeness: officialPartial ? 0.9 : 1,
      elapsedMs,
      source: 'official-api',
      sparseFiltered: sparseCount
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

  // ── Source routing decision tree ──
  const srcPriority = (process.env.SCHEDULE_SOURCE_PRIORITY || 'scrape').toLowerCase();

  if (!['scrape', 'official', 'scrape-only'].includes(srcPriority)) {
    console.warn(`Unrecognized SCHEDULE_SOURCE_PRIORITY: '${srcPriority}', using scrape-only`);
  }

  if (srcPriority === 'official' && process.env.FR24_API_TOKEN) {
    try {
      const officialTimeout = Math.min(Math.floor((effectiveDeadline - Date.now()) * 0.7), 45000);
      const officialResult = await fetchViaOfficialAPI(logHub, dir, ts, officialTimeout);
      if (officialResult) return officialResult;
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

  function processPage(sched: any): boolean {
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
  const firstPage = await fetchOnePage(logHub, dir, ts, 1, deadline);
  if (!firstPage || firstPage._rateLimited) {
    // Targeted rescue: only spend official credits for missing high-priority windows.
    if (srcPriority === 'scrape' && allowTargetedOfficialRescue) {
      console.log(`Scraping failed on first page for ${logHub} ${dir}, trying official API fallback`);
      const fallback = await tryOfficialFallback(logHub, dir, ts, effectiveDeadline);
      if (fallback) return fallback;
    }
    return { flights: [], total: 0, totalFetched: 0, pagesScanned: 0, totalPages: 1, cached: false, partial: true, hub: logHub, dir,
      meta: { partialReason: 'first_page_failed', pagesRequested: 1, pagesSucceeded: 0, pagesFailed: 1, missingPages: [1], completeness: 0, elapsedMs: Date.now() - startTime, source: 'scraping' as const }
    };
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
        batchPages.map(p => fetchOnePage(logHub, dir, ts, p, deadline))
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
        retryBatch.map(p => fetchOnePage(logHub, dir, ts, p, deadline))
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
      source: 'scraping' as const
    }
  };

  let attemptedOfficialRescue = false;
  if (
    srcPriority === 'scrape' &&
    allowTargetedOfficialRescue &&
    stoppedForHeavyRateLimit &&
    Date.now() < deadline - MIN_REMAINING_MS_FOR_OFFICIAL_RESCUE
  ) {
    attemptedOfficialRescue = true;
    console.log(`Scraping hit repeated FR24 rate limits for ${logHub} ${dir}, trying official API fallback`);
    const fallback = await tryOfficialFallback(logHub, dir, ts, effectiveDeadline);
    if (fallback) return fallback;
  }

  // Scrape-first fallback: if scraping failed completely, try official API (with circuit breaker)
  if (!attemptedOfficialRescue && srcPriority === 'scrape' && allowTargetedOfficialRescue && scrapeResult.total === 0 && scrapeResult.partial) {
    console.log(`Scraping returned 0 flights for ${logHub} ${dir}, trying official API fallback`);
    const fallback = await tryOfficialFallback(logHub, dir, ts, effectiveDeadline);
    if (fallback) return fallback;
  }

  return scrapeResult;
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
      const sched = await fetchOnePage(hub, dir, ts, pageNum);
      if (!sched) {
        return res.status(502).json({ error: 'Upstream service unavailable' });
      }
      cacheSet(cacheKey, sched, ttl);
      res.setHeader('Cache-Control', `s-maxage=${cdnMaxAge}, stale-while-revalidate=${swr}`);
      return res.status(200).json({ ...sched, cached: false });
    }

    // Aggregation mode
    const currentAggKey = `agg:${hub}:${dir}:${ts}`;
    aggKey = currentAggKey;

    const cached = cacheGet(currentAggKey);
    if (cached) {
      res.setHeader('Cache-Control', `s-maxage=${cdnMaxAge}, stale-while-revalidate=${swr}`);
      return res.status(200).json({ ...cached.data, cached: true });
    }

    const stale = cacheGetStale(currentAggKey);
    if (stale && !stale.data.partial) {
      triggerBackgroundRefresh(hub, dir, ts, currentAggKey, ttl, { allowTargetedOfficialRescue: false });
      res.setHeader('Cache-Control', `s-maxage=60, stale-while-revalidate=${swr}`);
      return res.status(200).json({ ...stale.data, cached: true, stale: true });
    }

    const exactLastComplete = getLastComplete(currentAggKey);
    const fallbackComplete = exactLastComplete || getLastCompleteByHubDir(hub, dir, ts);
    if (fallbackComplete) {
      triggerBackgroundRefresh(hub, dir, ts, currentAggKey, ttl, { allowTargetedOfficialRescue: false });
      res.setHeader('Cache-Control', `s-maxage=60, stale-while-revalidate=${swr}`);
      return res.status(200).json(buildDegradedResponse(fallbackComplete, exactLastComplete ? 'exact' : 'hub_dir'));
    }

    const persistentFallback = await getPersistentFallback(currentAggKey);
    if (persistentFallback) {
      triggerBackgroundRefresh(hub, dir, ts, currentAggKey, ttl, {
        allowTargetedOfficialRescue: persistentFallback.fallbackScope === 'persistent_partial'
      });
      res.setHeader('Cache-Control', `s-maxage=60, stale-while-revalidate=${swr}`);
      return res.status(200).json(buildDegradedResponse(persistentFallback, persistentFallback.fallbackScope));
    }

    if (pendingAggs.has(currentAggKey)) {
      const result = await pendingAggs.get(currentAggKey);
      if (result) {
        res.setHeader('Cache-Control', `s-maxage=${cdnMaxAge}, stale-while-revalidate=${swr}`);
        return res.status(200).json({ ...result, cached: true });
      }
    }

    const aggPromise = fetchAllPages(hub, dir, ts, undefined, functionDeadline, {
      allowTargetedOfficialRescue: true
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
      }
      res.setHeader('Cache-Control', `s-maxage=${cdnMaxAge}, stale-while-revalidate=${swr}`);
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
