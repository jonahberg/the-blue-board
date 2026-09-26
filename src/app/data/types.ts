/**
 * Domain types for the dashboard island.
 *
 * These describe the shapes the `/api/*` endpoints actually return (inventory §28) and the
 * objects `src/lib/*.js` passes around. The logic modules stay plain JS with JSDoc — this
 * file exists so the TSX side gets real narrowing instead of `any` at every call site.
 */

/** One aircraft from `/api/fr24-feed`, as `parseFr24Feed()` in `src/lib/feed-health.js` shapes it. */
export type Flight = {
  fr24id: string;
  icao24: string;
  /** Degrees. */
  lat: number;
  lon: number;
  /** Track, degrees. */
  hdg: number;
  /** Metres — the feed's feet are converted on parse. */
  alt: number;
  /** Metres/second. */
  spd: number;
  /** Metres/second. */
  vr: number;
  squawk: string | null;
  acType: string;
  reg: string;
  origin: string;
  dest: string;
  flightIATA: string;
  onGround: boolean;
  callsign: string;
  airline: string;
};

/** A row of `/data/fleet.json`. */
export type FleetAircraft = {
  /** Registration. */
  r: string;
  /** Type. */
  t: string;
  /** Age / delivery year. */
  a?: string | number;
  /** Cabin config label. */
  c?: string;
  /** Total seats. */
  tot?: number;
  /** WiFi. */
  w?: string;
  /** IFE. */
  i?: string;
  /** Delivery date. */
  d?: string;
  /** Status. */
  s?: string;
  /** Power. */
  p?: string;
  seats?: Record<string, number>;
};

export type StarlinkAircraft = {
  tail: string;
  fleet?: string;
  type?: string;
  operator?: string;
  dateFound?: string;
};

export type StarlinkFleetStats = {
  mainline: number;
  express: number;
  total: number;
  mainlineTotal: number;
  expressTotal: number;
  mainlinePct: number;
  expressPct: number;
};

export type StarlinkData = {
  aircraft: StarlinkAircraft[];
  flightsByTail: Record<string, unknown>;
  fleetStats: StarlinkFleetStats | null;
  lastUpdated: string | null;
  syncedAt: string | null;
};

export type FleetSummary = {
  airlines: { code: string; name: string; installed: number; total: number; percentage: number }[];
};

/** One of the four `{actual, estimated, scheduled}` triples in `/api/flight-times`. */
export type TimeTriple = {
  actual?: string | null;
  estimated?: string | null;
  scheduled?: string | null;
};

export type FlightTimesEndpoint = {
  iata?: string;
  terminal?: string | null;
  gate?: string | null;
  tz?: string | null;
  name?: string | null;
};

export type FlightTimes = {
  success: boolean;
  source?: string;
  registration?: string | null;
  aircraft?: string | null;
  cancelled?: boolean;
  diverted?: boolean;
  status?: string;
  error?: string;
  departure: { gate: TimeTriple; takeoff: TimeTriple };
  arrival: { gate: TimeTriple; landing: TimeTriple };
  origin: FlightTimesEndpoint;
  destination: FlightTimesEndpoint;
};

export type IropsHubMetrics = Record<
  string,
  { total?: number; operated?: number; onTime?: number; cancellations?: number }
>;

export type IropsData = {
  score: number;
  cancellations: number;
  delayed30: number;
  delayed60: number;
  diversions: number;
  totalFlights: number;
  hubMetrics: IropsHubMetrics;
};

export type FaaAirport = {
  airportCode: string;
  delays?: unknown[];
  programs?: unknown[];
  runwayConfig?: unknown;
  deicing?: unknown;
  notam?: unknown;
  groundStop?: unknown;
  groundDelay?: unknown;
  departureDelay?: unknown;
  arrivalDelay?: unknown;
  closure?: unknown;
};

/** `buildFaaIndex()` output: airport code → its raw FAA record. */
export type FaaIndex = Record<string, FaaAirport>;

export type NasData = {
  active: unknown[];
  planned: unknown[];
  advisoryUrl?: string;
};

export type MetarRecord = {
  icaoId: string;
  rawOb?: string;
  fltCat?: string;
  temp?: number;
  wspd?: number;
  wdir?: number;
  visib?: number | string;
  clouds?: unknown[];
  cover?: string;
};

export type ScheduleMeta = {
  dataAge?: number;
  completeness?: number;
  partialReason?: string;
  pagesFailed?: number;
  liveFeedFallbackAdded?: number;
  generatedAt?: string;
  hubDisruptionMinutes?: number;
};

export type ScheduleResponse = {
  flights: Record<string, unknown>[];
  total?: number;
  cached?: boolean;
  partial?: boolean;
  degraded?: boolean;
  stale?: boolean;
  error?: string;
  meta?: ScheduleMeta;
  /** Server clock from the `Date` header minus `Age`, for board-time arbitration. */
  serverNowMs?: number;
};

export type PushConfig = { configured: boolean; vapidPublicKey?: string };

/** One entry of `bb_watched_flights` (storage contract, inventory §29 — do not reshape). */
export type WatchedFlight = { flight: string; route: string; status: string; ts: number };
