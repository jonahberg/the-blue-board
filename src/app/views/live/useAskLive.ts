/**
 * "Ask the board" on the live map: applies an answer through the map's own controls where it has
 * them, and returns ONE predicate for the rest (src/lib/ask-apply.js makeLiveAskPredicate).
 *
 *   hub       → the sidebar's hub filter (and the map centres on it, as picking it there does)
 *   starlink  → the Starlink highlight is switched on, and the predicate filters
 *   region    → the "fly to" preset frames it, and the predicate filters (the preset only frames)
 *   the rest  → the predicate
 *
 * The phase filter is reset: the map filters itself to the question, not the question plus an
 * older choice. If the visitor later changes the hub, the Starlink layer or the region themselves,
 * that chip goes, so a chip never shows a filter that is no longer in force.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';

import { makeLiveAskPredicate } from '@/lib/ask-apply.js';
import { AIRPORTS } from '@/lib/airports.js';
import { clearAsk, useAskDrift, useAskFor } from '../../state/ask';
import { useUi } from '../../state/ui';
import type { AskFilters } from '../../state/ask';
import type { Flight } from '../../data/types';

type Deps = {
  hubFilter: string;
  setHubFilter: (hub: string) => void;
  setPhaseFilter: (phase: string) => void;
  starlinkFilter: boolean;
  setStarlinkFilter: (on: boolean) => void;
  regionId: string | null;
  onRegion: (id: string) => void;
  isStarlink: (flight: Flight) => boolean;
};

const HUB_POSITIONS = new Map(
  (AIRPORTS as { iata: string; lat: number; lon: number; hub?: boolean }[])
    .filter((a) => a.hub)
    .map((a) => [a.iata, a] as const),
);

export function useAskLive(deps: Deps) {
  const ask = useAskFor('live');
  const { focusOn } = useUi();
  const { setHubFilter, setPhaseFilter, setStarlinkFilter, onRegion } = deps;
  const focusHub = useCallback(
    (hub: string) => {
      const airport = HUB_POSITIONS.get(hub);
      if (airport) focusOn(airport.lat, airport.lon);
    },
    [focusOn],
  );

  const applied = useRef(0);
  useEffect(() => {
    if (!ask || applied.current === ask.key) return;
    applied.current = ask.key;
    const { hub, starlink, region } = ask.filters;
    setHubFilter(hub ?? '');
    setPhaseFilter('');
    if (starlink === true) setStarlinkFilter(true);
    if (region) onRegion(region);
    else if (hub) focusHub(hub);
  }, [ask, setHubFilter, setPhaseFilter, setStarlinkFilter, onRegion, focusHub]);

  const key = ask?.key ?? 0;
  const f = ask?.filters;
  useAskDrift(Boolean(f?.hub), key, deps.hubFilter === f?.hub, 'hub');
  useAskDrift(f?.starlink === true, key, deps.starlinkFilter, 'starlink');
  useAskDrift(Boolean(f?.region), key, deps.regionId === f?.region, 'region');

  const predicate = useMemo(
    () => (f ? (makeLiveAskPredicate(f, { isStarlink: deps.isStarlink as (x: object) => boolean }) as (x: Flight) => boolean) : null),
    [f, deps.isStarlink],
  );

  const apply = useCallback(
    (flights: Flight[]) => (predicate ? flights.filter(predicate) : flights),
    [predicate],
  );

  /** A chip's control goes back to its resting state as the chip goes. */
  const onRemove = useCallback(
    (name: keyof AskFilters) => {
      if (name === 'hub') setHubFilter('');
      if (name === 'starlink') setStarlinkFilter(false);
    },
    [setHubFilter, setStarlinkFilter],
  );

  const onClear = useCallback(() => {
    if (f?.hub) setHubFilter('');
    if (f?.starlink === true) setStarlinkFilter(false);
  }, [f, setHubFilter, setStarlinkFilter]);

  const active = Boolean(ask);
  return useMemo(() => ({ active, apply, onRemove, onClear, clear: clearAsk }), [active, apply, onRemove, onClear]);
}
