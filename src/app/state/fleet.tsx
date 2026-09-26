/**
 * Fleet reference data: `/data/fleet.json`, `/api/starlink-data` and `/api/fleet-summary`,
 * loaded in parallel once per session (inventory §34 `loadFleetData()`).
 *
 * Three things downstream depend on:
 *  - `fleetByReg` — the registration index `matchAircraft()` needs to turn a live feed row
 *    into an airframe (seat config, WiFi, IFE).
 *  - `starlink.tails` — a Set, because the map recolours every marker against it on each
 *    poll. When `/api/starlink-data` fails we fall back to the static `/data/starlink.json`
 *    roster and mark the tier `degraded`: in that state the Starlink filter and the
 *    "confirmed" badge must not claim more than the fallback can support.
 *  - `loadFailed` — the fleet panels show a retry state rather than an empty table.
 *
 * Starlink reconciliation (#249, ported from the legacy `loadFleetData()`): the roster gets the
 * evidence-backed tails the upstream tracker is missing (`applyVerifiedStarlinkOverrides`), and
 * the exposed `fleetDb` relabels `w` to 'Starlink' for every tail in that roster
 * (`applyStarlinkWifiOverlay`) — `/data/fleet.json` is a build artefact that lags retrofits, and
 * without this the WiFi column shows "ViaSat Ka" beside a Starlink badge.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { applyStarlinkWifiOverlay } from '@/lib/fleet-utils.js';
import { indexSpecialAircraft } from '@/lib/special-aircraft.js';
import { applyVerifiedStarlinkOverrides } from '@/lib/starlink-overrides.js';
import {
  fetchFleetDb,
  fetchFleetSummary,
  fetchStarlinkData,
  fetchStarlinkFallback,
} from '../data/api';
import type {
  FleetAircraft,
  FleetSummary,
  StarlinkAircraft,
  StarlinkFleetStats,
} from '../data/types';

/** Registration → the fleet site's special-aircraft entry. */
export type SpecialIndex = Map<string, { name: string; type: 'named' | 'livery' }>;

export type StarlinkState = {
  /** Registrations known to carry Starlink. */
  tails: Set<string>;
  flightsByTail: Record<string, unknown>;
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
};

const EMPTY_STARLINK: StarlinkState = {
  tails: new Set<string>(),
  flightsByTail: {},
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

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    async function load() {
      const [dbResult, starlinkResult, summaryResult] = await Promise.allSettled([
        fetchFleetDb(),
        fetchStarlinkData(),
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
        setStarlink({
          tails: new Set(aircraft.map((a) => a.tail).filter(Boolean)),
          flightsByTail: data.flightsByTail ?? {},
          stats: data.fleetStats ?? null,
          aircraft,
          lastUpdated: data.lastUpdated ?? null,
          syncedAt: data.syncedAt ?? null,
          degraded: false,
        });
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
    }),
    [fleetDb, fleetByReg, starlink, fleetSummary, special, loading, loadFailed, retry],
  );

  return <FleetContext.Provider value={value}>{children}</FleetContext.Provider>;
}
