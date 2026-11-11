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
 *
 * FAA programs are held with the moment they describe (Nov 2026). The last good answer is kept
 * through a failed refresh, as before, but `faaIndex` is the CURRENT picture worked out from the
 * clock (src/lib/faa-freshness.js): a program past its own end time drops out, and once the answer
 * is older than FAA_STALE_AFTER_MS the index is empty and `faaStale` is set, so the hub strip, the
 * ticker and the delay risk never present an old program as a live one, and the NAS panel prints
 * "FAA status as of HH:MMZ" instead. A one-minute clock re-checks this between fetches (and on
 * returning to the tab), changing state only when the picture actually changes.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { getMetarStationForIata } from '@/lib/airport-metadata.js';
import { currentFaaPicture, FAA_STALE_AFTER_MS } from '@/lib/faa-freshness.js';
import { hasRenderableMetarData } from '@/lib/metar-explain.js';
import {
  collectMetarStations,
  indexMetarByKey,
  legacyWatchedRoutes,
  resolveWeather,
} from '@/lib/weather-cards.js';
import { fetchFaa, fetchMetarBatch, fetchNas } from '../data/api';
import type { FaaAirport, FaaIndex, MetarRecord, NasData } from '../data/types';
import { useLatest } from './hooks';
import { useSchedule } from './schedule';
import { STORAGE_KEYS, readString } from './storage';
import { useWatch } from './watch';

/** The Weather tab's own refresh cadence (inventory §30). */
export const WEATHER_REFRESH_MS = 5 * 60 * 1000;

/** How often the held FAA/NAS answers are re-checked against the clock between fetches. */
const FAA_CLOCK_TICK_MS = 60 * 1000;

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
  /**
   * Airport code → its FAA record, as `buildFaaIndex()` shapes it — the programs CURRENT now:
   * none past their own end time, and empty once the answer is stale (`faaStale`).
   */
  faaIndex: FaaIndex;
  /** The moment the held FAA answer describes (epoch ms); null before the first answer. */
  faaAsOf: number | null;
  /** The held FAA answer is older than FAA_STALE_AFTER_MS: nothing from it is shown as current. */
  faaStale: boolean;
  nas: NasData | null;
  /** When the held NAS answer arrived (epoch ms); null before the first. */
  nasAsOf: number | null;
  /** The held NAS answer is older than FAA_STALE_AFTER_MS. */
  nasStale: boolean;
  weatherOpsByHub: Record<string, WeatherOps>;
  updatedAt: number | null;
  loading: boolean;
  /**
   * No hub has a RENDERABLE observation — the tab shows its retry state instead of nine
   * cards of dashes. Not the same as "the request failed": a 200 carrying rows with no
   * usable fields is just as unreadable, and the shipped tab counted it the same way.
   */
  metarFailed: boolean;
  refresh: () => void;
};

const WeatherContext = createContext<WeatherValue | null>(null);

export function useWeather(): WeatherValue {
  const ctx = useContext(WeatherContext);
  if (!ctx) throw new Error('useWeather() outside <WeatherProvider>');
  return ctx;
}

/** useWeather() for a panel that also renders on its own (tests): null outside the provider. */
export function useWeatherOptional(): WeatherValue | null {
  return useContext(WeatherContext);
}

type WeatherState = {
  metarByHub: Record<string, MetarRecord>;
  faaIndex: FaaIndex;
  /** The last FAA answer obtained, as received; `faaIndex` is derived from it and the clock. */
  faaAirports: FaaAirport[] | null;
  faaAsOf: number | null;
  faaStale: boolean;
  /** currentFaaPicture()'s key for `faaIndex`, so a clock tick can tell when nothing changed. */
  faaKey: string;
  nas: NasData | null;
  nasAsOf: number | null;
  nasStale: boolean;
  weatherOpsByHub: Record<string, WeatherOps>;
  updatedAt: number | null;
  loading: boolean;
  metarFailed: boolean;
};

