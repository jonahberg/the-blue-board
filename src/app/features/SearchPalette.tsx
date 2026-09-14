/**
 * ⌘K — find a flight.
 *
 * `shouldFilter={false}` on the inner `Command`: cmdk's own fuzzy filter would re-rank
 * results that `src/lib/global-search.js` has already matched and ordered, and its scoring
 * does not understand flight numbers or route pairs ("ORD DEN", "ORDDEN", "ORD to DEN" all
 * have to behave the same).
 *
 * When nothing airborne matches a query that LOOKS like a flight number, the palette offers
 * a schedule lookup rather than a dead end — a flight that has not taken off yet is the
 * single most common reason for an empty result.
 */

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
  matchLiveFlights,
  matchScheduleFlights,
  normalizeQuery,
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
  const { searchOpen, setSearchOpen, select, openFr24, setTab } = useUi();
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
    return flights.filter((f) => matchLiveFlights([f], qNorm).length > 0).slice(0, MAX_RESULTS);
  }, [flights, qNorm]);

  /**
   * Scheduled-but-not-airborne matches (inventory §4). A flight that has not taken off yet
   * is the single most common reason a search comes back empty, so the boards already loaded
   * are searched too and each hit navigates to its row rather than just to the tab.
   */
  const scheduleMatches = useMemo(() => {
    if (qNorm.length < 2) return [] as { key: string; label: string; hub: string; flight: string }[];
    const seen = new Set<string>();
    const found: { key: string; label: string; hub: string; flight: string }[] = [];
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
      <Command shouldFilter={false}>
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
                <CommandItem
                  key={flight.fr24id}
                  value={flight.fr24id}
                  onSelect={() => {
                    select({ kind: 'flight', flight });
                    setSearchOpen(false);
                  }}
                >
                  <span aria-hidden="true">✈️</span>
                  <span className="font-mono font-medium">
                    {flight.flightIATA || flight.callsign}
                  </span>
                  <span className="font-mono text-muted-foreground">
                    {flight.origin || '?'} → {flight.dest || '?'}
                  </span>
                  <span className="ml-auto font-mono text-xs text-muted-foreground">
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
                    goto({ hub: match.hub, dir: 'departures', flight: match.flight });
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
                    <span aria-hidden="true">🔎</span>
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
                  <span aria-hidden="true">📅</span>
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
