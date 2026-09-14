/**
 * Schedule boards + the merged hub on-time reading.
 *
 * The loading policy here is the part that took several incidents to get right, so it is
 * stated once (inventory §20 "Data loading"):
 *
 *  - 60 s `AbortController` per attempt → "Schedule request timed out". A board that never
 *    answers must not leave the tab spinning forever.
 *  - An in-memory `agg-<hub>-<dir>-<ts>` cache, and a PARTIAL response is never cached —
 *    caching one would freeze a half-loaded board for the rest of the session.
 *  - The server clock is learned from the `Date` + `Age` headers, because
 *    `classifySchedStatus()` reclassifies long-past scheduled flights as departed and a
 *    device with bad NTP would otherwise hide upcoming flights or fabricate departures.
 *  - Three attempts with 1 / 2 / 4 s backoff; a partial board is retried EXCEPT when the
 *    first page failed and nothing came back (a known outage, not a transient).
 *  - `hub/dir/day` are frozen for the whole load (F034): the retry loop used to re-read the
 *    mutable selection, so switching hubs mid-backoff filed the new hub's flights under the
 *    old hub's key and poisoned the hub-health and IROPS aggregates.
 *  - One user load in flight at a time, with the latest request held as pending — a viewer
 *    clicking through four hubs must not open four concurrent aggregations.
 *  - The idle preload warms ORD/DEN/EWR sequentially, once per 10 minutes
 *    (`sessionStorage.bb_sched_preload_ts`), each with its OWN start-of-hub-day (F022 — one
 *    Eastern timestamp reused for three hubs fetched YESTERDAY's Denver board round the clock).
 *
 * `useHubHealth()` is the arbitration the hub-health strip renders (inventory §3): a SERVER
 * reading from `/api/irops` `hubMetrics` always wins, and a client reading computed from
 * loaded boards only fills hubs the server has not spoken for. That ordering is why it lives
 * next to the board store rather than in the strip component.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { detectEquipmentSwaps } from '@/lib/equipment-swaps.js';
import { HUB_ORDER, computeBoardOtp, mergeHubHealth, serverOtpFromMetrics } from '@/lib/hub-health.js';
import { HUB_TZ, defaultSchedDayOffset, getStartOfHubDay } from '@/lib/hubTz.js';
import {
  MAX_SCHEDULE_RETRIES,
  PRELOAD_HUBS,
  PRELOAD_TTL_MS,
  SCHEDULE_TIMEOUT_MS,
  aggCacheKey,
  retryDelayMs,
  serverClockOffsetSec,
  shouldRetryPartial,
  swapStorageKey,
} from '@/lib/schedule-load.js';
import { classifySchedStatus } from '@/lib/schedule-status.js';
import { isSignificantStatusChange } from '@/lib/watch-utils.js';
import { ApiError, fetchSchedule } from '../data/api';
import type { ScheduleMeta, ScheduleResponse } from '../data/types';
import { useIrops } from './irops';
import { STORAGE_KEYS, safeLocalStorage, safeSessionStorage } from './storage';
import { useUi } from './ui';
import { useWatch } from './watch';

export type BoardDirection = 'departures' | 'arrivals';

/** `${hub}-${dir}-${dayOffset}` — the key every board is cached and looked up under. */
export type BoardKey = string;

export function boardKey(hub: string, dir: BoardDirection, day: number): BoardKey {
  return `${hub}-${dir}-${day}`;
}

/** One detected equipment change, as `detectEquipmentSwaps()` reports it. */
export type EquipmentSwap = {
  flight: string;
  oldAc: string;
  newAc: string;
  reg?: string;
};

export type Board = {
  hub: string;
  dir: BoardDirection;
  day: number;
  /** Raw rows exactly as `/api/schedule` returned them — the filters are applied downstream. */
  rows: Record<string, unknown>[];
  meta: ScheduleMeta | null;
  /** Server clock at fetch time (`Date` header + `Age`), for operated/on-time arbitration. */
  serverNowMs: number | null;
  fetchedAt: number;
  degraded: boolean;
  stale: boolean;
  partial: boolean;
  error: string | null;
  /** Equipment changes seen when THIS board landed (inventory §20 "Equipment swap detection"). */
  swaps: EquipmentSwap[];
};

