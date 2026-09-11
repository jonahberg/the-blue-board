/**
 * METAR, FAA and NAS weather state.
 *
 * Task 4 fills this in: `allSettled([metar chunks, faa, nas])`, the hub→station map, the
 * worst-of flight category, `computeOpsImpact` into `weatherOpsByHub`, and the extra
 * stations pulled from watched routes and loaded boards. The provider, the store shape and
 * the five-minute refresh timer are settled here because the ticker and the hub-health
 * strip read `faaIndex` from day one — a hub under a ground stop has to show the ⛔ glyph
 * even before the Weather tab has ever been opened.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import type { FaaIndex, MetarRecord, NasData } from '../data/types';

/** The Weather tab's own refresh cadence (inventory §30). */
export const WEATHER_REFRESH_MS = 5 * 60 * 1000;

export type WeatherOps = { level: string; text: string } | null;

export type WeatherValue = {
  metarByHub: Record<string, MetarRecord>;
  /** Airport code → its raw FAA record, as `buildFaaIndex()` shapes it. */
  faaIndex: FaaIndex;
  nas: NasData | null;
  weatherOpsByHub: Record<string, WeatherOps>;
  updatedAt: number | null;
  loading: boolean;
  refresh: () => void;
};

const WeatherContext = createContext<WeatherValue | null>(null);

export function useWeather(): WeatherValue {
  const ctx = useContext(WeatherContext);
  if (!ctx) throw new Error('useWeather() outside <WeatherProvider>');
  return ctx;
}

export function WeatherProvider({ children }: { children: ReactNode }) {
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((n) => n + 1), []);

  // The cadence is live now so Task 4 only has to fill the fetch in. Skipped while the tab
  // is hidden — five endpoints on a backgrounded tab is spend with no reader.
  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden) setTick((n) => n + 1);
    }, WEATHER_REFRESH_MS);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    // Task 4: fetch METAR chunks, /api/faa and /api/nas here, keyed off `tick`.
  }, [tick]);

  const value = useMemo<WeatherValue>(
    () => ({
      metarByHub: {},
      faaIndex: {},
      nas: null,
      weatherOpsByHub: {},
      updatedAt: null,
      loading: false,
      refresh,
    }),
    [refresh],
  );

  return <WeatherContext.Provider value={value}>{children}</WeatherContext.Provider>;
}
