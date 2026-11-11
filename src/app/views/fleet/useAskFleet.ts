/**
 * "Ask the board" on the Fleet tab: the table's own search and status filter carry the answer
 * (src/lib/ask-apply.js fleetAskPatch). A type, a family or a tail becomes the search (which matches
 * registrations and type names); Starlink becomes "Status: Starlink". The type and Wi-Fi selects
 * are reset and the All Aircraft list is shown and scrolled to, so the count is the list's.
 */

import { useCallback, useMemo } from 'react';

import { fleetAskPatch } from '@/lib/ask-apply.js';
import { clearAsk, useApplyAsk, useAskDrift, useAskFor } from '../../state/ask';
import type { AskFilters } from '../../state/ask';

type Deps = {
  search: string;
  setSearch: (value: string) => void;
  setTypeFilter: (value: string) => void;
  setWifiFilter: (value: string) => void;
  statusFilter: string;
  setStatusFilter: (value: string) => void;
  showAll: () => void;
};

export function useAskFleet(deps: Deps) {
  const ask = useAskFor('fleet');
  const f = ask?.filters;
  const patch = useMemo(() => (f ? (fleetAskPatch(f) as { search: string; status: string }) : null), [f]);
  const { setSearch, setTypeFilter, setWifiFilter, setStatusFilter, showAll } = deps;

  const applied = useApplyAsk('fleet', (filters) => {
    const p = fleetAskPatch(filters) as { search: string; type: string; wifi: string; status: string };
    setSearch(p.search);
    setTypeFilter(p.type);
    setWifiFilter(p.wifi);
    setStatusFilter(p.status);
    showAll();
  });

  const key = ask?.key ?? 0;
  const searchName: keyof AskFilters | null = f?.tail ? 'tail' : f?.type ? 'type' : f?.family ? 'family' : null;
  useAskDrift(Boolean(searchName), key, deps.search === patch?.search, searchName ?? 'family');
  useAskDrift(f?.starlink === true, key, deps.statusFilter === 'starlink', 'starlink');

  const onRemove = useCallback(
    (name: keyof AskFilters) => {
      if (name === 'starlink') setStatusFilter('');
      else setSearch('');
    },
    [setSearch, setStatusFilter],
  );
  const onClear = useCallback(() => {
    if (patch?.search) setSearch('');
    if (patch?.status) setStatusFilter('');
  }, [patch, setSearch, setStatusFilter]);

  const active = Boolean(ask);
  return useMemo(() => ({ active, applied, onRemove, onClear, clear: clearAsk }), [active, applied, onRemove, onClear]);
}
