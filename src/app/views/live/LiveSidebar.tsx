/**
 * The Live tab's sidebar: hub traffic, phase counts, and a search that filters the map.
 *
 * All three write to the SAME filter state the map reads, so a hub row, a phase row and the
 * search box can never disagree about what is on screen. "⊘ Show all" is the one control
 * that clears every filter at once.
 *
 * A search row names a flight, its route and its tail, and links each (links everywhere, part
 * 2): the flight number to its flight page, a hub end to that hub's Schedule board, the tail to
 * its aircraft dialog. The row itself stays one button (show the flight on the map), stretched
 * under the links; the hub ends and the tail take no taps on a coarse pointer, so on a touch
 * screen the row is still one target with only the flight number above it (the links plan,
 * ruling 3). Hub-traffic and phase rows are filter toggles and name nothing a link could add to.
 *
 * Below `lg` the sidebar is LiveView's Filters sheet, a modal sheet LiveView holds open itself.
 * There `onFollowInPlace` is set: every link is followed as from an overlay (focus moves to the
 * tab it opens) and a link followed in place closes the sheet in the same click, so the reader is
 * not left behind it with focus trapped inside (contract sheet §2, the watch panel's recipe).
 */

import { Building2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { MouseEvent, ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { PHASE_ICONS } from '@/lib/flight-phase.js';
import { matchLiveFlights, normalizeQuery } from '@/lib/global-search.js';
import { hubTraffic } from '@/lib/live-filters.js';
import { liveryForTail } from '@/lib/special-livery.js';
import { cn } from '@/lib/utils';
import type { Flight } from '../../data/types';
import { SCHEDULE_TAB_HREF } from '@/lib/tab-links.js';
import { DashLink } from '../../features/DashLink';
import { HubLink, TailLink } from '../../features/EntityLinks';
import { FlightLink } from '../../features/FlightLink';
import { SpecialLiveryMarker } from '../../features/SpecialLiveryBadge';

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
  /** Rendered first inside the scroll region, under the search (the brief, at `lg`+ only). */
  lead?: ReactNode;
  /**
   * Set when the sidebar is the Filters sheet (below `lg`): called after a link inside it was
   * followed in place, to close the sheet. Its links are then followed as from an overlay.
   */
  onFollowInPlace?: () => void;
};

/** A route end: a hub links to its board (above the row button), any other airport is text. */
function End({ code, fromOverlay }: { code: string; fromOverlay: boolean }) {
  if (!code) return <>?</>;
  return <HubLink code={code} finePointerOnly fromOverlay={fromOverlay} className="z-10" />;
}

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
  lead,
  onFollowInPlace,
}: LiveSidebarProps) {
  const inSheet = Boolean(onFollowInPlace);
  // A link inside the sheet that was followed in place cancelled its click's default
  // (`dashLinkClick`); one left to the browser (a modified click, the flight page) did not.
  const closeAfterFollow = onFollowInPlace
    ? (event: MouseEvent<HTMLDivElement>) => {
        const target = event.target as Element | null;
        if (event.isDefaultPrevented() && target?.closest?.('a[href]')) onFollowInPlace();
      }
    : undefined;

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
    // `onClick` hears its links' clicks as they bubble (Enter on a link is a click too).
    <div className="flex h-full min-h-0 flex-col gap-3" onClick={closeAfterFollow}>
      <div className="space-y-2">
        <Input
          // No text-size override: the Input's own `text-base md:text-sm` keeps phones at 16 px,
          // below which iOS Safari zooms the page on focus.
          className="h-8"
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
                <Building2 aria-hidden="true" className="size-3.5 shrink-0" />
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
                {/* A real link to the tab (it was a button drawn as one). The query is not
                    carried: the Schedule board has no search address. */}
                <DashLink href={SCHEDULE_TAB_HREF} tone="identity" fromOverlay={inSheet}>
                  Check the Schedule tab →
                </DashLink>
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
                  {search.matches.slice(0, MAX_SEARCH_ROWS).map((f) => {
                    const ident = f.flightIATA || f.callsign;
                    return (
                      // The flight number links to its flight page; the rest of the row is the
                      // button that shows the flight on the map, stretched over the row under the
                      // links. A link cannot sit inside a button, so the route and the tail are
                      // its siblings: hub ends and the tail link (a mouse or a keyboard; no taps
                      // on touch), any other airport is text the button's box covers.
                      <li key={f.fr24id} className="relative flex items-center gap-2 px-2.5 py-1.5 text-xs hover:bg-accent">
                        <span className="w-16 shrink-0 font-mono font-medium">
                          <FlightLink ident={ident} linkClassName="z-10" />
                        </span>
                        {/* Covers the row itself (out of the flex flow, so the gaps stay as they were);
                            its ring is drawn inside the row, which the list's scroll would clip. */}
                        <button
                          type="button"
                          className="absolute inset-0 rounded-sm focus-visible:-outline-offset-2"
                          onClick={() => onSelect(f)}
                        >
                          <span className="sr-only">Show {ident} on the map</span>
                        </button>
                        <span className="flex min-w-0 flex-1 items-center gap-2 text-muted-foreground">
                          <span className="font-mono">
                            <End code={f.origin} fromOverlay={inSheet} />→<End code={f.dest} fromOverlay={inSheet} />
                          </span>
                          {f.reg ? (
                            <TailLink
                              reg={f.reg}
                              tone="quiet"
                              finePointerOnly
                              fromOverlay={inSheet}
                              className="z-10 ml-auto truncate"
                            />
                          ) : null}
                          <SpecialLiveryMarker livery={liveryForTail(f.reg)} className="text-muted-foreground" />
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </div>
        ) : null}
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-4 pr-3">
          {lead}
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
                          <span className="text-[9px] text-bb-ok">✓ FILTERED</span>
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
