/**
 * "Ask the board" on the Starlink tab: a hub picks the hub departures board's hub (as its own hub
 * buttons do); a tail goes into the roster search.
 */

import { useCallback, useMemo } from 'react';

import { scrollBehavior } from '@/lib/motion.js';
import { clearAsk, useApplyAsk, useAskDrift, useAskFor } from '../../state/ask';
import type { AskFilters } from '../../state/ask';

type Deps = {
  boardHub: string | null;
  onBoardHub: (hub: string | null) => void;
  search: string;
  onSearch: (value: string) => void;
};

export function useAskStarlink(deps: Deps) {
  const ask = useAskFor('starlink');
  const f = ask?.filters;
  const { onBoardHub, onSearch } = deps;

  const applied = useApplyAsk('starlink', (filters) => {
    if (filters.hub) onBoardHub(filters.hub);
    if (filters.tail) onSearch(filters.tail);
    const target = document.getElementById(filters.tail ? 'sl-roster-title' : 'sl-board');
    if (target) requestAnimationFrame(() => target.scrollIntoView({ behavior: scrollBehavior(), block: 'start' }));
  });

  const key = ask?.key ?? 0;
  useAskDrift(Boolean(f?.hub), key, deps.boardHub === f?.hub, 'hub');
  useAskDrift(Boolean(f?.tail), key, deps.search === f?.tail, 'tail');

  const onRemove = useCallback(
    (name: keyof AskFilters) => {
      if (name === 'hub') onBoardHub(null);
      if (name === 'tail') onSearch('');
    },
    [onBoardHub, onSearch],
  );
  const onClear = useCallback(() => {
    if (f?.hub) onBoardHub(null);
    if (f?.tail) onSearch('');
  }, [f, onBoardHub, onSearch]);

  const active = Boolean(ask);
  return useMemo(
    () => ({ active, applied, target: f?.tail ? 'roster' : f?.hub ? 'board' : null, onRemove, onClear, clear: clearAsk }),
    [active, applied, f, onRemove, onClear],
  );
}