export type ScheduleCurrent = { hub: string; dir: BoardDirection; day: number };

/** A row the search palette asked the board to reveal. Cleared once the table has scrolled. */
export type ScheduleGoto = { flight: string; key: number } | null;

/** A watched flight that changed status while the page was visible (inventory §6). */
export type WatchAlert = { message: string; key: number } | null;

/**
 * "Board `key` landed; anchor it at NOW."
 *
 * The key is the whole point. Loads are not cancelled when the viewer changes hub or
 * direction mid-flight, so a straggler for a board they navigated away from still completes
 * and still raises this. A bare counter would make that straggler scroll-jump whatever board
 * they ARE reading; naming the board means only that board responds.
 */
export type AutoScrollSignal = { key: BoardKey; n: number } | null;

export type ScheduleValue = {
  boards: Record<BoardKey, Board>;
  /** Per-key loading flags, so one board reloading never blanks another. */
  loading: Record<BoardKey, boolean>;
  /** Per-key load failures — the message the tab shows in place of a table. */
  errors: Record<BoardKey, string>;
  meta: ScheduleMeta | null;
  load: (hub: string, dir: BoardDirection, day: number) => Promise<void>;
  /** Refetch the current board, dropping its aggregation cache entry first. */
  refresh: () => void;
  preload: () => void;
  current: ScheduleCurrent;
  setCurrent: (next: Partial<ScheduleCurrent>) => void;
  /** Select a board and reveal one flight on it (the palette's `goto-schedule-result`). */
  goto: (target: { hub?: string; dir?: BoardDirection; day?: number; flight: string }) => void;
  pendingGoto: ScheduleGoto;
  clearGoto: () => void;
  /** Raised when a FRESH today board lands, naming the board, so only it anchors at NOW. */
  autoScroll: AutoScrollSignal;
  /** Board-time "now" in seconds, anchored to the schedule server rather than the device. */
  nowSec: () => number;
  watchAlert: WatchAlert;
  clearWatchAlert: () => void;
  /** Loaded rows grouped by hub — the input `computeBoardOtp()` takes. */
  rawByHub: Record<string, Record<string, unknown>[]>;
};

const ScheduleContext = createContext<ScheduleValue | null>(null);

export function useSchedule(): ScheduleValue {
  const ctx = useContext(ScheduleContext);
  if (!ctx) throw new Error('useSchedule() outside <ScheduleProvider>');
  return ctx;
}

/** `{hubDisruptionMinutes}` for `classifySchedStatus` — 0 unless the board reported a program. */
export function classifyOptsFor(meta: ScheduleMeta | null | undefined): {
  hubDisruptionMinutes: number;
} {
  const value = Number(meta?.hubDisruptionMinutes);
  return { hubDisruptionMinutes: Number.isFinite(value) && value > 0 ? value : 0 };
}

const HUBS = new Set(HUB_ORDER as string[]);

