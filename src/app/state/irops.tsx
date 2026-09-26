/**
 * `/api/irops` — the network disruption index and per-hub metrics.
 *
 * Two consumers depend on this being one shared fetch rather than two: the Weather tab's
 * IROPS section renders it directly, and the hub-health strip uses `hubMetrics` as the
 * SERVER on-time source that outranks anything computed from loaded schedule boards
 * (inventory §3). Refetched every 5 minutes, skipped while the tab is hidden.
 */

import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { iropsHubRates } from '@/lib/irops-score.js';
import { fetchIrops } from '../data/api';
import type { IropsData } from '../data/types';
import { useJson } from './hooks';

const IROPS_REFRESH_MS = 5 * 60 * 1000;

/** Per-hub counts + the two rates, gated by the small-sample floor (inventory §24). */
export type IropsHubRate = {
  cancellations: number;
  total: number;
  /** null below the floor: a rate off a four-flight board is a lie, not a signal. */
  cancellationRate: number | null;
  delayed60Rate: number | null;
};

export type IropsValue = {
  data: IropsData | null;
  fetchedAt: number | null;
  loading: boolean;
  error: Error | null;
  refresh: () => void;
  /** `hubMetrics` with the §24 rate floor applied — the delay-risk engine's input. */
  hubRates: Record<string, IropsHubRate>;
  /**
   * The severity index the ticker gates on: the server value when there is one, otherwise
   * whatever the Weather tab's client fallback computed off the loaded boards. The server
   * ALWAYS wins (F002 single writer) — a client score can only fill a gap, never overwrite.
   */
  score: number | null;
  /** Called by the Weather tab's client fallback with its own score. */
  reportClientScore: (score: number | null) => void;
};

const IropsContext = createContext<IropsValue | null>(null);

export function useIrops(): IropsValue {
  const ctx = useContext(IropsContext);
  if (!ctx) throw new Error('useIrops() outside <IropsProvider>');
  return ctx;
}

export function IropsProvider({ children }: { children: ReactNode }) {
  const { data, error, loading, updatedAt, refresh } = useJson<IropsData>(() => fetchIrops(), {
    key: 'irops',
    refreshMs: IROPS_REFRESH_MS,
  });

  const [clientScore, setClientScore] = useState<number | null>(null);
  const reportClientScore = useCallback((score: number | null) => setClientScore(score), []);

  const hubRates = useMemo(
    () => iropsHubRates(data?.hubMetrics ?? {}) as Record<string, IropsHubRate>,
    [data],
  );

  const value = useMemo<IropsValue>(
    () => ({
      data,
      fetchedAt: updatedAt,
      loading,
      error,
      refresh,
      hubRates,
      score: data?.score ?? clientScore,
      reportClientScore,
    }),
    [data, updatedAt, loading, error, refresh, hubRates, clientScore, reportClientScore],
  );

  return <IropsContext.Provider value={value}>{children}</IropsContext.Provider>;
}
