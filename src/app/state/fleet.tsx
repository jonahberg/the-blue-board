/**
 * Fleet reference data: `/data/fleet.json`, `/api/starlink-data?fields=roster` and
 * `/api/fleet-summary`, loaded in parallel once per session (inventory §34 `loadFleetData()`).
 *
 * The Starlink per-tail schedules (`flightsByTail`, ~93% of the old 1 MB boot payload) are NOT
 * part of the boot: only the Starlink tab reads them, so it calls `loadStarlinkFlights()` when
 * it first opens and they arrive as `/api/starlink-data?fields=flights` (F58).
 *
 * Three things downstream depend on:
 *  - `fleetByReg` — the registration index `matchAircraft()` needs to turn a live feed row
 *    into an airframe (seat config, WiFi, IFE).
 *  - `starlink.tails` — a Set, because the map recolours every marker against it on each
 *    poll. When `/api/starlink-data` fails we fall back to the static `/data/starlink.json`
 *    roster and mark the tier `degraded`: in that state the Starlink filter and the
 *    "confirmed" badge must not claim more than the fallback can support.
 *  - `loadFailed` — the fleet panels show a retry state rather than an empty table.
 *  - `expressDb` / `expressByReg` — the United Express fleet (`/api/express-fleet` joined with
 *    the Starlink roster's Express entries, `buildExpressFleet`). Fetched alongside the others but
 *    never awaited by them: a slow or failed answer costs the Express details and nothing else,
 *    and `loading` / `loadFailed` stay about the mainline database. It is a SEPARATE index on
 *    purpose — `fleetDb`, `fleetByReg` and `matchAircraft()` stay mainline-only, so the
 *    "1,139 mainline" figure, utilisation and the Starlink counts never move.
 *
 * Starlink reconciliation (#249, ported from the legacy `loadFleetData()`): the roster gets the
 * evidence-backed tails the upstream tracker is missing (`applyVerifiedStarlinkOverrides`), and
 * the exposed `fleetDb` relabels `w` to 'Starlink' for every tail in that roster
 * (`applyStarlinkWifiOverlay`) — `/data/fleet.json` is a build artefact that lags retrofits, and
 * without this the WiFi column shows "ViaSat Ka" beside a Starlink badge.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { buildExpressFleet, indexExpressFleet } from '@/lib/express-fleet.js';
import { applyStarlinkWifiOverlay } from '@/lib/fleet-utils.js';
import { indexSpecialAircraft } from '@/lib/special-aircraft.js';
import { applyVerifiedStarlinkOverrides } from '@/lib/starlink-overrides.js';
import {
  fetchExpressFleet,
  fetchFleetDb,
  fetchFleetSummary,
  fetchStarlinkFallback,
  fetchStarlinkFlights,
  fetchStarlinkRoster,
} from '../data/api';
import type {
  ExpressAircraft,
  ExpressTail,
  FleetAircraft,
  FleetSummary,
  StarlinkAircraft,
  StarlinkData,
  StarlinkFleetStats,
} from '../data/types';

/** Registration → the fleet site's special-aircraft entry. */
export type SpecialIndex = Map<string, { name: string; type: 'named' | 'livery' }>;

export type StarlinkState = {
  /** Registrations known to carry Starlink. */
  tails: Set<string>;
  /** Empty until `loadStarlinkFlights()` has answered (see `flightsStatus`). */
  flightsByTail: Record<string, unknown>;
  /** The lazily loaded schedules: 'idle' until the Starlink tab asks for them. */
  flightsStatus: 'idle' | 'loading' | 'ready' | 'failed';
  stats: StarlinkFleetStats | null;
  aircraft: StarlinkAircraft[];
  lastUpdated: string | null;
  syncedAt: string | null;
  /** True when the live endpoint failed and the static roster is standing in. */
  degraded: boolean;
};

export type FleetValue = {
  fleetDb: FleetAircraft[];
  /** Registration → airframe. A plain object because `matchAircraft()` indexes it directly. */
  fleetByReg: Record<string, FleetAircraft>;
  starlink: StarlinkState;
  fleetSummary: FleetSummary | null;
  /** Registration → `{ name, type: 'named' | 'livery' }` for the ⭐ special aircraft. */
  special: SpecialIndex;
  loading: boolean;
  loadFailed: boolean;
  retry: () => void;
  /** Fetch the Starlink per-tail schedules once; later calls are no-ops unless it failed. */
  loadStarlinkFlights: () => void;
  /**
   * The United Express fleet, by registration order. Holds the roster's Express tails even
   * before (or without) `/api/express-fleet`. Never part of `fleetDb`.
   */
  expressDb: ExpressAircraft[];
  /** Registration → Express entry, for `matchExpress()`. */
  expressByReg: Record<string, ExpressAircraft>;
  /** `/api/express-fleet`: 'failed' means only the roster's Express tails are known. */
  expressStatus: 'loading' | 'ready' | 'failed';
};

const EMPTY_STARLINK: StarlinkState = {
  tails: new Set<string>(),
  flightsByTail: {},
  flightsStatus: 'idle',
  stats: null,
  aircraft: [],
  lastUpdated: null,
  syncedAt: null,
  degraded: false,
};

const FleetContext = createContext<FleetValue | null>(null);

export function useFleet(): FleetValue {
  const ctx = useContext(FleetContext);
  if (!ctx) throw new Error('useFleet() outside <FleetProvider>');
  return ctx;
}

