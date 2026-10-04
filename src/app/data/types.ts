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
  /** FR24 projected this position (receiver "F-EST", out of range — usually over an ocean). */
  positionEstimated?: boolean;
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

/**
 * One United Express tail from `/api/express-fleet` (sql/018_express_tails.sql): seen flying a
 * United flight in the last `staleDays` days.
 */
export type ExpressTail = {
  /** Registration. */
  r: string;
  /** Operator ICAO code: SKW / RPA / GJS / UCA / ASH / AWI. */
  op: string;
  /** Live-feed type designator (E75L, CRJ7 …), when the feed has reported one. */
  ft: string | null;
  /** Schedule-board model code (E175, CRJ2 …), when a board has listed one. */
  m: string | null;
  /** Last United flight number seen (UA5575, G73375 …). */
  lf: string | null;
  /** First / last seen, ISO. */
  fs: string;
  ls: string;
};

export type ExpressFleetResponse = {
  tails: ExpressTail[];
  staleDays: number;
  generatedAt: string;
  /** Set, with `tails: []`, when the table could not be read. */
  note?: string;
};

/**
 * One entry of the dashboard's United Express fleet — `buildExpressFleet()` in
 * `src/lib/express-fleet.js`. Shaped like a `/data/fleet.json` row where the fields overlap.
 */
export type ExpressAircraft = {
  r: string;
  /** Display type ('E175', 'CRJ700/550'), '' when unknown. */
  t: string;
  /** Type key for the cabin lookup, '' when unknown. */
  tk: string;
  /** Operator name ('SkyWest Airlines'), '' when unknown. */
  o: string;
  /** Operator ICAO code. */
  oc: string;
  /** 'Starlink' when the Starlink roster lists the tail; otherwise '' (unknown, not "none"). */
  w: 'Starlink' | '';
  /** Verified cabin layout, '' when not known. */
  c: string;
  seats?: Record<string, number>;
  tot?: number;
  fs: string;
  ls: string;
  lf: string;
  x: true;
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
  /** Set when no schedule board lists the flight and only FR24 identity is known (F1). */
  timesUnavailable?: boolean;
  departure: { gate: TimeTriple; takeoff: TimeTriple };
  arrival: {
    gate: TimeTriple;
    landing: TimeTriple;
    /** Client-side only: 'live' when `reconcileLiveArrival()` replaced the gate estimate (D1). */
    etaSource?: 'live';
    /** The provider estimate the live ETA overrode. */
    providerEstimate?: string;
  };
  origin: FlightTimesEndpoint;
  destination: FlightTimesEndpoint;
};

export type IropsHubMetrics = Record<
  string,
  {
    total?: number;
    operated?: number;
    onTime?: number;
    cancellations?: number;
    /** The unconfirmed part of `cancellations` ("Likely Canceled", not seen flying) — v1.12.0. */
    cancellationsLikely?: number;
    /** "Likely Canceled" flights the live feed saw fly; not in `cancellations` — v1.12.0. */
    likelyCanceledSeenFlying?: number;
    /** The source board's `meta.generatedAt`, Unix seconds (F91). */
    generatedAt?: number | null;
    /** Seconds between that board and the irops run. */
    dataAgeSec?: number | null;
  }
>;

export type IropsData = {
  score: number;
  /** Confirmed + likely (unconfirmed, not seen flying); the number the score weights ×3. */
  cancellations: number;
  /** The unconfirmed part of `cancellations`. Absent on payloads from before v1.12.0. */
  cancellationsLikely?: number;
  /** "Likely Canceled" flights the live feed saw fly — not cancellations. Absent before v1.12.0. */
  likelyCanceledSeenFlying?: number;
  delayed30: number;
  delayed60: number;
  diversions: number;
  totalFlights: number;
  hubMetrics: IropsHubMetrics;
  /** Age of the oldest hub board behind these metrics, seconds (F91). */
  oldestHubAgeSec?: number | null;
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
  /** /api/schedule stamps Unix seconds; an ISO string is tolerated (see boardAsOfMs). */
  generatedAt?: number | string;
  hubDisruptionMinutes?: number;
  /** Empty because the provider's daily budget held the fetch back: "not loaded yet", not a failure. */
  providerDeferred?: boolean;
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
/**
 * `bb_watched_flights` entry. `dep` (the followed leg's scheduled departure, epoch seconds) and
 * `delayBucket` (the delay band already announced) were added Oct 2026 and are absent on older
 * entries; every reader treats them as optional.
 */
export type WatchedFlight = { flight: string; route: string; status: string; ts: number; dep?: number; delayBucket?: number };

/**
 * `/api/airborne-history` — one row per successful 5-minute live-feed read, oldest first. A gap in
 * `t` is a missing read (never a zero). `note` is set, with `samples: []`, when history is
 * unavailable (Supabase down, table not yet created).
 */
export type AirborneHistory = {
  samples: { t: string; airborne: number; express?: number }[];
  hours: number;
  since: string;
  generatedAt: string;
  note?: string;
};
