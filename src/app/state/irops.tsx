/**
 * `/api/irops` — the network disruption index and per-hub metrics.
 *
 * Two consumers depend on this being one shared fetch rather than two: the Weather tab's
 * IROPS section renders it directly, and the hub-health strip uses `hubMetrics` as the
 * SERVER on-time source that outranks anything computed from loaded schedule boards
 * (inventory §3). Refetched every 5 minutes, skipped while the tab is hidden.
 */

import { createContext, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';

import { fetchIrops } from '../data/api';
import type { IropsData } from '../data/types';
import { useJson } from './hooks';

const IROPS_REFRESH_MS = 5 * 60 * 1000;

export type IropsValue = {
  data: IropsData | null;
  fetchedAt: number | null;
  loading: boolean;
  error: Error | null;
  refresh: () => void;
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

  const value = useMemo<IropsValue>(
    () => ({ data, fetchedAt: updatedAt, loading, error, refresh }),
    [data, updatedAt, loading, error, refresh],
  );

  return <IropsContext.Provider value={value}>{children}</IropsContext.Provider>;
}
