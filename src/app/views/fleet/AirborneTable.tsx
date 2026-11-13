/**
 * Zone 3, "Airborne Now" — the fleet database intersected with the live feed (inventory §21).
 *
 * Eight columns and its own sort, independent of the All Aircraft table: you sort the
 * database by delivery year and the sky by altitude, and making one sort state serve both
 * would throw away whichever you set last.
 *
 * Only mainline airframes appear. A United Express regional in the feed has no row here —
 * not a blank one — because this table's subject is the fleet, and a regional is not in it.
 *
 * Names with a home link to it (links everywhere, Nov 12 2026). The registration is the row's
 * link-coloured link, to the aircraft dialog in place; the type a quiet link to this tab filtered
 * to it (the row model's `typeLink`: by the tail, plain once the table is filtered to that type);
 * the flight number a quiet link to its flight page when it is a United number (`FlightLink`); each
 * hub end of the route a quiet link to that hub's Schedule board, any other airport plain; the "SL"
 * mark a quiet link to the Starlink tab. The route ends come from the row model, not from parsing
 * the printed route. The registration, type and flight number are 44 px tall on touch inside their
 * cells (`hit="inline"`); the hub ends take 44 px touch boxes, so the arrow between them is spaced
 * (`mx-3`, tight only for a mouse at `md`+) for the two boxes not to overlap.
 */

import { Star } from 'lucide-react';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { liveryForTail } from '@/lib/special-livery.js';
import { HubLink, TailLink, TypeLink } from '../../features/EntityLinks';
import { FlightLink } from '../../features/FlightLink';
import { SpecialLiveryBadge } from '../../features/SpecialLiveryBadge';
import { SortableHeader } from './SortableHeader';
import type { SortState } from './SortableHeader';
import { StarlinkRowChip } from './StarlinkRowChip';

export type AirborneSortCol = 'reg' | 'type' | 'flight' | 'alt' | 'phase';

export type AirborneRow = {
  reg: string;
  type: string;
  /** The type this row links to (`fleetRowTypeLink`), or null to print it plain. */
  typeLink: string | null;
  flight: string;
  route: string;
  /** The route's ends as printed ('???' when the feed has none). */
  origin: string;
  dest: string;
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
}: {
  rows: AirborneRow[];
  sort: SortState<AirborneSortCol>;
  onSort: (col: AirborneSortCol) => void;
  /** True before the first feed poll answers — distinct from "nothing is flying". */
  feedLoading: boolean;
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
                  <TailLink reg={row.reg} hit="inline" />
                </TableCell>
                <TableCell>
                  <TypeLink typeCode={row.typeLink} hit="inline">
                    {row.type}
                  </TypeLink>
                </TableCell>
                <TableCell className="font-mono">
                  <FlightLink ident={row.flight} tone="quiet" hit="inline" />
                </TableCell>
                <TableCell className="font-mono text-xs">
                  <HubLink code={row.origin} />
                  <span aria-hidden="true" className="mx-3 text-muted-foreground pointer-fine:md:mx-1">
                    &gt;
                  </span>
                  <span className="sr-only"> to </span>
                  <HubLink code={row.dest} />
                </TableCell>
                <TableCell className="font-mono tabular-nums">{row.alt}</TableCell>
                <TableCell className="text-xs">{row.phase}</TableCell>
                <TableCell>{row.starlink ? <StarlinkRowChip /> : null}</TableCell>
                <TableCell>
                  {row.special ? (
                    <span className="inline-flex items-center gap-0.5 rounded border px-1 py-0.5 text-[9px] text-foreground">
                      <Star aria-hidden="true" className="size-2.5" /> {row.special.name}
                    </span>
                  ) : null}
                  <SpecialLiveryBadge livery={liveryForTail(row.reg)} variant="compact" className="ml-1" />
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
