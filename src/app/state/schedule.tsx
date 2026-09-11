/**
 * Schedule boards + the merged hub on-time reading.
 *
 * Task 3 fills the loading policy in (60 s abort, `agg-` cache keys, server-clock offset
 * from the `Date`/`Age` headers, three retries with backoff, frozen context, pending
 * reload, the sequential ORD/DEN/EWR preload with a 10-minute session TTL). The store
 * interface, the cache-key shape and `useHubHealth()` are settled here because the shell
 * consumes them from day one.
 *
 * `useHubHealth()` is the arbitration the hub-health strip renders (inventory §3): a
 * SERVER reading from `/api/irops` `hubMetrics` always wins, and a client reading computed
 * from loaded boards only fills hubs the server has not spoken for. That ordering is why it
 * lives next to the board store rather than in the strip component.
 */

import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { HUB_ORDER, mergeHubHealth, serverOtpFromMetrics } from '@/lib/hub-health.js';
import type { ScheduleMeta } from '../data/types';
import { useIrops } from './irops';

export type BoardDirection = 'departures' | 'arrivals';

/** `${hub}-${dir}-${dayOffset}` — the key every board is cached and looked up under. */
export type BoardKey = string;

export function boardKey(hub: string, dir: BoardDirection, day: number): BoardKey {
  return `${hub}-${dir}-${day}`;
}

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
  error: string | null;
};

export type ScheduleCurrent = { hub: string; dir: BoardDirection; day: number };

export type ScheduleValue = {
  boards: Record<BoardKey, Board>;
  /** Per-key loading flags, so one board reloading never blanks another. */
  loading: Record<BoardKey, boolean>;
  meta: ScheduleMeta | null;
  load: (hub: string, dir: BoardDirection, day: number) => Promise<void>;
  preload: () => void;
  current: ScheduleCurrent;
  setCurrent: (next: Partial<ScheduleCurrent>) => void;
  /** Loaded rows grouped by hub — the input `computeBoardOtp()` takes. */
  rawByHub: Record<string, Record<string, unknown>[]>;
};

const ScheduleContext = createContext<ScheduleValue | null>(null);

export function useSchedule(): ScheduleValue {
  const ctx = useContext(ScheduleContext);
  if (!ctx) throw new Error('useSchedule() outside <ScheduleProvider>');
  return ctx;
}

export function ScheduleProvider({
  children,
  defaultHub = 'ORD',
}: {
  children: ReactNode;
  defaultHub?: string;
}) {
  const [boards] = useState<Record<BoardKey, Board>>({});
  const [loading] = useState<Record<BoardKey, boolean>>({});
  const [current, setCurrentState] = useState<ScheduleCurrent>({
    hub: defaultHub,
    dir: 'departures',
    day: 0,
  });

  // Task 3 replaces these two with the real loader; the signatures are what the shell, the
  // search palette and the hub-health arbitration already call.
  const load = useCallback(async () => {}, []);
  const preload = useCallback(() => {}, []);

  const setCurrent = useCallback((next: Partial<ScheduleCurrent>) => {
    setCurrentState((prev) => ({ ...prev, ...next }));
  }, []);

  const rawByHub = useMemo(() => {
    const grouped: Record<string, Record<string, unknown>[]> = {};
    for (const board of Object.values(boards)) {
      grouped[board.hub] = [...(grouped[board.hub] ?? []), ...board.rows];
    }
    return grouped;
  }, [boards]);

  const value = useMemo<ScheduleValue>(
    () => ({ boards, loading, meta: null, load, preload, current, setCurrent, rawByHub }),
    [boards, loading, load, preload, current, setCurrent, rawByHub],
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
 * Server metrics from `/api/irops` take precedence; boards only fill the gaps. Until Task 3
 * loads boards this is the server reading alone, which is exactly what the shipped site
 * showed before any board was opened.
 */
export function useHubHealth(): { hubs: HubHealthEntry[]; byHub: Record<string, number> } {
  const irops = useIrops();

  return useMemo(() => {
    const serverHubs: Record<string, number> = {};
    const metrics = irops.data?.hubMetrics ?? {};
    for (const [hub, entry] of Object.entries(metrics)) {
      const otp = serverOtpFromMetrics(entry) as number | null;
      if (otp !== null) serverHubs[hub] = otp;
    }
    // Client OTP from loaded boards arrives with Task 3. `mergeHubHealth` drops any client
    // reading for a hub the server has already spoken for, so the spread below can never let
    // a board-derived number outrank the server one.
    const clientOtp: Record<string, number> = {};
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
  }, [irops.data]);
}

export { HUB_ORDER };