export function ScheduleProvider({
  children,
  defaultHub = 'ORD',
}: {
  children: ReactNode;
  defaultHub?: string;
}) {
  const [boards, setBoards] = useState<Record<BoardKey, Board>>({});
  const [loading, setLoading] = useState<Record<BoardKey, boolean>>({});
  const [errors, setErrors] = useState<Record<BoardKey, string>>({});
  const [pendingGoto, setPendingGoto] = useState<ScheduleGoto>(null);
  const [autoScroll, setAutoScroll] = useState<AutoScrollSignal>(null);
  const [watchAlert, setWatchAlert] = useState<WatchAlert>(null);
  // A hub's "today" board is empty until its first departures roll, so before the local
  // rollover hour the completed day is the useful one. Derived in the initialiser rather
  // than in a view effect: doing it later costs one wasted AeroDataBox board (day 0, then
  // day −1 a tick after).
  const [current, setCurrentState] = useState<ScheduleCurrent>(() => ({
    hub: defaultHub,
    dir: 'departures',
    day: defaultSchedDayOffset(defaultHub) as number,
  }));

  const { announce, select, showBmacToast } = useUi();
  const watch = useWatch();
  // The watch list is read at diff time, never as an effect dependency — a board landing
  // must not be able to re-run because someone starred a flight.
  const watchRef = useRef(watch);
  watchRef.current = watch;

  // A `useState` initializer runs once, so a home hub that resolves later (or a viewer who
  // changes it from the canopy) would never reach the board. Follow `defaultHub` until the
  // viewer has chosen a board themselves, then stop — their choice outranks the preference.
  const hubChosenByViewer = useRef(false);
  useEffect(() => {
    if (hubChosenByViewer.current) return;
    setCurrentState((prev) =>
      prev.hub === defaultHub
        ? prev
        : { ...prev, hub: defaultHub, day: defaultSchedDayOffset(defaultHub) as number },
    );
  }, [defaultHub]);

  // Refs, not state: none of these should re-render anything, and the loader reads them
  // from inside async callbacks where a captured state value would be stale.
  const aggCache = useRef(new Map<string, ScheduleResponse>());
  const inFlight = useRef(new Map<string, Promise<ScheduleResponse>>());
  const clockOffsetSec = useRef(0);
  const boardsRef = useRef(boards);
  boardsRef.current = boards;
  const activeLoad = useRef<Promise<void> | null>(null);
  const pendingLoad = useRef<ScheduleCurrent | null>(null);
  const preloadRunning = useRef(false);

  const nowSec = useCallback(() => Math.floor(Date.now() / 1000) - clockOffsetSec.current, []);

  /**
   * One aggregation fetch, cached and deduped.
   *
   * Deduping matters more than it looks: the idle preload and a viewer opening the tab race
   * for the same ORD board on almost every cold load, and two aggregations of the same board
   * are two AeroDataBox charges for one answer.
   */
  const fetchBoard = useCallback(
    async (hub: string, dir: BoardDirection, timestamp: number): Promise<ScheduleResponse> => {
      const key = aggCacheKey(hub, dir, timestamp);
      const cached = aggCache.current.get(key);
      if (cached) return cached;
      const existing = inFlight.current.get(key);
      if (existing) return existing;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), SCHEDULE_TIMEOUT_MS);
      const promise = (async () => {
        try {
          const data = await fetchSchedule({ hub, dir, timestamp }, controller.signal);
          // `serverNowMs` is the `Date` header plus `Age` (see `data/api.ts`) — the edge's
          // own "now", which is what the status engine has to reason against.
          const offset = serverClockOffsetSec(data.serverNowMs, 0) as number | null;
          if (offset !== null) clockOffsetSec.current = offset;
          if (data.error) throw new Error(data.error);
          if (!data.partial) aggCache.current.set(key, data);
          return data;
        } catch (error) {
          // An abort surfaces as a DOMException in browsers and a plain Error elsewhere;
          // the NAME is the portable part.
          if ((error as { name?: string })?.name === 'AbortError') {
            throw new Error('Schedule request timed out');
          }
          if (error instanceof ApiError) throw new Error(`Schedule API ${error.status}`);
          throw error;
        } finally {
          clearTimeout(timer);
          inFlight.current.delete(key);
        }
      })();
      inFlight.current.set(key, promise);
      return promise;
    },
    [],
  );

  /** Fetch with the retry ladder. `hub/dir/day` are the caller's FROZEN values. */
  const fetchWithRetries = useCallback(
    async (hub: string, dir: BoardDirection, timestamp: number): Promise<ScheduleResponse> => {
      let lastError: unknown = null;
      let result: ScheduleResponse | null = null;
      for (let attempt = 0; attempt < MAX_SCHEDULE_RETRIES; attempt += 1) {
        if (attempt > 0) {
          await new Promise((resolve) => setTimeout(resolve, retryDelayMs(attempt) as number));
        }
        try {
          result = await fetchBoard(hub, dir, timestamp);
          lastError = null;
          if (shouldRetryPartial(result, attempt)) {
            aggCache.current.delete(aggCacheKey(hub, dir, timestamp));
            continue;
          }
          break;
        } catch (error) {
          lastError = error;
          result = null;
        }
      }
      if (lastError) throw lastError;
      if (!result) throw new Error('Schedule request failed');
      return result;
    },
    [fetchBoard],
  );

  /**
   * The watched-flight diff (inventory §6), run on every board that lands.
   *
   * Two whole classes of row are skipped rather than announced: a TIME-INFERRED status (we
   * guessed "Departed" because the clock crossed the grace window) is not evidence, and a
   * transition INTO `unknown` is pipeline noise — announcing either sends a traveller a
   * speculative alert and, worse, overwrites the stored status so the REAL transition later
   * compares against a fabricated one.
   */
  const diffWatched = useCallback(
    (rows: Record<string, unknown>[], dir: BoardDirection, meta: ScheduleMeta | null) => {
      const store = watchRef.current;
      if (!store.watched.length) return;
      const opts = classifyOptsFor(meta);
      const now = nowSec();
      for (const row of rows) {
        const flight = row as {
          identification?: { number?: { default?: string } };
          airport?: { origin?: { code?: { iata?: string } }; destination?: { code?: { iata?: string } } };
        };
        const ident = flight.identification?.number?.default;
        if (!ident) continue;
        const entry = store.watched.find((w) => w.flight === ident);
        if (!entry) continue;
        const status = classifySchedStatus(row, dir, now, opts) as {
          key: string;
          text: string;
          inferred?: boolean;
        };
        if (status.inferred) continue;
        if (status.key === 'unknown') continue;
        const next = status.text;
        const previous = entry.status;
        if (previous && next !== previous && isSignificantStatusChange(previous, next)) {
          const orig = flight.airport?.origin?.code?.iata || '?';
          const dest = flight.airport?.destination?.code?.iata || '?';
          const message = `🔔 ${ident} ${orig}→${dest}: ${next} (was: ${previous})`;
          if (typeof document !== 'undefined' && document.hidden) {
            // Not visible — the browser's own notification is the only channel that reaches
            // someone who has tabbed away from a flight they are waiting on.
            if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
              try {
                const notification = new Notification('The Blue Board', {
                  body: `${ident}: ${next} (was: ${previous})`,
                  icon: '/icons/icon-192.png',
                  tag: `bb-watch-${ident}`,
                  data: { flight: ident },
                });
                // Clicking the notification has to land on the flight, not just the tab —
                // the whole point is that the viewer was away when it changed.
                notification.onclick = () => {
                  window.focus();
                  select({ kind: 'ident', ident });
                };
              } catch {
                /* a notification that cannot be shown must never break a board load */
              }
            }
          } else {
            setWatchAlert({ message, key: Date.now() });
            announce(message);
          }
          // Inventory §12: a watched flight LANDING is the one moment this dashboard has
          // demonstrably done its job, so it is the one moment the donation ask is made.
          // Inside the significant-change branch on purpose — an inferred or repeated
          // "Landed" is not an arrival, and `showBmacToast` caps the rest (14-day cooldown,
          // once per load, 3-second delay).
          if (next.toLowerCase().includes('landed')) showBmacToast(ident);
        }
        // Always restamp, changed or not: the stored status is the baseline the NEXT load
        // compares against, and leaving it behind re-fires the same alert every refresh.
        store.updateStatus(ident, next);
      }
    },
    [announce, select, nowSec, showBmacToast],
  );

  /** Store one landed board and run the post-load fan-out. */
  const commitBoard = useCallback(
    (
      hub: string,
      dir: BoardDirection,
      day: number,
      result: ScheduleResponse,
      { detectSwaps }: { detectSwaps: boolean },
    ) => {
      const key = boardKey(hub, dir, day);
      const rows = (result.flights || []) as Record<string, unknown>[];
      const meta = (result.meta ?? null) as ScheduleMeta | null;

      // Swap detection DIFFS against the stored snapshot and then overwrites it, so running
      // it on a cache hit would silently wipe the badges the first load earned. It runs only
      // on a real fetch, and the result rides on the board so revisiting keeps the badges.
      let swaps: EquipmentSwap[] = [];
      if (detectSwaps) {
        const storage = safeLocalStorage();
        if (storage) {
          try {
            const detected = detectEquipmentSwaps(
              rows,
              swapStorageKey(hub, dir, day),
              storage,
            ) as { swaps: EquipmentSwap[] };
            swaps = detected.swaps || [];
          } catch {
            /* a swap snapshot is an enhancement; never fail a board over it */
          }
        }
      } else {
        swaps = boardsRef.current[key]?.swaps ?? [];
      }

      const board: Board = {
        hub,
        dir,
        day,
        rows,
        meta,
        serverNowMs: result.serverNowMs ?? null,
        fetchedAt: Date.now(),
        degraded: Boolean(result.degraded),
        stale: Boolean(result.stale),
        partial: Boolean(result.partial),
        error: null,
        swaps,
      };
      setBoards((prev) => ({ ...prev, [key]: board }));
      setErrors((prev) => {
        if (!(key in prev)) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      });
      return board;
    },
    [],
  );

  const runLoad = useCallback(
    async (hub: string, dir: BoardDirection, day: number) => {
      const key = boardKey(hub, dir, day);
      setLoading((prev) => ({ ...prev, [key]: true }));
      try {
        const timestamp = getStartOfHubDay(hub, day) as number;
        const cacheKey = aggCacheKey(hub, dir, timestamp);
        const wasCached = aggCache.current.has(cacheKey);
        const result = await fetchWithRetries(hub, dir, timestamp);
        commitBoard(hub, dir, day, result, { detectSwaps: !wasCached });
        // Today's board is the only one where "now" is inside the list, so it is the only
        // one worth anchoring. Tomorrow and yesterday open at the top, as they should. The
        // signal names THIS board: by the time a slow load lands the viewer may be reading a
        // different one, and that board must not be yanked to a NOW line it never asked for.
        if (day === 0) setAutoScroll((prev) => ({ key, n: (prev?.n ?? 0) + 1 }));
        diffWatched((result.flights || []) as Record<string, unknown>[], dir, result.meta ?? null);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Schedule load failed';
        setErrors((prev) => ({ ...prev, [key]: message }));
      } finally {
        setLoading((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
      }
    },
    [commitBoard, diffWatched, fetchWithRetries],
  );

  /**
   * Load a board. One user load runs at a time; a request that arrives mid-flight is held
   * as THE pending one (not queued), so clicking through four hubs opens two aggregations,
   * not four, and always ends on the hub the viewer is actually looking at.
   */
  const load = useCallback(
    async (hub: string, dir: BoardDirection, day: number) => {
      // "All Hubs" is a real selection with no board behind it — the tab shows a prompt.
      if (!hub) return;
      if (activeLoad.current) {
        pendingLoad.current = { hub, dir, day };
        return activeLoad.current;
      }
      const drain = async () => {
        await runLoad(hub, dir, day);
        while (pendingLoad.current) {
          const next = pendingLoad.current;
          pendingLoad.current = null;
          await runLoad(next.hub, next.dir, next.day);
        }
      };
      const promise = drain().finally(() => {
        activeLoad.current = null;
      });
      activeLoad.current = promise;
      return promise;
    },
    [runLoad],
  );

  const refresh = useCallback(() => {
    const { hub, dir, day } = current;
    if (!hub) return;
    try {
      aggCache.current.delete(aggCacheKey(hub, dir, getStartOfHubDay(hub, day) as number));
    } catch {
      /* a bad hub cannot have a cache entry */
    }
    void load(hub, dir, day);
  }, [current, load]);

  /**
   * Warm the three busiest hubs so a search for a not-yet-airborne flight can answer, and
   * so hub health has something to say before the viewer opens the Schedule tab.
   *
   * Sequential on purpose: three concurrent aggregations is three times the upstream burst
   * for no perceived gain, and the TTL lives in `sessionStorage` so a soft navigation or a
   * reload inside ten minutes does not pay for it again.
   */
  const preload = useCallback(() => {
    if (preloadRunning.current) return;
    const session = safeSessionStorage();
    const last = Number(session?.getItem(STORAGE_KEYS.schedPreloadTs) || '0');
    if (Number.isFinite(last) && Date.now() - last < PRELOAD_TTL_MS) return;
    preloadRunning.current = true;
    void (async () => {
      let loaded = 0;
      for (const hub of PRELOAD_HUBS as string[]) {
        const key = boardKey(hub, 'departures', 0);
        if (boardsRef.current[key]) continue;
        try {
          // F022: each hub gets its OWN start-of-day. One Eastern timestamp reused for
          // ORD/DEN/EWR made the API snap to the hub-local day CONTAINING it, fetching
          // yesterday's Denver board round the clock and burning units on the wrong day.
          const timestamp = getStartOfHubDay(hub, 0) as number;
          const result = await fetchBoard(hub, 'departures', timestamp);
          if ((result.flights || []).length) {
            commitBoard(hub, 'departures', 0, result, { detectSwaps: false });
            loaded += 1;
          }
        } catch {
          /* the preload is best-effort — a failed hub costs nothing visible */
        }
      }
      if (loaded > 0) {
        try {
          session?.setItem(STORAGE_KEYS.schedPreloadTs, String(Date.now()));
        } catch {
          /* private mode / quota */
        }
      }
      preloadRunning.current = false;
    })();
  }, [commitBoard, fetchBoard]);

  // The idle warm-up (inventory §30). `requestIdleCallback` where it exists, a 5 s timer
  // where it does not — never on the critical path of first paint.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const idle = (window as unknown as { requestIdleCallback?: (cb: () => void) => number })
      .requestIdleCallback;
    if (typeof idle === 'function') {
      idle(() => preload());
      return undefined;
    }
    const timer = setTimeout(() => preload(), 5000);
    return () => clearTimeout(timer);
  }, [preload]);

  const setCurrent = useCallback((next: Partial<ScheduleCurrent>) => {
    if (next.hub !== undefined) hubChosenByViewer.current = true;
    setCurrentState((prev) => {
      const merged = { ...prev, ...next };
      // `?hub=` is viewer-supplied. An unknown code would fetch a board that cannot exist and
      // show an error where "All Hubs" is the honest answer.
      if (merged.hub && !HUBS.has(merged.hub)) merged.hub = '';
      // Changing hub re-derives the day ONLY while the viewer has not picked one, so a
      // deep link landing on a hub before its rollover hour still opens the useful board.
      if (next.hub !== undefined && next.day === undefined && merged.hub && HUBS.has(merged.hub)) {
        merged.day = defaultSchedDayOffset(merged.hub) as number;
      }
      if (merged.hub === prev.hub && merged.dir === prev.dir && merged.day === prev.day) return prev;
      return merged;
    });
  }, []);

  /**
   * `goto-schedule-result` (inventory §4): select the board the match is on, load it, and
   * ask the table to scroll to the row and flash it. The table owns the scrolling because
   * only it knows which rows survived the filters.
   */
  const goto = useCallback(
    (target: { hub?: string; dir?: BoardDirection; day?: number; flight: string }) => {
      const hub = target.hub && HUBS.has(target.hub) ? target.hub : current.hub;
      const dir = target.dir ?? 'departures';
      // The caller names the board its match came from. Without that, a palette hit found on
      // a day-0 board would load the viewer's own day — which before the hub-local rollover
      // is yesterday, where the row does not exist and the highlight silently gives up.
      const day = target.day ?? current.day;
      hubChosenByViewer.current = true;
      setCurrentState((prev) =>
        prev.hub === hub && prev.dir === dir && prev.day === day ? prev : { ...prev, hub, dir, day },
      );
      setPendingGoto({ flight: target.flight, key: Date.now() });
      void load(hub, dir, day);
    },
    [current.hub, current.day, load],
  );

  const clearGoto = useCallback(() => setPendingGoto(null), []);
  const clearWatchAlert = useCallback(() => setWatchAlert(null), []);

  const rawByHub = useMemo(() => {
    const grouped: Record<string, Record<string, unknown>[]> = {};
    for (const board of Object.values(boards)) {
      grouped[board.hub] = [...(grouped[board.hub] ?? []), ...board.rows];
    }
    return grouped;
  }, [boards]);

  const meta = boards[boardKey(current.hub, current.dir, current.day)]?.meta ?? null;

  const value = useMemo<ScheduleValue>(
    () => ({
      boards,
      loading,
      errors,
      meta,
      load,
      refresh,
      preload,
      current,
      setCurrent,
      goto,
      pendingGoto,
      clearGoto,
      autoScroll,
      nowSec,
      watchAlert,
      clearWatchAlert,
      rawByHub,
    }),
    [
      boards,
      loading,
      errors,
      meta,
      load,
      refresh,
      preload,
      current,
      setCurrent,
      goto,
      pendingGoto,
      clearGoto,
      autoScroll,
      nowSec,
      watchAlert,
      clearWatchAlert,
      rawByHub,
    ],
  );

  return <ScheduleContext.Provider value={value}>{children}</ScheduleContext.Provider>;
}

