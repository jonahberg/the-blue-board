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
  /** The marketing carrier, 'UA' or '' (`api/_starlink-normalize.ts`). */
  airline?: string;
  origin?: string;
  destination?: string;
  /** Unix SECONDS — the whole board's clock. */
  departure_ts?: number;
  departure_time?: string;
  arrival_time?: string;
};

export type FlightsByTail = Record<string, StarlinkFlight[]>;

/**
 * The fleet database by registration (`useFleet().fleetByReg`), as `fleetTypeCodeForTail` reads it:
 * the type a tail really is, whatever the tracker prints. Null before it has loaded.
 */
export type FleetByReg = Record<string, { t?: string }> | null;

/** One row of `buildDeparturesBoard()`'s bucket lists (`src/lib/starlink-utils.js`). */
export type BoardRow = {
  tail: string;
  flight_number: string;
  /** The leg's marketing carrier as the feed sent it, 'UA' or ''. */
  airline: string;
  origin: string;
  destination: string;
  departure_ts: number;
  departure_time: string;
  arrival_time: string;
  type: string;
  fleet: string;
  operator: string;
  /** True only on the leg the aircraft is flying right now — one row per tail at most. */
  airborne: boolean;
  /** The live flight's ICAO24 on the airborne row; '' on every other row. */
  icao24: string;
  /** Set when the tail is airborne on a DIFFERENT leg (its inbound): what it is flying now. */
  inbound: { flight: string; icao24: string } | null;
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
