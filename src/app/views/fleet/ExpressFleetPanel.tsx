/**
 * Zone 3, "United Express" — the regional fleet that flies as United Express, discovered from
 * United's own flying (sql/018_express_tails.sql) and joined with the Starlink roster
 * (`buildExpressFleet`).
 *
 * A sub-tab of its own, not rows in "All Aircraft": that table, its count and the delivery
 * timeline are the MAINLINE database, and mixing ~450 regional jets into it would move the
 * "1,139 mainline" figure every other tab quotes.
 *
 * What it does not know, it does not say. A third of the tails have no type yet (CommutAir and
 * GoJet boards send no model code), a cabin appears only when one is verified for that type and
 * operator, and Wi-Fi is "Starlink" from the roster or "No Wi-Fi" for a type verified to have none
 * — otherwise a dash, which is "not known", never "none".
 *
 * Its own search box rather than the mainline controls: the type, Wi-Fi and status filters
 * there are the mainline database's values and would do nothing here.
 *
 * Names with a home link to it (links everywhere, Nov 12 2026). The registration is the row's
 * link-coloured link, to the aircraft dialog in place (each operator's dialog was checked to have
 * content, roster-only tails included); the last United flight a quiet link to its flight page
 * when it is a United number (GoJet's `G7…` stays plain, ruling 4). The regional type, operator,
 * Wi-Fi, cabin and dates have no home and stay plain. The summary's counts are buttons that set
 * this list's search (ruling 7, `express-fleet-chips.js`): an operator or type chip, or the
 * Starlink count, puts its word in the search and, pressed again, clears it; a chip whose word
 * would list a different number of rows, and the "Unknown …" buckets, stay text.
 */

import { Zap } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { isExpressChipPressed, nextExpressSearch } from '@/lib/express-fleet-chips.js';
import { expressCoverageNote, expressDateLabel, expressLastSeenLabel } from '@/lib/express-fleet-view.js';
import type { ExpressAircraft } from '../../data/types';
import { TailLink } from '../../features/EntityLinks';
import { FlightLink } from '../../features/FlightLink';
import { SortableHeader } from './SortableHeader';
import type { SortState } from './SortableHeader';

export type ExpressSortCol = 'r' | 't' | 'o' | 'w' | 'c' | 'lf' | 'ls';

export type ExpressSummary = {
  total: number;
  starlink: number;
  byOperator: Record<string, number>;
  byType: Record<string, number>;
};

/** A summary count as a search chip (`expressSearchChip`): `search` null when it stays text. */
export type ExpressChip = { label: string; count: number; search: string | null };
export type ExpressChips = { operators: ExpressChip[]; types: ExpressChip[]; starlink: ExpressChip };

/** A chip that is a button: the summary chip's look, 44 px tall on touch, the hub pills' pressed state. */
const CHIP_BUTTON =
  'inline-flex min-h-11 items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] hover:bg-accent aria-pressed:bg-accent aria-pressed:text-accent-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring pointer-fine:md:min-h-0';

