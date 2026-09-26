/**
 * One `/api/flight-times` answer per watched flight, kept fresh at the right cadence.
 *
 * The TTL ladder is `flightTimesCacheTtl()` in `src/lib/watch-utils.js` and is not
 * restated here: a failure re-asks in 30 s, a resolved flight in five minutes, and a
 * flight about to leave every 45 s — each plus a per-flight jitter so twenty watched
 * flights do not all re-poll on the same tick.
 *
 * The cache and the failure counters are MODULE-level, not component state, because
 * this view unmounts nothing but is hidden and shown constantly: a tab switch must not
 * re-spend twenty lookups. The counters drive the terminal "STATUS UNAVAILABLE" chip
 * (F008) — a card that says "LOADING…" for the twentieth consecutive poll is lying
 * about the state of the world.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { flightTimesCacheTtl } from '@/lib/watch-utils.js';
import { ApiError, fetchFlightTimes } from '../../data/api';
import type { FlightTimes } from '../../data/types';

export type FlightTimesEntry = { data: FlightTimes | null; failures: number };
export type FlightTimesMap = Record<string, FlightTimesEntry>;

/** How often the hook re-examines the ladder. The TTL, not this, decides what refetches. */
const SWEEP_MS = 15000;

type CacheEntry = { data: FlightTimes; ts: number };

const cache = new Map<string, CacheEntry>();
const failures = new Map<string, number>();
/** In-flight requests, so a sweep landing on a slow lookup does not start a second one. */
const inFlight = new Set<string>();

/** Exported for the view's "force a refresh" control and for test isolation. */
export function clearFlightTimesCache(): void {
  cache.clear();
  failures.clear();
}

function snapshot(flights: string[]): FlightTimesMap {
  const map: FlightTimesMap = {};
  for (const flight of flights) {
    map[flight] = {
      data: cache.get(flight)?.data ?? null,
      failures: failures.get(flight) ?? 0,
    };
  }
  return map;
}

export function useFlightTimes(flights: string[]): {
  times: FlightTimesMap;
  /** True until every watched flight has been asked about at least once. */
  loading: boolean;
  refresh: () => void;
} {
  const key = flights.join(',');
  const [times, setTimes] = useState<FlightTimesMap>(() => snapshot(flights));
  const [version, setVersion] = useState(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(() => {
    clearFlightTimesCache();
    setVersion((n) => n + 1);
  }, []);

  useEffect(() => {
    const list = key ? key.split(',') : [];
    if (list.length === 0) {
      setTimes({});
      return undefined;
    }

    let cancelled = false;

    async function fetchOne(flight: string) {
      if (inFlight.has(flight)) return;
      inFlight.add(flight);
      try {
        const data = await fetchFlightTimes(flight);
        cache.set(flight, { data, ts: Date.now() });
        failures.set(flight, 0);
      } catch (error) {
        // A 4xx/5xx is a miss; so is a network failure. Both count towards the terminal
        // state, and neither drops a cached answer we already have — a stale gate is
        // more use than a blank card.
        if (error instanceof ApiError || error instanceof Error) {
          failures.set(flight, (failures.get(flight) ?? 0) + 1);
        }
      } finally {
        inFlight.delete(flight);
        if (!cancelled && mounted.current) setTimes(snapshot(list));
      }
    }

    function sweep() {
      const now = Date.now();
      for (const flight of list) {
        const entry = cache.get(flight);
        const ttl = flightTimesCacheTtl(entry?.data ?? null, flight, now);
        if (!entry || now - entry.ts >= ttl) void fetchOne(flight);
      }
    }

    setTimes(snapshot(list));
    sweep();
    // Hidden tabs do not poll: twenty lookups with nobody reading them is spend for
    // nothing, and the ladder re-asks the moment the tab comes back.
    const timer = setInterval(() => {
      if (!document.hidden) sweep();
    }, SWEEP_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [key, version]);

  const loading = flights.length > 0 && flights.every((flight) => !cache.has(flight));
  return { times, loading, refresh };
}