export function FleetProvider({ children }: { children: ReactNode }) {
  const [rawFleetDb, setFleetDb] = useState<FleetAircraft[]>([]);
  const [starlink, setStarlink] = useState<StarlinkState>(EMPTY_STARLINK);
  const [fleetSummary, setFleetSummary] = useState<FleetSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [expressTails, setExpressTails] = useState<ExpressTail[]>([]);
  const [expressStatus, setExpressStatus] = useState<FleetValue['expressStatus']>('loading');

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    // In parallel with the mainline load, not part of it: nothing waits on this answer.
    setExpressStatus((current) => (current === 'ready' ? current : 'loading'));
    fetchExpressFleet().then(
      (tails) => {
        if (cancelled) return;
        setExpressTails(tails);
        setExpressStatus('ready');
      },
      () => {
        if (!cancelled) setExpressStatus((current) => (current === 'ready' ? current : 'failed'));
      },
    );

    async function load() {
      const [dbResult, starlinkResult, summaryResult] = await Promise.allSettled([
        fetchFleetDb(),
        fetchStarlinkRoster(),
        fetchFleetSummary(),
      ]);
      if (cancelled) return;

      const db = dbResult.status === 'fulfilled' ? dbResult.value : [];
      setFleetDb(db);
      // Only the airframe database failing is fatal for the fleet panels; Starlink and the
      // industry summary each degrade on their own.
      setLoadFailed(dbResult.status === 'rejected');

      if (summaryResult.status === 'fulfilled') setFleetSummary(summaryResult.value);

      if (starlinkResult.status === 'fulfilled') {
        const data = starlinkResult.value;
        const aircraft = applyVerifiedStarlinkOverrides(
          Array.isArray(data.aircraft) ? data.aircraft : [],
        ) as StarlinkAircraft[];
        // A server that predates `?fields=` still sends the schedules: use them.
        const inline = data.flightsByTail && Object.keys(data.flightsByTail).length > 0;
        setStarlink((current) => ({
          tails: new Set(aircraft.map((a) => a.tail).filter(Boolean)),
          flightsByTail: inline ? data.flightsByTail! : current.flightsByTail,
          flightsStatus: inline ? 'ready' : current.flightsStatus,
          stats: data.fleetStats ?? null,
          aircraft,
          lastUpdated: data.lastUpdated ?? null,
          syncedAt: data.syncedAt ?? null,
          degraded: false,
        }));
      } else {
        try {
          const fallback = applyVerifiedStarlinkOverrides(
            await fetchStarlinkFallback(),
          ) as StarlinkAircraft[];
          if (cancelled) return;
          setStarlink({
            ...EMPTY_STARLINK,
            tails: new Set(fallback.map((a) => a.tail).filter(Boolean)),
            aircraft: fallback,
            degraded: true,
          });
        } catch {
          if (!cancelled) setStarlink({ ...EMPTY_STARLINK, degraded: true });
        }
      }
      if (!cancelled) setLoading(false);
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  // The schedules, on demand. `flightsRequested` stops a second request while one is in flight
  // or after success; a failure clears it so the next tab open retries.
  const flightsRequested = useRef(false);
  const loadStarlinkFlights = useCallback(() => {
    if (flightsRequested.current) return;
    flightsRequested.current = true;
    setStarlink((current) =>
      current.flightsStatus === 'ready' ? current : { ...current, flightsStatus: 'loading' },
    );
    fetchStarlinkFlights().then(
      (data) =>
        setStarlink((current) => ({
          ...current,
          flightsByTail: data?.flightsByTail ?? {},
          flightsStatus: 'ready',
        })),
      () => {
        flightsRequested.current = false;
        setStarlink((current) =>
          current.flightsStatus === 'ready' ? current : { ...current, flightsStatus: 'failed' },
        );
      },
    );
  }, []);

  const fleetDb = useMemo(
    () => applyStarlinkWifiOverlay(rawFleetDb, starlink.tails) as FleetAircraft[],
    [rawFleetDb, starlink.tails],
  );

  const fleetByReg = useMemo(() => {
    const index: Record<string, FleetAircraft> = {};
    for (const aircraft of fleetDb) if (aircraft?.r) index[aircraft.r] = aircraft;
    return index;
  }, [fleetDb]);

  const special = useMemo(() => indexSpecialAircraft(fleetDb) as SpecialIndex, [fleetDb]);

  // The roster arrives in the same boot as the tails, so this re-joins once when either lands.
  const expressDb = useMemo(
    () => buildExpressFleet(expressTails, starlink.aircraft) as ExpressAircraft[],
    [expressTails, starlink.aircraft],
  );
  const expressByReg = useMemo(
    () => indexExpressFleet(expressDb) as Record<string, ExpressAircraft>,
    [expressDb],
  );

  const value = useMemo<FleetValue>(
    () => ({
      fleetDb,
      fleetByReg,
      starlink,
      fleetSummary,
      special,
      loading,
      loadFailed,
      retry,
      loadStarlinkFlights,
      expressDb,
      expressByReg,
      expressStatus,
    }),
    [
      fleetDb,
      fleetByReg,
      starlink,
      fleetSummary,
      special,
      loading,
      loadFailed,
      retry,
      loadStarlinkFlights,
      expressDb,
      expressByReg,
      expressStatus,
    ],
  );

  return <FleetContext.Provider value={value}>{children}</FleetContext.Provider>;
}
