/**
 * Zone 3, "All Aircraft" — the fleet database itself (inventory §21).
 *
 * Stored and in-maintenance rows are dimmed so a scan down the table separates the aircraft
 * that can fly today from the ones parked at Victorville — but the Status column still spells
 * it out, because dimming is not a signal a screen reader or a greyscale display carries.
 * A named aircraft is never dimmed: `*Sam E. Ashmore` is a NAME in the status column, not a
 * maintenance note, and the shipped table made exactly that distinction.
 *
 * Names with a home link to it (links everywhere, Nov 12 2026). The registration is the row's
 * link-coloured link, to the aircraft dialog in place (`TailLink`); the type is a quiet link to
 * this tab filtered to that type (`fleetRowTypeLink`: by the tail, and plain text once the table
 * is filtered to it, ruling 1); the "SL" mark a quiet link to the Starlink tab. A type followed
 * from here sets the type filter and keeps the search, Wi-Fi and status (ruling 2, FleetView's
 * 'stay'). Every link is 44 px tall on touch inside the cell (`hit="inline"`, as the registration
 * button was), so no touch box reaches into a neighbour's. The named-aircraft chip, livery badge,
 * fleet number, cabin, seats, Wi-Fi, IFE, year and status have no home and stay plain.
 *
 * The zero-results state offers the one control that helps, which is clearing the filters.
 */

import { Star } from 'lucide-react';
import { memo } from 'react';

import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { normalizeWifi } from '@/lib/fleet-utils.js';
import { fleetRowTypeLink } from '@/lib/fleet-view.js';
import { liveryForTail } from '@/lib/special-livery.js';
import { TailLink, TypeLink } from '../../features/EntityLinks';
import { SpecialLiveryBadge } from '../../features/SpecialLiveryBadge';
import type { FleetAircraft } from '../../data/types';
import type { SpecialIndex } from '../../state/fleet';
import { SortableHeader } from './SortableHeader';
import type { SortState } from './SortableHeader';
import { StarlinkRowChip } from './StarlinkRowChip';

export type FleetSortCol = 'r' | 't' | 'a' | 'c' | 'tot' | 'w' | 'i' | 'd' | 's';

const COLUMNS: { col: FleetSortCol; label: string }[] = [
  { col: 'r', label: 'Reg' },
  { col: 't', label: 'Type' },
  { col: 'a', label: 'AC#' },
  { col: 'c', label: 'Config' },
  { col: 'tot', label: 'Seats' },
  { col: 'w', label: 'WiFi' },
  { col: 'i', label: 'IFE' },
  { col: 'd', label: 'Del' },
  { col: 's', label: 'Status' },
];

/**
 * Memoised: the table is about 1,150 rows of links, and FleetView re-renders on every feed poll and
 * every UI store change, none of which changes these props (FleetView keeps them stable).
 */
export const FleetTable = memo(function FleetTable({
  rows,
  sort,
  onSort,
  starlinkTails,
  special,
  filtersActive,
  onClearFilters,
  hiddenHint = null,
  onShowHidden,
  fleetByReg,
  typeFilter,
}: {
  rows: FleetAircraft[];
  sort: SortState<FleetSortCol>;
  onSort: (col: FleetSortCol) => void;
  starlinkTails: Set<string>;
  special: SpecialIndex;
  filtersActive: boolean;
  onClearFilters: () => void;
  /** The search matches aircraft the other filters hide (searchHiddenByFilters). */
  hiddenHint?: { message: string; plural: boolean } | null;
  onShowHidden?: () => void;
  /** The fleet database by registration: a row's type links by its tail. */
  fleetByReg: Record<string, FleetAircraft>;
  /** The type filter ('' for none): a type cell equal to it is plain text. */
  typeFilter: string;
}) {
  if (rows.length === 0 && filtersActive) {
    return (
      <div className="rounded-lg border border-dashed p-6 text-center" role="status">
        <p className="text-sm">{hiddenHint ? hiddenHint.message : 'No aircraft match your filters.'}</p>
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          {hiddenHint && onShowHidden ? (
            <Button size="lg" className="min-h-11 pointer-fine:md:min-h-0" onClick={onShowHidden}>
              {hiddenHint.plural ? 'Show them' : 'Show it'}
            </Button>
          ) : null}
          <Button variant="outline" size="lg" className="min-h-11 pointer-fine:md:min-h-0" onClick={onClearFilters}>
            Clear Filters
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      tabIndex={0}
      aria-label="Fleet table, scrollable region"
      className="max-h-[60svh] overflow-auto rounded-lg border focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
    >
      <Table>
        <TableHeader className="sticky top-0 z-10 bg-card">
          <TableRow>
            {COLUMNS.map(({ col, label }) => (
              <SortableHeader key={col} col={col} label={label} sort={sort} onSort={onSort} />
            ))}
            <TableHead scope="col">SL</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((aircraft) => {
            const specialEntry = special.get(aircraft.r);
            const status = aircraft.s || '';
            // Named aircraft carry their name in the status column; only a genuine
            // maintenance or storage note dims the row.
            const dim = status && !specialEntry;
            const stored = dim && status.toLowerCase().includes('stored');
            return (
              <TableRow
                key={aircraft.r}
                className={stored ? 'opacity-55' : dim ? 'opacity-75' : undefined}
              >
                <TableCell className="font-mono">
                  <TailLink reg={aircraft.r} hit="inline" />
                  {specialEntry ? (
                    <span className="ml-1 inline-flex items-center gap-0.5 rounded border px-1 py-0.5 text-[9px] text-foreground">
                      <Star aria-hidden="true" className="size-2.5" /> {specialEntry.name}
                    </span>
                  ) : null}
                  <SpecialLiveryBadge livery={liveryForTail(aircraft.r)} variant="compact" className="ml-1" />
                </TableCell>
                <TableCell>
                  <TypeLink typeCode={fleetRowTypeLink(aircraft.r, fleetByReg, typeFilter)} hit="inline">
                    {aircraft.t}
                  </TypeLink>
                </TableCell>
                <TableCell className="font-mono tabular-nums">{aircraft.a ?? ''}</TableCell>
                <TableCell className="font-mono text-xs">{aircraft.c ?? ''}</TableCell>
                <TableCell className="font-mono tabular-nums">{aircraft.tot ?? ''}</TableCell>
                <TableCell className="text-xs">{normalizeWifi(aircraft.w) as string}</TableCell>
                <TableCell className="text-xs">{aircraft.i ?? ''}</TableCell>
                <TableCell className="font-mono tabular-nums">{aircraft.d ?? ''}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{status}</TableCell>
                <TableCell>{starlinkTails.has(aircraft.r) ? <StarlinkRowChip /> : null}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
});

export default FleetTable;
