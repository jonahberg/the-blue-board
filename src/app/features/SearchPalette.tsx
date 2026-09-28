/**
 * ⌘K — find a flight.
 *
 * `shouldFilter={false}` on the inner `Command`: cmdk's own fuzzy filter would re-rank
 * results that `rankLiveFlights()` in `src/lib/global-search.js` has already matched and
 * ranked (exact ident, then prefix, then route, then substring — F2), and its scoring does not
 * understand flight numbers or route pairs ("ORD DEN", "ORDDEN", "ORD to DEN" all have to
 * behave the same). The 20-row cap is applied AFTER ranking, so an airborne exact match can
 * never be sliced off.
 *
 * The highlighted row is controlled here (F7). Results land 150 ms after the keystroke, and
 * cmdk picks its "first item" against the rows still on screen from the previous query, then
 * never re-picks when those unmount — which left Enter bound to a row that no longer existed.
 *
 * When nothing airborne matches a query that LOOKS like a flight number, the palette offers
 * a schedule lookup rather than a dead end — a flight that has not taken off yet is the
 * single most common reason for an empty result.
 */

import { CalendarDays, Plane, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  FR24_LOOKUP_RE,
  classifyEmptyState,
  matchScheduleFlights,
  normalizeQuery,
  rankLiveFlights,
} from '@/lib/global-search.js';
import { FR24_LOOKUP_AVAILABLE } from './Fr24LookupDialog';
import { useFeed } from '../state/feed';
import { useSchedule } from '../state/schedule';
import { useUi } from '../state/ui';

const MAX_RESULTS = 20;

/** One schedule row a query matched, as `matchScheduleFlights()` shapes it. */
type ScheduleMatch = {
  label: string;
  flight: {
    identification?: { number?: { default?: string } };
    airport?: { origin?: { code?: { iata?: string } } };
  };
};

