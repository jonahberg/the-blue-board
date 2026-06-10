import { waitUntil } from '@vercel/functions';
import { HUB_TZ } from './irops.js';
import { icaoToIata, isInternationalRoute } from '../src/lib/airport-metadata.js';
import { getHubTerminal } from './_hubs.js';
import { hydrateAdbSpend, isAdbBudgetExhausted, recordAdbUnits, getAdbUnitsToday, getAdbDailyUnitBudget } from './_cost-state.js';

const AERODATABOX_BASE_URL = 'https://prod.api.market/api/v1/aedbx/aerodatabox';
// Each FIDS window request is billed at 2 units by the provider (1 board = 2 windows = 4 units).
const ADB_UNITS_PER_REQUEST = 2;
// Budget-exempt (cron-forced) calls still hit an absolute ceiling at 3x the organic budget so a
// leaked cron secret cannot spend unboundedly; the warm ring's own cadence keeps normal forced
// spend far below this.
const ADB_BYPASS_CEILING_MULTIPLIER = 3;

// Persist the spend write even if Vercel freezes the lambda right after the response is sent —
// a dropped RPC undercounts the cross-instance counter that IS the global spend ceiling.
function recordAdbUnitsDurable(units: number): void {
  const promise = recordAdbUnits(units);
  try {
    waitUntil(promise);
  } catch {
    // Outside a Vercel request context (tests, local scripts) waitUntil may throw; the promise
    // still runs to completion in-process.
  }
}

function partsToObj(parts: Intl.DateTimeFormatPart[]): Record<string, string> {
  const o: Record<string, string> = {};
  for (const p of parts) o[p.type] = p.value;
  if (o.hour === '24') o.hour = '00';
  return o;
}

function hubLocalDate(hub: string, ts: number): string {
  const tz = HUB_TZ[hub.toUpperCase()] || 'America/New_York';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(ts * 1000));
  const p = partsToObj(parts);
  return `${p.year}-${p.month}-${p.day}`;
}

function normalizeAirportCode(airport: any): string {
  const iata = String(airport?.iata || '').trim().toUpperCase();
  if (iata) return iata;
  return icaoToIata(String(airport?.icao || '').trim().toUpperCase());
}

function airportName(airport: any): string {
  return String(airport?.name || airport?.shortName || airport?.municipalityName || '').trim();
}

function normalizeFlightId(value: any): string {
  return String(value || '').trim().replace(/\s+/g, '').toUpperCase();
}

function normalizeUnitedFlightNumber(number: any, callSign?: any): string {
  const primary = normalizeFlightId(number);
  const fallback = normalizeFlightId(callSign);
  const value = primary || fallback;
  if (!value) return '';
  const ual = /^UAL(\d+[A-Z]?)$/.exec(value);
  if (ual) return `UA${ual[1]}`;
  const ua = /^UA(\d+[A-Z]?)$/.exec(value);
  if (ua) return `UA${ua[1]}`;
  return value;
}

function toUnixDateTime(value: any): number | null {
  if (!value) return null;
  if (typeof value === 'number') return value > 1e12 ? Math.floor(value / 1000) : Math.floor(value);
  if (typeof value === 'string') {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric > 1e12 ? Math.floor(numeric / 1000) : Math.floor(numeric);
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null;
  }
  return toUnixDateTime(value.utc || value.local);
}

function mapAeroStatus(status: any) {
  const s = String(status || '').trim();
  let text = 'scheduled';
  let type = '';
  let diverted = false;
  let live = false;
  let icon = '';

  if (s === 'Canceled' || s === 'CanceledUncertain') {
    type = 'canceled';
    text = 'canceled';
    icon = 'red';
  } else if (s === 'Diverted') {
    diverted = true;
    text = 'landed';
    icon = 'red';
  } else if (s === 'Arrived') {
    text = 'landed';
    icon = 'green';
  } else if (s === 'EnRoute' || s === 'Approaching') {
    text = 'en-route';
    live = true;
    icon = 'green';
  } else if (s === 'Departed') {
    text = 'departed';
    live = true;
    icon = 'green';
  } else if (s === 'Delayed') {
    text = 'estimated';
    icon = 'yellow';
  }

  return {
    generic: { status: { text, diverted }, type },
    text: s.toLowerCase(),
    icon,
    live,
  };
}

