/**
 * Typed fetchers for every endpoint the dashboard calls (inventory §28).
 *
 * One place owns the URL, the query parameters and the response shape, so a param rename
 * is a compile error rather than a silent empty panel. Nothing here retries or caches —
 * the poll cadence, the retry ladder and the visibility pause live in the state providers,
 * because those are per-feed policy, not transport.
 *
 * In `astro dev` / `astro preview` these all resolve through the `/api` proxy configured in
 * `astro.config.mjs` (production origin); on Vercel they are the project's own functions.
 */

import { parseFr24Feed, parseStaleHeader } from '@/lib/feed-health.js';
import type {
  FaaAirport,
  FleetAircraft,
  FleetSummary,
  Flight,
  FlightTimes,
  IropsData,
  MetarRecord,
  NasData,
  PushConfig,
  ScheduleResponse,
  StarlinkAircraft,
  StarlinkData,
} from './types';

/** A non-2xx response, carrying the status so callers can tell 404 from 500. */
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function getJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { headers: { Accept: 'application/json' }, ...init });
  if (!res.ok) throw new ApiError(res.status, `${path} → HTTP ${res.status}`);
  return (await res.json()) as T;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  // POST endpoints answer with a JSON error body on 4xx (waitlist duplicate, delay-explain
  // budget) — parse first and let the caller decide, only throwing when there is no body.
  let data: T | null = null;
  try {
    data = (await res.json()) as T;
  } catch {
    data = null;
  }
  if (data === null) throw new ApiError(res.status, `${path} → HTTP ${res.status}`);
  return data;
}

/**
 * The live feed. A 200 carrying zero aircraft is never legitimate — United always has
 * hundreds airborne — so it is reported as a failure the same way a 5xx is, and the caller
 * keeps its last-good flights (inventory §18, `applyFeedResult`).
 *
 * `staleMs` comes from `X-BB-Feed-Stale` (seconds) and backdates the caller's last-good
 * timestamp so the LIVE/STALE chip stays honest about what it is showing.
 */
export async function fetchFr24Feed(
  signal?: AbortSignal,
): Promise<{ flights: Flight[]; staleMs: number }> {
  const res = await fetch('/api/fr24-feed?airline=UAL', {
    headers: { Accept: 'application/json' },
    signal,
  });
  if (!res.ok) throw new ApiError(res.status, `/api/fr24-feed → HTTP ${res.status}`);
  const staleMs = parseStaleHeader(res.headers.get('X-BB-Feed-Stale'));
  const flights = parseFr24Feed(await res.json()) as Flight[];
  if (flights.length === 0) throw new ApiError(res.status, 'Feed returned no aircraft');
  return { flights, staleMs };
}

export function fetchFlightTimes(flight: string, signal?: AbortSignal): Promise<FlightTimes> {
  return getJson<FlightTimes>(`/api/flight-times?flight=${encodeURIComponent(flight)}`, { signal });
}

export type PredictionResponse = {
  probability?: number;
  n_observations?: number;
  confidence?: string;
  error?: string;
};

export function fetchPredictFlight(flightNumber: string): Promise<PredictionResponse> {
  return getJson<PredictionResponse>(
    `/api/predict-flight?flight_number=${encodeURIComponent(flightNumber)}`,
  );
}

/** `date` is `YYYY-MM-DD`; `confidence: 'predicted'` marks a forecast rather than a reading. */
export function fetchCheckFlight(flightNumber: string, date: string): Promise<PredictionResponse> {
  return getJson<PredictionResponse>(
    `/api/check-flight?flight_number=${encodeURIComponent(flightNumber)}&date=${encodeURIComponent(date)}`,
  );
}

export function fetchStarlinkData(): Promise<StarlinkData> {
  return getJson<StarlinkData>('/api/starlink-data');
}

export function fetchFleetSummary(): Promise<FleetSummary> {
  return getJson<FleetSummary>('/api/fleet-summary');
}

export type StarlinkMismatches = {
  disputed: {
    tail: string;
    aircraft?: string;
    operator?: string;
    verifiedAs?: string;
    verifiedAt?: string;
    dateFound?: string;
  }[];
  summary?: Record<string, unknown>;
};

export function fetchStarlinkMismatches(): Promise<StarlinkMismatches> {
  return getJson<StarlinkMismatches>('/api/starlink-mismatches');
}

