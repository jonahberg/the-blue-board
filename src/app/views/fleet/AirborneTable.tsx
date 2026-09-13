/**
 * Zone 3, "Airborne Now" — the fleet database intersected with the live feed (inventory §21).
 *
 * Eight columns and its own sort, independent of the All Aircraft table: you sort the
 * database by delivery year and the sky by altitude, and making one sort state serve both
 * would throw away whichever you set last.
 *
 * Only mainline airframes appear. A United Express regional in the feed has no row here —
 * not a blank one — because this table's subject is the fleet, and a regional is not in it.
 */

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { SortableHeader } from './SortableHeader';
import type { SortState } from './SortableHeader';

export type AirborneSortCol = 'reg' | 'type' | 'flight' | 'alt' | 'phase';

export type AirborneRow = {
  reg: string;
  type: string;
  flight: string;
  route: string;
  alt: string;
  altRaw: number;
  phase: string;
  starlink: boolean;
  special: { name: string } | null;
  icao24: string;
};

export function AirborneTable({
  rows,
  sort,
  onSort,
  feedLoading,
  onOpenAircraft,
}: {
  rows: AirborneRow[];
  sort: SortState<AirborneSortCol>;
  onSort: (col: AirborneSortCol) => void;
  /** True before the first feed poll answers — distinct from "nothing is flying". */
  feedLoading: boolean;
  onOpenAircraft: (reg: string) => void;
}) {
  return (
    <div
      tabIndex={0}
      aria-label="Airborne fleet table, scrollable region"
      className="max-h-[60svh] overflow-auto rounded-lg border focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
    >
      <Table>
        <TableHeader className="sticky top-0 z-10 bg-card">
          <TableRow>
            <SortableHeader col="reg" label="Reg" sort={sort} onSort={onSort} />
            <SortableHeader col="type" label="Type" sort={sort} onSort={onSort} />
            <SortableHeader col="flight" label="Flight" sort={sort} onSort={onSort} />
            <TableHead scope="col">Route</TableHead>
            <SortableHeader col="alt" label="Alt" sort={sort} onSort={onSort} />
            <SortableHeader col="phase" label="Phase" sort={sort} onSort={onSort} />
            <TableHead scope="col">SL</TableHead>
            <TableHead scope="col">
              <span className="sr-only">Special livery or name</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={8} className="py-6 text-center text-xs text-muted-foreground">
                {feedLoading
                  ? 'Loading live flight data…'
                  : 'No mainline aircraft airborne match these filters.'}
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row) => (
              <TableRow key={`${row.reg}-${row.icao24}`}>
                <TableCell className="font-mono">
                  <button
                    type="button"
                    onClick={() => onOpenAircraft(row.reg)}
                    className="min-h-11 text-primary underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring md:min-h-0"
                  >
                    {row.reg}
                  </button>
                </TableCell>
                <TableCell>{row.type}</TableCell>
                <TableCell className="font-mono">{row.flight}</TableCell>
                <TableCell className="font-mono text-xs">{row.route}</TableCell>
                <TableCell className="font-mono tabular-nums">{row.alt}</TableCell>
                <TableCell className="text-xs">{row.phase}</TableCell>
                <TableCell>
                  {row.starlink ? (
                    <span className="rounded border border-violet-500/30 bg-violet-500/10 px-1 py-0.5 text-[9px] font-medium text-violet-300">
                      SL
                    </span>
                  ) : null}
                </TableCell>
                <TableCell>
                  {row.special ? (
                    <span className="rounded border px-1 py-0.5 text-[9px] text-amber-400">
                      ⭐ {row.special.name}
                    </span>
                  ) : null}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}

export default AirborneTable;