function isUnitedFlight(flight: any): boolean {
  if (flight?.isCargo === true) return false;
  const airlineIata = normalizeFlightId(flight?.airline?.iata);
  const airlineIcao = normalizeFlightId(flight?.airline?.icao);
  const number = normalizeFlightId(flight?.number);
  const callSign = normalizeFlightId(flight?.callSign);
  return (
    airlineIata === 'UA' ||
    airlineIcao === 'UAL' ||
    /^UA\d/.test(number) ||
    /^UAL\d/.test(number) ||
    /^UAL\d/.test(callSign)
  );
}

function normalizeFlight(flight: any, hub: string, dir: string) {
  if (!isUnitedFlight(flight)) return null;

  const hubUpper = hub.toUpperCase();
  const isDeparture = dir === 'departures';
  const departure = flight?.departure;
  const arrival = flight?.arrival;
  const movement = flight?.movement;

  let originAirport = departure?.airport || (isDeparture && departure ? { iata: hubUpper, name: hubUpper } : null);
  let destinationAirport = arrival?.airport || (!isDeparture && arrival ? { iata: hubUpper, name: hubUpper } : null);
  let departureMovement = departure;
  let arrivalMovement = arrival;

  if (!departure && !arrival && movement) {
    if (isDeparture) {
      originAirport = { iata: hubUpper, name: hubUpper };
      destinationAirport = movement.airport;
      departureMovement = movement;
      arrivalMovement = null;
    } else {
      originAirport = movement.airport;
      destinationAirport = { iata: hubUpper, name: hubUpper };
      departureMovement = null;
      arrivalMovement = movement;
    }
  }

  const origIata = normalizeAirportCode(originAirport);
  const destIata = normalizeAirportCode(destinationAirport);
  if (isDeparture && origIata !== hubUpper) return null;
  if (!isDeparture && destIata !== hubUpper) return null;

  const flightNum = normalizeUnitedFlightNumber(flight?.number, flight?.callSign);
  if (!flightNum) return null;

  const schedDep = toUnixDateTime(departureMovement?.scheduledTime);
  const schedArr = toUnixDateTime(arrivalMovement?.scheduledTime);
  const revisedDep = toUnixDateTime(departureMovement?.revisedTime);
  const revisedArr = toUnixDateTime(arrivalMovement?.revisedTime);
  const runwayDep = toUnixDateTime(departureMovement?.runwayTime);
  const runwayArr = toUnixDateTime(arrivalMovement?.runwayTime);

  const status = String(flight?.status || '');
  const departedLike = ['Departed', 'EnRoute', 'Approaching', 'Arrived', 'Diverted'].includes(status);
  const arrivedLike = ['Arrived', 'Diverted'].includes(status);
  const realDep = departedLike ? (runwayDep || revisedDep) : null;
  const realArr = arrivedLike ? (runwayArr || revisedArr) : null;
  const estDep = !realDep ? (revisedDep || toUnixDateTime(departureMovement?.predictedTime)) : null;
  const estArr = !realArr ? (revisedArr || toUnixDateTime(arrivalMovement?.predictedTime)) : null;

  const origGate = String(departureMovement?.gate || '').trim();
  const destGate = String(arrivalMovement?.gate || '').trim();
  const origTerminalRaw = String(departureMovement?.terminal || '').trim();
  const destTerminalRaw = String(arrivalMovement?.terminal || '').trim();
  const intl = isInternationalRoute(origIata, destIata);
  const origTerminal = origTerminalRaw || getHubTerminal(origIata, intl);
  const destTerminal = destTerminalRaw || getHubTerminal(destIata, intl);

  return {
    identification: { number: { default: flightNum }, callsign: normalizeFlightId(flight?.callSign) },
    airline: { code: { iata: 'UA' }, name: flight?.airline?.name || 'United Airlines' },
    status: mapAeroStatus(status),
    time: {
      scheduled: { departure: schedDep, arrival: schedArr },
      real: { departure: realDep, arrival: realArr },
      estimated: { departure: estDep, arrival: estArr },
    },
    airport: {
      origin: {
        code: { iata: origIata },
        name: airportName(originAirport),
        info: { gate: origGate, terminal: origTerminal },
      },
      destination: {
        code: { iata: destIata },
        name: airportName(destinationAirport),
        info: { gate: destGate, terminal: destTerminal },
      },
    },
    aircraft: {
      model: { code: '', text: flight?.aircraft?.model || '' },
      registration: flight?.aircraft?.reg || '',
    },
    _source: {
      provider: 'aerodatabox',
      quality: [
        ...(departureMovement?.quality || []),
        ...(arrivalMovement?.quality || []),
        ...(movement?.quality || []),
      ],
    },
  };
}