export function SearchPalette() {
  const { searchOpen, setSearchOpen, select, openFr24, setTab, focusOn } = useUi();
  const { flights } = useFeed();
  const { boards, goto, preload } = useSchedule();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), 150);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!searchOpen) setQuery('');
  }, [searchOpen]);

  const { qNorm } = normalizeQuery(debounced) as { q: string; qNorm: string };

  const matches = useMemo(() => {
    if (qNorm.length < 2) return [];
    return (rankLiveFlights(flights, qNorm) as typeof flights).slice(0, MAX_RESULTS);
  }, [flights, qNorm]);

  /**
   * Scheduled-but-not-airborne matches (inventory §4). A flight that has not taken off yet
   * is the single most common reason a search comes back empty, so the boards already loaded
   * are searched too and each hit navigates to its row rather than just to the tab.
   */
  const scheduleMatches = useMemo(() => {
    if (qNorm.length < 2)
      return [] as { key: string; label: string; hub: string; day: number; flight: string }[];
    const seen = new Set<string>();
    const found: { key: string; label: string; hub: string; day: number; flight: string }[] = [];
    for (const board of Object.values(boards)) {
      if (board.dir !== 'departures') continue;
      for (const match of matchScheduleFlights(board.rows, qNorm) as ScheduleMatch[]) {
        const ident = match.flight.identification?.number?.default || '';
        if (!ident || seen.has(ident)) continue;
        seen.add(ident);
        found.push({
          key: `${board.hub}-${ident}`,
          label: match.label,
          hub: match.flight.airport?.origin?.code?.iata || board.hub,
          // The board the match was found ON, not the viewer's current day: before a hub's
          // local rollover their day is -1, where this row does not exist.
          day: board.day,
          flight: ident,
        });
        if (found.length >= MAX_RESULTS) return found;
      }
    }
    return found;
  }, [boards, qNorm]);

  /**
   * F043: the boards only populate once someone opens the Schedule tab or the idle warm-up
   * runs. A query that finds nothing anywhere kicks the preload so the same search a moment
   * later can answer — `preload()` is itself TTL-guarded, so this cannot stampede.
   */
  useEffect(() => {
    if (qNorm.length < 2) return;
    if (matches.length || scheduleMatches.length) return;
    preload();
  }, [qNorm, matches.length, scheduleMatches.length, preload]);

  /**
   * A bare number means a UA flight number — "1234" and "UA1234" are the same query.
   * Null while the lookup cannot answer (see `FR24_LOOKUP_AVAILABLE`): the palette must not
   * offer a row that opens nothing.
   */
  const lookupIdent =
    FR24_LOOKUP_AVAILABLE && FR24_LOOKUP_RE.test(qNorm)
      ? qNorm.startsWith('UA')
        ? qNorm
        : `UA${qNorm}`
      : null;
  const empty = classifyEmptyState(qNorm) as { kind: string; display: string };

  // The row Enter acts on: always the first result of the CURRENT result set (F7).
  const firstValue =
    matches[0]?.fr24id ??
    scheduleMatches[0]?.key ??
    (qNorm.length >= 2 ? (lookupIdent ? `lookup-${lookupIdent}` : 'goto-schedule') : '');
  const [selected, setSelected] = useState('');
  useEffect(() => {
    setSelected(firstValue);
  }, [firstValue, qNorm]);

  /**
   * The contextual empty state (inventory §4). It is rendered in two places on purpose:
   * `CommandEmpty` only mounts while cmdk counts ZERO items, and the "Not airborne" group
   * below always offers at least the Schedule row — so relying on `CommandEmpty` alone
   * would silently swallow this sentence for every no-match query.
   */
  const emptyMessage =
    qNorm.length < 2
      ? 'Type a flight number, tail number, or route.'
      : empty.kind === 'flight'
        ? `${empty.display} is not airborne right now — ${
            FR24_LOOKUP_AVAILABLE
              ? 'try the schedule lookup below, or the Schedule tab.'
              : 'check the Schedule tab for its board.'
          }`
        : empty.kind === 'tail'
          ? `${empty.display} is not in the live feed right now.`
          : 'Nothing airborne matches that.';

  return (
    <CommandDialog
      open={searchOpen}
      onOpenChange={setSearchOpen}
      title="Find a flight"
      description="Search by flight number, tail number, or route"
    >
      <Command
        shouldFilter={false}
        value={selected}
        onValueChange={setSelected}
        label="Find a flight"
      >
        <CommandInput
          placeholder="UA1234, N12345, or ORD-DEN…"
          value={query}
          onValueChange={setQuery}
        />
        <CommandList>
          <CommandEmpty>{emptyMessage}</CommandEmpty>

          {matches.length > 0 ? (
            <CommandGroup heading="Airborne now">
              {matches.map((flight) => (
                // The shadcn item appends a hidden check icon with its own `ml-auto`; two auto
                // margins split the free space and the aircraft column drifted with the ident
                // length (F66). These rows never show a check, so the icon is hidden.
                <CommandItem
                  key={flight.fr24id}
                  value={flight.fr24id}
                  className="[&>svg:last-child]:hidden"
                  onSelect={() => {
                    select({ kind: 'flight', flight });
                    // An airborne result goes to the map, centred on the flight (legacy parity).
                    if (Number.isFinite(flight.lat) && Number.isFinite(flight.lon)) {
                      focusOn(flight.lat, flight.lon);
                    }
                    setSearchOpen(false);
                  }}
                >
                  <Plane aria-hidden="true" />
                  {/* Fixed-width ident so the route column starts in the same place for
                      UA19 and UA1844 (7ch also fits a UAL callsign fallback). */}
                  <span className="w-[7ch] shrink-0 font-mono font-medium">
                    {flight.flightIATA || flight.callsign}
                  </span>
                  <span className="shrink-0 font-mono text-muted-foreground">
                    {flight.origin || '?'} → {flight.dest || '?'}
                  </span>
                  <span className="ml-auto text-right font-mono text-xs text-muted-foreground tabular-nums">
                    {flight.acType} {flight.reg}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}

          {scheduleMatches.length > 0 ? (
            <CommandGroup heading="On a loaded board">
              {scheduleMatches.map((match) => (
                <CommandItem
                  key={match.key}
                  value={match.key}
                  onSelect={() => {
                    goto({ hub: match.hub, dir: 'departures', day: match.day, flight: match.flight });
                    setTab('schedule');
                    setSearchOpen(false);
                  }}
                >
                  <span className="font-mono text-muted-foreground">{match.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}

          {qNorm.length >= 2 && matches.length === 0 && scheduleMatches.length === 0 ? (
            <>
              {/* role=presentation for the same reason cmdk gives its own CommandEmpty one:
                  this sits inside the list's role="listbox" and is not an option. */}
              <p role="presentation" className="px-3 pt-3 pb-1 text-xs text-muted-foreground">
                {emptyMessage}
              </p>
              <CommandGroup heading="Not airborne">
                {lookupIdent ? (
                  <CommandItem
                    value={`lookup-${lookupIdent}`}
                    onSelect={() => {
                      openFr24(lookupIdent);
                      setSearchOpen(false);
                    }}
                  >
                    <Search aria-hidden="true" />
                    Look up <span className="font-mono font-medium">{lookupIdent}</span> times and
                    gates
                  </CommandItem>
                ) : null}
                <CommandItem
                  value="goto-schedule"
                  onSelect={() => {
                    setTab('schedule');
                    setSearchOpen(false);
                  }}
                >
                  <CalendarDays aria-hidden="true" />
                  Open the Schedule tab
                </CommandItem>
              </CommandGroup>
            </>
          ) : null}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
