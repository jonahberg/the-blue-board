/**
 * "Where has this tail been today?" — `/api/aircraft-history` per registration.
 *
 * Five-minute TTL, and a FAILURE is cached as an empty segment list rather than left
 * uncached. That is deliberate: without it a card that cannot get history rebuilds a
 * perpetual "Loading aircraft journey…" line on every re-render and re-asks an endpoint
 * that is credit-blocked or 502-ing. An empty cached entry renders "Flight history
 * unavailable" — an answer — and stops asking until the TTL expires.
 *
 * Module-level like the flight-times cache, for the same reason: this view is hidden and
 * shown constantly and must not re-spend a lookup per tab switch.
 */

import { useEffect, useState } from 'react';

import { fetchAircraftHistory } from '../../data/api';
import type { AircraftHistory } from '../../data/api';

export type JourneySegment = NonNullable<AircraftHistory['segments']>[number];

/** `null` segments means "not asked yet"; `[]` means "asked, and there is nothing". */
export type JourneyEntry = { segments: JourneySegment[] | null; ts: number };
export type JourneyMap = Record<string, JourneySegment[] | null>;

const TTL_MS = 300000;

const cache = new Map<string, JourneyEntry>();
const inFlight = new Set<string>();

export function clearJourneyCache(): void {
  cache.clear();
}

function snapshot(regs: string[]): JourneyMap {
  const map: JourneyMap = {};
  for (const reg of regs) map[reg] = cache.get(reg)?.segments ?? null;
  return map;
}

export function useAircraftJourney(regs: string[]): JourneyMap {
  const key = [...new Set(regs.filter(Boolean))].sort().join(',');
  const [journeys, setJourneys] = useState<JourneyMap>(() => snapshot(regs));

  useEffect(() => {
    const list = key ? key.split(',') : [];
    if (list.length === 0) {
      setJourneys({});
      return undefined;
    }

    let cancelled = false;

    async function fetchOne(reg: string) {
      if (inFlight.has(reg)) return;
      inFlight.add(reg);
      try {
        const data = await fetchAircraftHistory(reg);
        cache.set(reg, {
          segments: data.success && data.segments ? data.segments : [],
          ts: Date.now(),
        });
      } catch {
        // Upstream error — cache the empty marker so the card renders the graceful
        // state instead of a loading line that never resolves.
        cache.set(reg, { segments: [], ts: Date.now() });
      } finally {
        inFlight.delete(reg);
        if (!cancelled) setJourneys(snapshot(list));
      }
    }

    setJourneys(snapshot(list));
    const now = Date.now();
    for (const reg of list) {
      const entry = cache.get(reg);
      if (!entry || now - entry.ts >= TTL_MS) void fetchOne(reg);
    }

    return () => {
      cancelled = true;
    };
  }, [key]);

  return journeys;
}