async function fetchWindow(
  hub: string,
  dir: string,
  fromLocal: string,
  toLocal: string,
  timeoutMs: number
): Promise<{ ok: true; flights: any[] } | { ok: false }> {
  const token = process.env.AERODATABOX_API_KEY;
  if (!token) return { ok: false };

  const base = (process.env.AERODATABOX_BASE_URL || AERODATABOX_BASE_URL).replace(/\/+$/, '');
  const direction = dir === 'departures' ? 'Departure' : 'Arrival';
  const url = new URL(
    `${base}/flights/airports/iata/${encodeURIComponent(hub.toUpperCase())}/${encodeURIComponent(fromLocal)}/${encodeURIComponent(toLocal)}`
  );
  url.searchParams.set('direction', direction);
  url.searchParams.set('withLeg', 'true');
  url.searchParams.set('withCancelled', 'true');
  url.searchParams.set('withCodeshared', 'true');
  url.searchParams.set('withCargo', 'false');
  url.searchParams.set('withPrivate', 'false');
  url.searchParams.set('withLocation', 'false');

  // Support both AeroDataBox gateways: RapidAPI (x-rapidapi-key + x-rapidapi-host) and
  // api.market (x-magicapi-key). Detected from the base host so a single AERODATABOX_API_KEY +
  // AERODATABOX_BASE_URL pair works for either.
  const isRapidApi = /rapidapi\.com/i.test(base);
  const headers: Record<string, string> = {
    'Accept': 'application/json',
    'User-Agent': 'TheBlueBoardDashboard/1.0 (https://theblueboard.co)',
  };
  if (isRapidApi) {
    headers['x-rapidapi-key'] = token;
    try { headers['x-rapidapi-host'] = new URL(base).host; } catch { headers['x-rapidapi-host'] = 'aerodatabox.p.rapidapi.com'; }
  } else {
    headers['x-magicapi-key'] = token;
  }

  // Free RapidAPI plans throttle by requests-per-second, so a busy hub's window can get a 429 even
  // with the inter-window gap (concurrent cron/user traffic competes for the same per-second budget).
  // Retry 429/503 a couple of times, honoring Retry-After, so a transient throttle doesn't leave the
  // board permanently half-empty.
  const deadline = Date.now() + timeoutMs;
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const remaining = deadline - Date.now();
    if (remaining < 800) break;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(remaining, 15000));
    try {
      // Count spend per request actually fired (retries bill too), before reading the outcome —
      // a 429 storm then exhausts the budget quickly, which is exactly the circuit we want.
      recordAdbUnitsDurable(ADB_UNITS_PER_REQUEST);
      const resp = await fetch(url, { signal: controller.signal, headers });
      clearTimeout(timer);

      if (resp.status === 204) return { ok: true, flights: [] };
      if (resp.status === 429 || resp.status === 503) {
        const body = await resp.text().catch(() => '');
        const retryAfter = Number(resp.headers.get('retry-after'));
        const backoff = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1500 * attempt;
        if (attempt < maxAttempts && deadline - Date.now() > backoff + 800) {
          console.warn(`AeroDataBox ${resp.status} for ${hub} ${dir} (attempt ${attempt}); retrying in ${backoff}ms`);
          await new Promise((r) => setTimeout(r, backoff));
          continue;
        }
        // Surface WHY we gave up so a monthly-quota wall is distinguishable from a per-second
        // throttle (the body/headers were previously discarded, hiding quota exhaustion in the logs).
        const quotaRemaining =
          resp.headers.get('x-ratelimit-requests-remaining') ??
          resp.headers.get('x-ratelimit-rapid-free-plans-hard-limit-remaining') ??
          resp.headers.get('x-ratelimit-remaining') ??
          '?';
        console.error(
          `AeroDataBox schedule gave up: ${resp.status} for ${hub} ${dir} after ${attempt} attempt(s) — quota-remaining=${quotaRemaining} body=${body.slice(0, 200)}`
        );
        return { ok: false };
      }
      if (!resp.ok) {
        const body = await resp.text().catch(() => '');
        console.error(`AeroDataBox schedule returned ${resp.status} for ${hub} ${dir}: ${body.slice(0, 200)}`);
        return { ok: false };
      }

      const data = await resp.json() as any;
      const flights = dir === 'departures' ? (data?.departures || []) : (data?.arrivals || []);
      return { ok: true, flights: Array.isArray(flights) ? flights : [] };
    } catch (e: any) {
      clearTimeout(timer);
      if (e.name === 'AbortError') {
        console.error(`AeroDataBox schedule timeout for ${hub} ${dir}`);
        return { ok: false };
      }
      console.error(`AeroDataBox schedule error for ${hub} ${dir}:`, e.message);
      return { ok: false };
    }
  }
  return { ok: false };
}