export type HubHealthEntry = {
  hub: string;
  /** On-time percentage, or null when neither source has a reading yet. */
  otp: number | null;
  /** Which source the number came from — the strip labels a client reading differently. */
  source: 'server' | 'client' | null;
};

/**
 * The merged per-hub on-time reading, in the dashboard's fixed hub order.
 *
 * Server metrics from `/api/irops` take precedence; boards only fill the gaps. A five-flight
 * client sample overwriting the server's much larger one made DEN flap 68 → 100 in a single
 * refresh (audit Jul 3 2026), which is why `mergeHubHealth` drops any client reading for a
 * hub the server has already spoken for.
 */
export function useHubHealth(): { hubs: HubHealthEntry[]; byHub: Record<string, number> } {
  const irops = useIrops();
  const { boards } = useSchedule();

  return useMemo(() => {
    const serverHubs: Record<string, number> = {};
    const metrics = irops.data?.hubMetrics ?? {};
    for (const [hub, entry] of Object.entries(metrics)) {
      const otp = serverOtpFromMetrics(entry) as number | null;
      if (otp !== null) serverHubs[hub] = otp;
    }

    // `computeBoardOtp` reads the DIRECTION out of each key, so it wants the boards keyed
    // `<hub>-<dir>-<day>` exactly as they are stored — not rows grouped by hub, which would
    // score an arrivals board against the departures rule.
    const rowsByKey: Record<string, Record<string, unknown>[]> = {};
    const optsByKey: Record<string, { hubDisruptionMinutes: number }> = {};
    const nowByKey: Record<string, number> = {};
    for (const [key, board] of Object.entries(boards)) {
      rowsByKey[key] = board.rows;
      optsByKey[key] = classifyOptsFor(board.meta);
      nowByKey[key] = Math.floor((board.serverNowMs ?? Date.now()) / 1000);
    }
    const clientOtp = computeBoardOtp(rowsByKey, {
      classify: (flight: object, boardDir: string, key: string) =>
        classifySchedStatus(flight, boardDir as BoardDirection, nowByKey[key], optsByKey[key]),
    }) as Record<string, number>;

    const clientOnly = mergeHubHealth(clientOtp, new Set(Object.keys(serverHubs))) as Record<
      string,
      number
    >;
    const merged = { ...clientOnly, ...serverHubs };
    const hubs: HubHealthEntry[] = (HUB_ORDER as string[]).map((hub) => ({
      hub,
      otp: hub in merged ? merged[hub] : null,
      source: hub in serverHubs ? 'server' : hub in clientOnly ? 'client' : null,
    }));
    return { hubs, byHub: merged };
  }, [irops.data, boards]);
}

export { HUB_ORDER, HUB_TZ };