/** A value the Express fleet does not know: a muted dash, with the words for a screen reader. */
function Unknown({ label }: { label: string }) {
  return (
    <span className="text-muted-foreground" title={label}>
      <span aria-hidden="true">—</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

function CountChips({
  id,
  label,
  chips,
  search,
  onSearchChange,
}: {
  id: string;
  label: string;
  chips: ExpressChip[];
  search: string;
  onSearchChange: (value: string) => void;
}) {
  if (!chips.length) return null;
  return (
    <div role="group" aria-labelledby={id} className="flex flex-wrap items-center gap-1">
      <span id={id} className="mr-1 text-[11px] text-muted-foreground">
        {label}
      </span>
      {chips.map((chip) =>
        chip.search !== null ? (
          <button
            key={chip.label}
            type="button"
            aria-pressed={isExpressChipPressed(chip, search)}
            onClick={() => onSearchChange(nextExpressSearch(chip, search))}
            className={CHIP_BUTTON}
          >
            <span className="sr-only">Show</span> {chip.label}{' '}
            <span className="font-mono tabular-nums text-muted-foreground">{chip.count}</span>{' '}
            <span className="sr-only">aircraft in the list below</span>
          </button>
        ) : (
          <span key={chip.label} className="rounded border px-1.5 py-0.5 text-[11px]">
            {chip.label} <span className="font-mono tabular-nums text-muted-foreground">{chip.count}</span>
          </span>
        ),
      )}
    </div>
  );
}

export function ExpressFleetPanel({
  rows,
  showCabin,
  summary,
  chips,
  staleDays,
  status,
  search,
  onSearchChange,
  sort,
  onSort,
  nowMs,
}: {
  /** Already searched and sorted. */
  rows: ExpressAircraft[];
  /**
   * Any entry in the WHOLE Express fleet has a verified cabin. Decided over the fleet, not the
   * searched rows, so the Config column does not come and go as a search narrows. None is
   * verified yet: the column appears with the first one, not as a column of dashes.
   */
  showCabin: boolean;
  /** Of the whole Express fleet, not the searched rows. */
  summary: ExpressSummary;
  /** The summary's counts as search chips, decided over the whole fleet (`expressSearchChips`). */
  chips: ExpressChips;
  staleDays: number;
  status: 'loading' | 'ready' | 'failed';
  search: string;
  onSearchChange: (value: string) => void;
  sort: SortState<ExpressSortCol>;
  onSort: (col: ExpressSortCol) => void;
  nowMs: number;
}) {
  const columns = 6 + (showCabin ? 1 : 0);

  return (
    <div className="space-y-3">
      <div className="space-y-2 rounded-lg border bg-card p-3">
        {status === 'loading' && summary.total === 0 ? (
          <Skeleton className="h-5 w-48" />
        ) : (
          <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
            <span>
              <span className="font-mono font-semibold tabular-nums">{summary.total}</span> aircraft
            </span>
            {chips.starlink.search !== null ? (
              <button
                type="button"
                aria-pressed={isExpressChipPressed(chips.starlink, search)}
                onClick={() => onSearchChange(nextExpressSearch(chips.starlink, search))}
                className="-mx-1 inline-flex min-h-11 items-center gap-1 rounded-md px-1 text-bb-starlink hover:bg-accent aria-pressed:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring pointer-fine:md:min-h-0"
              >
                <Zap aria-hidden="true" className="size-3.5" />
                <span className="sr-only">Show</span>{' '}
                <span className="font-mono font-semibold tabular-nums">{summary.starlink}</span> Starlink{' '}
                <span className="sr-only">aircraft in the list below</span>
              </button>
            ) : (
              <span className="inline-flex items-center gap-1 text-bb-starlink">
                <Zap aria-hidden="true" className="size-3.5" />
                <span className="font-mono font-semibold tabular-nums">{summary.starlink}</span> Starlink
              </span>
            )}
          </p>
        )}
        <CountChips
          id="express-chips-operator"
          label="Operator"
          chips={chips.operators}
          search={search}
          onSearchChange={onSearchChange}
        />
        <CountChips id="express-chips-type" label="Type" chips={chips.types} search={search} onSearchChange={onSearchChange} />
        <p className="text-[11px] text-muted-foreground">
          {status === 'failed'
            ? 'The United Express list could not be loaded — showing only the Express aircraft on the Starlink roster.'
            : expressCoverageNote(summary.total, staleDays)}
        </p>
      </div>

      <Input
        id="express-fleet-search"
        type="search"
        aria-label="United Express search"
        placeholder="Search reg, type, operator…"
        value={search}
        onChange={(event) => onSearchChange(event.target.value)}
        className="h-11 w-full min-w-0 sm:w-64 pointer-fine:md:h-8"
      />

      {rows.length === 0 && search.trim() ? (
        <div className="rounded-lg border border-dashed p-6 text-center">
          <p className="text-sm">No United Express aircraft match “{search.trim()}”.</p>
          <Button
            variant="outline"
            size="lg"
            className="mt-3 min-h-11 pointer-fine:md:min-h-0"
            onClick={() => onSearchChange('')}
          >
            Clear search
          </Button>
        </div>
      ) : (
        <div
          tabIndex={0}
          aria-label="United Express fleet table, scrollable region"
          className="max-h-[60svh] overflow-auto rounded-lg border focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
        >
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-card">
              <TableRow>
                {/* The tail stays pinned while a phone scrolls the other columns sideways. */}
                <SortableHeader col="r" label="Reg" sort={sort} onSort={onSort} className="sticky left-0 z-20 bg-card" />
                <SortableHeader col="t" label="Type" sort={sort} onSort={onSort} />
                <SortableHeader col="o" label="Operator" sort={sort} onSort={onSort} />
                <SortableHeader col="w" label="WiFi" sort={sort} onSort={onSort} />
                {showCabin ? <SortableHeader col="c" label="Config" sort={sort} onSort={onSort} /> : null}
                <SortableHeader col="lf" label="Last UA flight" sort={sort} onSort={onSort} />
                <SortableHeader col="ls" label="Last seen" sort={sort} onSort={onSort} />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={columns} className="py-6 text-center text-xs text-muted-foreground">
                    {status === 'loading' ? 'Loading the United Express fleet…' : 'No United Express aircraft yet.'}
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => (
                  <TableRow key={row.r}>
                    <TableCell className="sticky left-0 z-[1] bg-background font-mono">
                      <TailLink reg={row.r} hit="inline" />
                    </TableCell>
                    <TableCell>{row.t || <Unknown label="Type not known" />}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs">
                      {row.o || <Unknown label="Operator not known" />}
                    </TableCell>
                    <TableCell className="text-xs">
                      {row.w === 'Starlink' ? (
                        <span className="inline-flex items-center gap-0.5 whitespace-nowrap text-bb-starlink">
                          <Zap aria-hidden="true" className="size-3" /> Starlink
                        </span>
                      ) : row.w === 'None' ? (
                        // Verified for the type (CRJ200, ERJ145), not inferred from a blank.
                        <span className="whitespace-nowrap">No Wi-Fi</span>
                      ) : (
                        // Off the Starlink roster, and not a type verified to have none: unknown.
                        <Unknown label="Wi-Fi not known" />
                      )}
                    </TableCell>
                    {showCabin ? (
                      <TableCell className="font-mono text-xs">
                        {row.c || <Unknown label="Cabin not verified for this type and operator" />}
                      </TableCell>
                    ) : null}
                    <TableCell className="font-mono text-xs">
                      {row.lf ? (
                        <FlightLink ident={row.lf} tone="quiet" hit="inline" />
                      ) : (
                        <Unknown label="Not seen on a United flight yet" />
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap font-mono text-xs tabular-nums">
                      {row.ls ? (
                        <time dateTime={row.ls} title={expressDateLabel(row.ls)}>
                          {expressLastSeenLabel(row.ls, nowMs)}
                        </time>
                      ) : (
                        <span className="text-muted-foreground" title="On the Starlink roster; not yet seen flying United here">
                          Not yet
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

export default ExpressFleetPanel;
