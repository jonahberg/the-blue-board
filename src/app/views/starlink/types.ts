/**
 * The two shapes the Starlink tab reads out of `/api/starlink-data` that the shared domain
 * types deliberately leave loose.
 *
 * `flightsByTail` is `Record<string, unknown>` in `data/types.ts` because nothing else in the
 * dashboard looks inside it — only this tab does, and only to build the departures board and
 * the roster's Next Flight column. Narrowing it here keeps the assertion at the one place
 * that actually knows the shape, rather than promising the whole island a contract upstream
 * has never versioned.
 */

/** One scheduled leg as the Starlink sync writes it. */
export type StarlinkFlight = {
  flight_number?: string;
  origin?: string;
  destination?: string;
  /** Unix SECONDS — the whole board's clock. */
  departure_ts?: number;
  departure_time?: string;
  arrival_time?: string;
};

export type FlightsByTail = Record<string, StarlinkFlight[]>;

/** One row of `buildDeparturesBoard()`'s bucket lists (`src/lib/starlink-utils.js`). */
export type BoardRow = {
  tail: string;
  flight_number: string;
  origin: string;
  destination: string;
  departure_ts: number;
  departure_time: string;
  arrival_time: string;
  type: string;
  fleet: string;
  operator: string;
  airborne: boolean;
  icao24: string;
  deltaSec: number;
};

export type BoardModel = {
  hubCounts: Record<string, number>;
  allCount: number;
  totalInWindow: number;
  buckets: { label: string; rows: BoardRow[] }[];
  shownCount: number;
  hiddenCount: number;
};

/** One disputed claim from `/api/starlink-mismatches`. */
export type DisputedClaim = {
  tail?: string;
  aircraft?: string;
  operator?: string;
  verifiedAs?: string;
  verifiedAt?: string;
  dateFound?: string;
};

export type VerifySummary = {
  verifiedStarlink?: number;
  disputed?: number;
  unverified?: number;
  totalPlanes?: number;
  generatedAt?: string;
};