export async function fetchViaAeroDataBox(
  hub: string,
  dir: string,
  ts: number,
  timeoutMs = 12000,
  opts: { bypassDailyBudget?: boolean } = {}
) {
  if (!process.env.AERODATABOX_API_KEY) return null;

  // Cross-instance daily spend stop: behave exactly as if the provider were unconfigured so
  // callers fall through to their existing degraded paths instead of burning more quota.
  // Authorized cron warms bypass the organic gate — their spend is hard-bounded by the warm ring
  // itself (~288 units/day) and they are the one path that keeps boards from freezing, so organic
  // traffic must never starve them. Their units are still recorded against the organic budget,
  // and they keep a 3x absolute ceiling so a leaked cron secret cannot spend unboundedly. Both
  // gates hydrate first: an unhydrated ceiling reads a cold instance's 0 and is per-instance
  // theater under fan-out (the hydrate is rate-limited to one Supabase read per 10s).
  await hydrateAdbSpend();
  if (opts.bypassDailyBudget) {
    if (getAdbUnitsToday() >= getAdbDailyUnitBudget() * ADB_BYPASS_CEILING_MULTIPLIER) {
      console.error(
        `AeroDataBox bypass ceiling hit (${getAdbUnitsToday()}/${getAdbDailyUnitBudget() * ADB_BYPASS_CEILING_MULTIPLIER}); refusing forced fetch for ${hub} ${dir}`
      );
      return null;
    }
  } else if (isAdbBudgetExhausted()) {
    console.warn(
      `AeroDataBox daily unit budget exhausted (${getAdbUnitsToday()}/${getAdbDailyUnitBudget()}); skipping ${hub} ${dir} until next UTC day`
    );
    return null;
  }

  const startTime = Date.now();
  const date = hubLocalDate(hub, ts);
  const windows = [
    [`${date}T00:00`, `${date}T11:59`],
    [`${date}T12:00`, `${date}T23:59`],
  ];

  const rawFlights: any[] = [];
  const failedWindows: number[] = [];
  // Free RapidAPI plans throttle by requests-per-second, so pause between the sequential window
  // calls. Reserve that pause out of the budget when sizing each window's timeout.
  const interWindowDelayMs = Math.max(0, Number(process.env.AERODATABOX_INTER_WINDOW_DELAY_MS ?? 1100) || 0);
  const reserved = interWindowDelayMs * (windows.length - 1);
  const perWindowTimeout = Math.max(2000, Math.floor((timeoutMs - reserved) / windows.length));

  for (let i = 0; i < windows.length; i++) {
    if (i > 0 && interWindowDelayMs > 0) {
      await new Promise((r) => setTimeout(r, interWindowDelayMs));
    }
    const [fromLocal, toLocal] = windows[i];
    const result = await fetchWindow(hub, dir, fromLocal, toLocal, perWindowTimeout);
    if (result.ok) {
      rawFlights.push(...result.flights);
    } else {
      failedWindows.push(i + 1);
    }
  }

  const seen = new Set<string>();
  const flights: any[] = [];
  for (const raw of rawFlights) {
    const normalized = normalizeFlight(raw, hub, dir);
    if (!normalized) continue;
    const scheduleKey = dir === 'departures'
      ? normalized.time?.scheduled?.departure
      : normalized.time?.scheduled?.arrival;
    const key = `${normalized.identification?.number?.default || ''}:${scheduleKey || ''}:${normalized.airport?.origin?.code?.iata || ''}:${normalized.airport?.destination?.code?.iata || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    flights.push(normalized);
  }

  const partial = failedWindows.length > 0;
  const pagesRequested = windows.length;
  const pagesFailed = failedWindows.length;
  const pagesSucceeded = pagesRequested - pagesFailed;

  return {
    flights,
    total: flights.length,
    totalFetched: rawFlights.length,
    pagesScanned: pagesRequested,
    totalPages: pagesRequested,
    cached: false,
    partial,
    hub,
    dir,
    meta: {
      partialReason: partial ? 'provider_partial' : null,
      pagesRequested,
      pagesSucceeded,
      pagesFailed,
      missingPages: failedWindows,
      completeness: pagesRequested > 0 ? Math.round((pagesSucceeded / pagesRequested) * 100) / 100 : 1,
      elapsedMs: Date.now() - startTime,
      source: 'aerodatabox',
    },
  };
}