const EMPTY: WeatherState = {
  metarByHub: {},
  faaIndex: {},
  faaAirports: null,
  faaAsOf: null,
  faaStale: false,
  faaKey: 'none',
  nas: null,
  nasAsOf: null,
  nasStale: false,
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

  // The clock half of the FAA/NAS freshness rule: between fetches (and while a hidden tab skips
  // them) a held answer ages, a program passes its end time, and the picture must follow. Returns
  // the same state object when nothing a reader would see changed, so consumers do not re-render.
  useEffect(() => {
    const recheck = () =>
      setState((prev) => {
        const now = Date.now();
        const picture = currentFaaPicture(prev.faaAirports, prev.faaAsOf, now);
        const nasStale = prev.nasAsOf !== null && now - prev.nasAsOf > FAA_STALE_AFTER_MS;
        if (picture.key === prev.faaKey && nasStale === prev.nasStale) return prev;
        return {
          ...prev,
          faaIndex: picture.index as FaaIndex,
          faaStale: picture.stale,
          faaKey: picture.key,
          nasStale,
        };
      });
    const timer = setInterval(recheck, FAA_CLOCK_TICK_MS);
    document.addEventListener('visibilitychange', recheck);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', recheck);
    };
  }, []);

  const cycle = useRef(0);
  useEffect(() => {
    let cancelled = false;
    const mine = (cycle.current += 1);
    setState((prev) => ({ ...prev, loading: true }));

    const rows: Record<string, unknown>[] = [];
    for (const board of Object.values(boardsRef.current)) rows.push(...board.rows);
    // The shipped station collection — and nothing else in the dashboard — fell back to the
    // pre-rename `watchedFlights` key, so a visitor who has not re-starred anything since
    // still gets their origin/destination airports onto this batch (legacy main.js:5869).
    // Gated on the RAW modern value exactly as that `||` was, not on `watched.length`: a
    // stored `[]` is a viewer who cleared their list, and resurrecting the old key for them
    // would be a new behaviour, not parity.
    const legacyRoutes = readString(STORAGE_KEYS.watchedFlights)
      ? []
      : legacyWatchedRoutes(readString(STORAGE_KEYS.legacyWatchedFlights));
    const { stations, stationToKey } = collectMetarStations({
      routes: [...watchedRef.current.map((entry) => entry.route || ''), ...legacyRoutes],
      rows,
      getStation: getMetarStationForIata,
    }) as { stations: string[]; stationToKey: Record<string, string> };

    Promise.allSettled([fetchMetarBatch(stations), fetchFaa(), fetchNas()]).then(
      ([metarResult, faaResult, nasResult]) => {
        if (cancelled || cycle.current !== mine) return;
        const records = metarResult.status === 'fulfilled' ? metarResult.value : [];
        const byKey = indexMetarByKey(records, stationToKey) as Record<string, MetarRecord>;

        setState((prev) => {
          // MERGED, not replaced: a hub whose observation was late this cycle keeps its
          // last good one rather than dropping to "unavailable" for five minutes. The
          // shipped refresh loop never re-rendered a card it had no fresh data for, which
          // is the same promise stated as a data rule instead of a rendering accident.
          const keptMetar = { ...prev.metarByHub, ...byKey };
          const weatherOpsByHub: Record<string, WeatherOps> = {};
          for (const [key, record] of Object.entries(keptMetar)) {
            weatherOpsByHub[key] = resolveWeather(record).weatherOps as WeatherOps;
          }
          // A failed refresh keeps the last answer, but with its own age, never as a new one. An
          // answer OLDER than the one held (another edge, another server's last good) is not
          // taken: the newest information wins.
          const now = Date.now();
          const answer = faaResult.status === 'fulfilled' ? faaResult.value : null;
          const takeFaa = answer !== null && (prev.faaAsOf === null || answer.asOfMs >= prev.faaAsOf);
          const faaAirports = takeFaa ? answer.airports : prev.faaAirports;
          const faaAsOf = takeFaa ? answer.asOfMs : prev.faaAsOf;
          const picture = currentFaaPicture(faaAirports, faaAsOf, now);
          const nasAsOf = nasResult.status === 'fulfilled' ? now : prev.nasAsOf;
          return {
            metarByHub: keptMetar,
            faaIndex: picture.index as FaaIndex,
            faaAirports,
            faaAsOf,
            faaStale: picture.stale,
            faaKey: picture.key,
            nas: nasResult.status === 'fulfilled' ? nasResult.value : prev.nas,
            nasAsOf,
            nasStale: nasAsOf !== null && now - nasAsOf > FAA_STALE_AFTER_MS,
            weatherOpsByHub,
            updatedAt: Date.now(),
            loading: false,
            metarFailed: !Object.values(keptMetar).some((record) => hasRenderableMetarData(record)),
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

  const value = useMemo<WeatherValue>(
    () => ({
      metarByHub: state.metarByHub,
      faaIndex: state.faaIndex,
      faaAsOf: state.faaAsOf,
      faaStale: state.faaStale,
      nas: state.nas,
      nasAsOf: state.nasAsOf,
      nasStale: state.nasStale,
      weatherOpsByHub: state.weatherOpsByHub,
      updatedAt: state.updatedAt,
      loading: state.loading,
      metarFailed: state.metarFailed,
      refresh,
    }),
    [state, refresh],
  );

  return <WeatherContext.Provider value={value}>{children}</WeatherContext.Provider>;
}
