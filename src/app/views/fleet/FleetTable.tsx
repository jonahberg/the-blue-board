/**
 * Zone 3, "All Aircraft" — the fleet database itself (inventory §21).
 *
 * Stored and in-maintenance rows are dimmed so a scan down the table separates the aircraft
 * that can fly today from the ones parked at Victorville — but the Status column still spells
 * it out, because dimming is not a signal a screen reader or a greyscale display carries.
 * A named aircraft is never dimmed: `*Sam E. Ashmore` is a NAME in the status column, not a
 * maintenance note, and the shipped table made exactly that distinction.
 *
 * Every registration is a button into the aircraft dialog; the zero-results state offers the
 * one control that helps, which is clearing the filters.
 */

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
import type { FleetAircraft } from '../../data/types';
import type { SpecialIndex } from '../../state/fleet';
import { SortableHeader } from './SortableHeader';
import type { SortState } from './SortableHeader';

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

export function FleetTable({
  rows,
  sort,
  onSort,
  starlinkTails,
  special,
  filtersActive,
  onClearFilters,
  onOpenAircraft,
}: {
  rows: FleetAircraft[];
  sort: SortState<FleetSortCol>;
  onSort: (col: FleetSortCol) => void;
  starlinkTails: Set<string>;
  special: SpecialIndex;
  filtersActive: boolean;
  onClearFilters: () => void;
  onOpenAircraft: (reg: string) => void;
}) {
  if (rows.length === 0 && filtersActive) {
    return (
      <div className="rounded-lg border border-dashed p-6 text-center">
        <p className="text-sm">No aircraft match your filters.</p>
        <Button variant="outline" size="lg" className="mt-3 min-h-11 md:min-h-0" onClick={onClearFilters}>
          Clear Filters
        </Button>
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
                  <button
                    type="button"
                    onClick={() => onOpenAircraft(aircraft.r)}
                    className="min-h-11 text-primary underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring md:min-h-0"
                  >
                    {aircraft.r}
                  </button>
                  {specialEntry ? (
                    <span className="ml-1 rounded border px-1 py-0.5 text-[9px] text-amber-400">
                      ⭐ {specialEntry.name}
                    </span>
                  ) : null}
                </TableCell>
                <TableCell>{aircraft.t}</TableCell>
                <TableCell className="font-mono tabular-nums">{aircraft.a ?? ''}</TableCell>
                <TableCell className="font-mono text-xs">{aircraft.c ?? ''}</TableCell>
                <TableCell className="font-mono tabular-nums">{aircraft.tot ?? ''}</TableCell>
                <TableCell className="text-xs">{normalizeWifi(aircraft.w) as string}</TableCell>
                <TableCell className="text-xs">{aircraft.i ?? ''}</TableCell>
                <TableCell className="font-mono tabular-nums">{aircraft.d ?? ''}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{status}</TableCell>
                <TableCell>
                  {starlinkTails.has(aircraft.r) ? (
                    <span className="rounded border border-violet-500/30 bg-violet-500/10 px-1 py-0.5 text-[9px] font-medium text-violet-300">
                      SL
                    </span>
                  ) : null}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

export default FleetTable;
