/**
 * METAR, FAA and NAS weather state.
 *
 * One `allSettled([metar chunks, /api/faa, /api/nas])` per cycle, because the three feeds
 * fail independently and a dark NAS endpoint must not cost the tab its hub cards. The
 * provider, the store shape and the five-minute refresh live here rather than in the view
 * because the ticker and the hub-health strip read `faaIndex` from day one — a hub under a
 * ground stop has to show the ⛔ glyph even before the Weather tab has ever been opened.
 *
 * Every decision about what a station's observation MEANS (the worst-of category, the ops
 * impact, the colours) belongs to `src/lib/weather-cards.js`; this file is fetch policy and
 * nothing else.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { getMetarStationForIata } from '@/lib/airport-metadata.js';
import { buildFaaIndex } from '@/lib/faa-context.js';
import { collectMetarStations, indexMetarByKey, resolveWeather } from '@/lib/weather-cards.js';
import { fetchFaa, fetchMetarBatch, fetchNas } from '../data/api';
import type { FaaIndex, MetarRecord, NasData } from '../data/types';
import { useLatest } from './hooks';
import { useSchedule } from './schedule';
import { useWatch } from './watch';

/** The Weather tab's own refresh cadence (inventory §30). */
export const WEATHER_REFRESH_MS = 5 * 60 * 1000;

/**
 * What `computeOpsImpact()` decided about one airport, in the exact shape
 * `src/lib/delay-risk.js` reads by name. Produced by `weatherOpsEntry()`.
 */
export type WeatherOps = {
  level: string;
  reasons: string[];
  fltCat: string;
  hasThunderstorms: boolean;
  hasFreezingPrecip: boolean;
  hasSnow: boolean;
  hasFog: boolean;
  gustKt: number;
  tempC: number | null;
};

export type WeatherValue = {
  /** Keyed by hub code, plus the non-hub IATA codes pulled off watches and boards. */
  metarByHub: Record<string, MetarRecord>;
  /** Airport code → its raw FAA record, as `buildFaaIndex()` shapes it. */
  faaIndex: FaaIndex;
  nas: NasData | null;
  weatherOpsByHub: Record<string, WeatherOps>;
  updatedAt: number | null;
  loading: boolean;
  /** No cycle has ever produced an observation — the tab shows its retry state. */
  metarFailed: boolean;
  refresh: () => void;
};

const WeatherContext = createContext<WeatherValue | null>(null);

export function useWeather(): WeatherValue {
  const ctx = useContext(WeatherContext);
  if (!ctx) throw new Error('useWeather() outside <WeatherProvider>');
  return ctx;
}

type WeatherState = {
  metarByHub: Record<string, MetarRecord>;
  faaIndex: FaaIndex;
  nas: NasData | null;
  weatherOpsByHub: Record<string, WeatherOps>;
  updatedAt: number | null;
  loading: boolean;
  metarFailed: boolean;
};

const EMPTY: WeatherState = {
  metarByHub: {},
  faaIndex: {},
  nas: null,
  weatherOpsByHub: {},
  updatedAt: null,
  loading: true,
  metarFailed: false,
};

export function WeatherProvider({ children }: { children: ReactNode }) {
  const [tick, setTick] = useState(0);
  const [state, setState] = useState<WeatherState>(EMPTY);
  const refresh = useCallback(() => setTick((n) => n + 1), []);

  // Watched routes and loaded boards widen the station list, but they must NOT be effect
  // dependencies: a board landing would then refire the whole METAR batch. They are read
  // through refs at fetch time instead, so the next five-minute cycle picks them up.
  const { watched } = useWatch();
  const { boards } = useSchedule();
  const watchedRef = useLatest(watched);
  const boardsRef = useLatest(boards);

  // Skipped while the tab is hidden — three endpoints on a backgrounded tab is spend with
  // no reader (inventory §30).
  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden) setTick((n) => n + 1);
    }, WEATHER_REFRESH_MS);
    return () => clearInterval(timer);
  }, []);

  const cycle = useRef(0);
  useEffect(() => {
    let cancelled = false;
    const mine = (cycle.current += 1);
    setState((prev) => ({ ...prev, loading: true }));

    const rows: Record<string, unknown>[] = [];
    for (const board of Object.values(boardsRef.current)) rows.push(...board.rows);
    const { stations, stationToKey } = collectMetarStations({
      routes: watchedRef.current.map((entry) => entry.route || ''),
      rows,
      getStation: getMetarStationForIata,
    }) as { stations: string[]; stationToKey: Record<string, string> };

    Promise.allSettled([fetchMetarBatch(stations), fetchFaa(), fetchNas()]).then(
      ([metarResult, faaResult, nasResult]) => {
        if (cancelled || cycle.current !== mine) return;
        const records = metarResult.status === 'fulfilled' ? metarResult.value : [];
        const byKey = indexMetarByKey(records, stationToKey) as Record<string, MetarRecord>;

        setState((prev) => {
          // A cycle that returned nothing keeps the last good observations rather than
          // blanking nine cards — exactly what the shipped refresh loop did.
          const keptMetar = Object.keys(byKey).length ? byKey : prev.metarByHub;
          const weatherOpsByHub: Record<string, WeatherOps> = {};
          for (const [key, record] of Object.entries(keptMetar)) {
            weatherOpsByHub[key] = resolveWeather(record).weatherOps as WeatherOps;
          }
          return {
            metarByHub: keptMetar,
            faaIndex:
              faaResult.status === 'fulfilled'
                ? (buildFaaIndex(faaResult.value) as FaaIndex)
                : prev.faaIndex,
            nas: nasResult.status === 'fulfilled' ? nasResult.value : prev.nas,
            weatherOpsByHub,
            updatedAt: Date.now(),
            loading: false,
            metarFailed: Object.keys(keptMetar).length === 0,
          };
        });
      },
    );

    return () => {
      cancelled = true;
    };
    // `boardsRef`/`watchedRef` are refs on purpose — see the comment above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  const value = useMemo<WeatherValue>(() => ({ ...state, refresh }), [state, refresh]);

  return <WeatherContext.Provider value={value}>{children}</WeatherContext.Provider>;
}
