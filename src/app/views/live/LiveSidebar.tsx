/**
 * The Live tab's sidebar: hub traffic, phase counts, and a search that filters the map.
 *
 * All three write to the SAME filter state the map reads, so a hub row, a phase row and the
 * search box can never disagree about what is on screen. "⊘ Show all" is the one control
 * that clears every filter at once.
 */

import { useEffect, useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { PHASE_ICONS } from '@/lib/flight-phase.js';
import { matchLiveFlights, normalizeQuery } from '@/lib/global-search.js';
import { hubTraffic } from '@/lib/live-filters.js';
import { cn } from '@/lib/utils';
import type { Flight } from '../../data/types';

/** The five buckets `getPhaseGroup()` collapses the seven phases into. */
const PHASE_ROWS: { group: string; label: string }[] = [
  { group: 'Ground', label: 'Ground' },
  { group: 'Climb', label: 'Climb' },
  { group: 'Cruise', label: 'Cruise' },
  { group: 'Descent', label: 'Descent' },
  { group: 'Approach', label: 'Approach' },
];

/** Sidebar search caps at 50 rows; the header says so rather than truncating silently. */
const MAX_SEARCH_ROWS = 50;

export type LiveSidebarProps = {
  flights: Flight[];
  filtered: Flight[];
  hubCodes: string[];
  hubFilter: string;
  phaseFilter: string;
  phaseCounts: Record<string, number>;
  onHubFilter: (hub: string) => void;
  onPhaseFilter: (group: string) => void;
  onClearFilters: () => void;
  onSelect: (flight: Flight) => void;
  onGoToSchedule: () => void;
};

export function LiveSidebar({
  flights,
  filtered,
  hubCodes,
  hubFilter,
  phaseFilter,
  phaseCounts,
  onHubFilter,
  onPhaseFilter,
  onClearFilters,
  onSelect,
  onGoToSchedule,
}: LiveSidebarProps) {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');

  // 150 ms: long enough that a fast typist does not re-scan 600 flights per keystroke,
  // short enough that the list feels attached to the keyboard.
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), 150);
    return () => clearTimeout(timer);
  }, [query]);

  const traffic = useMemo(() => hubTraffic(flights, hubCodes), [flights, hubCodes]);

  const search = useMemo(() => {
    const { qNorm } = normalizeQuery(debounced) as { q: string; qNorm: string };
    if (qNorm.length < 2) return null;
    const matches = flights.filter((f) => matchLiveFlights([f], qNorm).length > 0);
    const hubMatch = hubCodes.find((code) => code === qNorm);
    return { qNorm, matches, hubMatch };
  }, [debounced, flights, hubCodes]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="space-y-2">
        <Input
          className="h-8 text-sm"
          placeholder="Search flight, tail or route"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Search the live feed"
        />
        {search ? (
          <div className="rounded-md border">
            {search.hubMatch ? (
              <button
                type="button"
                className="flex w-full items-center gap-2 border-b px-2.5 py-2 text-left text-xs hover:bg-accent"
                onClick={() => onHubFilter(search.hubMatch as string)}
              >
                <span aria-hidden="true">🏢</span>
                Filter map to {search.hubMatch}
                <span className="ml-auto font-mono text-muted-foreground">
                  {
                    traffic.rows.find((row) => row.hub === search.hubMatch)?.total ?? 0
                  }{' '}
                  flights
                </span>
              </button>
            ) : null}
            {search.matches.length === 0 ? (
              <div className="space-y-1 px-2.5 py-3 text-xs text-muted-foreground">
                <p>Nothing airborne matches “{debounced.trim()}”.</p>
                <Button variant="link" className="h-auto p-0 text-xs" onClick={onGoToSchedule}>
                  Check the Schedule tab →
                </Button>
              </div>
            ) : (
              <>
                <p className="border-b px-2.5 py-1.5 text-[11px] text-muted-foreground">
                  {search.matches.length} flight{search.matches.length === 1 ? '' : 's'} found
                  {search.matches.length > MAX_SEARCH_ROWS
                    ? ` (showing ${MAX_SEARCH_ROWS})`
                    : ''}
                </p>
                <ul className="max-h-56 overflow-y-auto">
                  {search.matches.slice(0, MAX_SEARCH_ROWS).map((f) => (
                    <li key={f.fr24id}>
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs hover:bg-accent"
                        onClick={() => onSelect(f)}
                      >
                        <span className="w-16 font-mono font-medium">
                          {f.flightIATA || f.callsign}
                        </span>
                        <span className="font-mono text-muted-foreground">
                          {f.origin || '?'}→{f.dest || '?'}
                        </span>
                        <span className="ml-auto truncate text-muted-foreground">{f.reg}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        ) : null}
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-4 pr-3">
          <section>
            <div className="mb-1.5 flex items-center justify-between">
              <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Hub traffic
              </h3>
              <Button variant="ghost" size="sm" className="h-6 text-[11px]" onClick={onClearFilters}>
                ⊘ Show all
              </Button>
            </div>
            <ul className="space-y-1.5">
              {traffic.rows.map((row) => {
                const selected = hubFilter === row.hub;
                return (
                  <li key={row.hub}>
                    <button
                      type="button"
                      aria-pressed={selected}
                      onClick={() => onHubFilter(selected ? '' : row.hub)}
                      className={cn(
                        'w-full rounded-md px-2 py-1 text-left hover:bg-accent',
                        selected && 'bg-accent',
                      )}
                    >
                      <span className="flex items-center gap-2 text-xs">
                        <span className="font-mono font-medium">{row.hub}</span>
                        {row.busiest ? (
                          <Badge variant="outline" className="h-4 px-1 text-[9px]">
                            BUSIEST
                          </Badge>
                        ) : null}
                        {selected ? (
                          <span className="text-[9px] text-emerald-400">✓ FILTERED</span>
                        ) : null}
                        <span className="ml-auto font-mono text-muted-foreground">
                          ↗ {row.outbound} ↙ {row.inbound}
                        </span>
                      </span>
                      <span
                        className="mt-1 block h-1 w-full overflow-hidden rounded-full bg-muted"
                        aria-hidden="true"
                      >
                        <span
                          className="block h-full rounded-full bg-primary"
                          style={{ width: `${row.pct}%` }}
                        />
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>

          <section>
            <h3 className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Phase
            </h3>
            <ul className="space-y-1">
              {PHASE_ROWS.map((row) => {
                const selected = phaseFilter === row.group;
                return (
                  <li key={row.group}>
                    <button
                      type="button"
                      aria-pressed={selected}
                      onClick={() => onPhaseFilter(selected ? '' : row.group)}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-md px-2 py-1 text-xs hover:bg-accent',
                        selected && 'bg-accent',
                      )}
                    >
                      <span aria-hidden="true">
                        {(PHASE_ICONS as Record<string, string>)[row.group] ?? '✈️'}
                      </span>
                      {row.label}
                      <span className="ml-auto font-mono tabular-nums text-muted-foreground">
                        {phaseCounts[row.group] ?? 0}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>

          <p className="text-[11px] text-muted-foreground">
            Showing {filtered.length.toLocaleString()} of {flights.length.toLocaleString()}{' '}
            flights.
          </p>
        </div>
      </ScrollArea>
    </div>
  );
}
