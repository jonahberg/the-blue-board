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
 *
 * Through flights (phone QA Oct 4 2026): one flight number can fly two legs a day, and the
 * server's "current leg" can be the wrong one while the first is still in the air (UA1872
 * MCO→IAH→MSP). Given the live feed, the sweep asks again with `from=<the airborne aircraft's
 * origin>` whenever the aircraft is flying a different leg than the cached answer describes —
 * once per origin per five minutes, so a leg the boards do not know cannot loop.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { findLiveFlight, liveLegOrigin } from '@/lib/my-flights.js';
import { flightTimesCacheTtl } from '@/lib/watch-utils.js';
import { ApiError, fetchFlightTimes } from '../../data/api';
import type { Flight, FlightTimes } from '../../data/types';

export type FlightTimesEntry = { data: FlightTimes | null; failures: number };
export type FlightTimesMap = Record<string, FlightTimesEntry>;

/** How often the hook re-examines the ladder. The TTL, not this, decides what refetches. */
const SWEEP_MS = 15000;

/** `from` = the origin the answer was pinned to, when the sweep asked for a specific leg. */
type CacheEntry = { data: FlightTimes; ts: number; from?: string };

const cache = new Map<string, CacheEntry>();
const failures = new Map<string, number>();
/** flight → the last leg-origin retry, so an unanswerable one is not re-asked every sweep. */
const legRetries = new Map<string, { from: string; ts: number }>();
const LEG_RETRY_MS = 5 * 60000;
/** In-flight requests, so a sweep landing on a slow lookup does not start a second one. */
const inFlight = new Set<string>();

/** Exported for the view's "force a refresh" control and for test isolation. */
export function clearFlightTimesCache(): void {
  cache.clear();
  failures.clear();
  legRetries.clear();
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

export function useFlightTimes(flights: string[], live?: Flight[]): {
  times: FlightTimesMap;
  /** True until every watched flight has been asked about at least once. */
  loading: boolean;
  refresh: () => void;
} {
  const key = flights.join(',');
  const [times, setTimes] = useState<FlightTimesMap>(() => snapshot(flights));
  const [version, setVersion] = useState(0);
  const mounted = useRef(true);
  // Read at sweep time: the feed moves every poll and must not restart the sweep timer.
  const liveRef = useRef(live);
  liveRef.current = live;

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

    async function fetchOne(flight: string, from?: string) {
      if (inFlight.has(flight)) return;
      inFlight.add(flight);
      try {
        const data = await fetchFlightTimes(flight, undefined, from);
        cache.set(flight, { data, ts: Date.now(), ...(from ? { from } : {}) });
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
        // The live aircraft is flying another leg of this number: ask for that one.
        const legFrom = entry ? (liveLegOrigin(entry.data, findLiveFlight(liveRef.current ?? [], flight)) as string) : '';
        const tried = legRetries.get(flight);
        if (legFrom && entry?.from !== legFrom && !(tried && tried.from === legFrom && now - tried.ts < LEG_RETRY_MS)) {
          legRetries.set(flight, { from: legFrom, ts: now });
          void fetchOne(flight, legFrom);
          continue;
        }
        const ttl = flightTimesCacheTtl(entry?.data ?? null, flight, now);
        if (!entry || now - entry.ts >= ttl) void fetchOne(flight, entry?.from);
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