/** `ids` is a comma-separated ICAO station list; the endpoint normalises the AWC payload. */
export function fetchMetar(ids: string[]): Promise<MetarRecord[]> {
  return getJson<MetarRecord[]>(`/api/metar?ids=${encodeURIComponent(ids.join(','))}`);
}

export function fetchFaa(): Promise<FaaAirport[]> {
  return getJson<FaaAirport[]>('/api/faa');
}

export function fetchNas(): Promise<NasData> {
  return getJson<NasData>('/api/nas');
}

/**
 * A departure/arrival board. The `Date` and `Age` response headers give the board's server
 * clock, which the Schedule tab needs to classify "operated" without trusting the browser's
 * clock — so they are read here and returned as `serverNowMs`.
 */
export async function fetchSchedule(
  params: { hub: string; dir: string; timestamp: number },
  signal?: AbortSignal,
): Promise<ScheduleResponse> {
  const query = new URLSearchParams({
    hub: params.hub,
    dir: params.dir,
    timestamp: String(params.timestamp),
  });
  const res = await fetch(`/api/schedule?${query}`, {
    headers: { Accept: 'application/json' },
    signal,
  });
  if (!res.ok) throw new ApiError(res.status, `/api/schedule → HTTP ${res.status}`);
  const dateHeader = Date.parse(res.headers.get('Date') ?? '');
  const age = Number(res.headers.get('Age'));
  const data = (await res.json()) as ScheduleResponse;
  return {
    ...data,
    serverNowMs: Number.isFinite(dateHeader)
      ? dateHeader + (Number.isFinite(age) ? age * 1000 : 0)
      : undefined,
  };
}

export function fetchIrops(): Promise<IropsData> {
  return getJson<IropsData>('/api/irops');
}

export type AircraftHistory = {
  success: boolean;
  segments?: {
    flightNumber: string;
    origin: string;
    destination: string;
    delayMin?: number | null;
    status?: string;
  }[];
};

export function fetchAircraftHistory(reg: string): Promise<AircraftHistory> {
  return getJson<AircraftHistory>(`/api/aircraft-history?reg=${encodeURIComponent(reg)}`);
}

/** Never throws: a missing VAPID key must degrade to "push not offered", not an error state. */
export async function fetchPushConfig(): Promise<PushConfig> {
  try {
    return await getJson<PushConfig>('/api/push-subscribe');
  } catch {
    return { configured: false };
  }
}

export type PushSubscribeBody =
  | { action: 'unsubscribe'; subscription: { endpoint: string } }
  | {
      subscription: { endpoint: string; keys: Record<string, string> };
      watches: { flight: string }[];
    };

export function postPushSubscribe(body: PushSubscribeBody): Promise<{ success?: boolean }> {
  return postJson<{ success?: boolean }>('/api/push-subscribe', body);
}

export function postDelayExplain(
  body: Record<string, unknown>,
): Promise<{ explanation?: string; error?: string }> {
  return postJson<{ explanation?: string; error?: string }>('/api/delay-explain', body);
}

export function postWaitlist(body: {
  email: string;
  source: string;
  featureRequest?: string;
}): Promise<{ success?: boolean; error?: string }> {
  return postJson<{ success?: boolean; error?: string }>('/api/waitlist', body);
}

export type Fr24FlightLookup = {
  success: boolean;
  flight?: Record<string, unknown>;
  source?: string;
  cached?: boolean;
  error?: string;
  meta?: { liveLeg?: boolean; legDate?: string };
};

export function fetchFr24Flight(flight: string): Promise<Fr24FlightLookup> {
  return getJson<Fr24FlightLookup>(`/api/fr24-flight?flight=${encodeURIComponent(flight)}`);
}

export type SupportStats = {
  boards?: { used: number; budget: number };
  liveFeed?: { configured: boolean; usedPct?: number };
  monthlyCostNote?: string;
};

export function fetchSupportStats(): Promise<SupportStats> {
  return getJson<SupportStats>('/api/support-stats');
}

/** Static assets, not functions — same fetch discipline so callers have one import. */

export function fetchFleetDb(): Promise<FleetAircraft[]> {
  return getJson<FleetAircraft[]>('/data/fleet.json');
}

/** Fallback roster used when `/api/starlink-data` fails (degraded tier). */
export function fetchStarlinkFallback(): Promise<StarlinkAircraft[]> {
  return getJson<StarlinkAircraft[]>('/data/starlink.json');
}

export function fetchNewsLatest(): Promise<{ title: string; slug: string }[]> {
  return getJson<{ title: string; slug: string }[]>('/data/news-latest.json');
}
