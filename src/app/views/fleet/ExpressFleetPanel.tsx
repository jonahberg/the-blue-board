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
import {
  expressCountRows,
  expressCoverageNote,
  expressDateLabel,
  expressLastSeenLabel,
} from '@/lib/express-fleet-view.js';
import type { ExpressAircraft } from '../../data/types';
import { SortableHeader } from './SortableHeader';
import type { SortState } from './SortableHeader';

export type ExpressSortCol = 'r' | 't' | 'o' | 'w' | 'c' | 'lf' | 'ls';

export type ExpressSummary = {
  total: number;
  starlink: number;
  byOperator: Record<string, number>;
  byType: Record<string, number>;
};

/** A value the Express fleet does not know: a muted dash, with the words for a screen reader. */
function Unknown({ label }: { label: string }) {
  return (
    <span className="text-muted-foreground" title={label}>
      <span aria-hidden="true">—</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

function CountChips({ label, counts }: { label: string; counts: Record<string, number> }) {
  const rows = expressCountRows(counts) as { label: string; count: number }[];
  if (!rows.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="mr-1 text-[11px] text-muted-foreground">{label}</span>
      {rows.map((row) => (
        <span key={row.label} className="rounded border px-1.5 py-0.5 text-[11px]">
          {row.label} <span className="font-mono tabular-nums text-muted-foreground">{row.count}</span>
        </span>
      ))}
    </div>
  );
}

export function ExpressFleetPanel({
  rows,
  showCabin,
  summary,
  staleDays,
  status,
  search,
  onSearchChange,
  sort,
  onSort,
  nowMs,
  onOpenAircraft,
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
  staleDays: number;
  status: 'loading' | 'ready' | 'failed';
  search: string;
  onSearchChange: (value: string) => void;
  sort: SortState<ExpressSortCol>;
  onSort: (col: ExpressSortCol) => void;
  nowMs: number;
  onOpenAircraft: (reg: string) => void;
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
            <span className="inline-flex items-center gap-1 text-bb-starlink">
              <Zap aria-hidden="true" className="size-3.5" />
              <span className="font-mono font-semibold tabular-nums">{summary.starlink}</span> Starlink
            </span>
          </p>
        )}
        <CountChips label="Operator" counts={summary.byOperator} />
        <CountChips label="Type" counts={summary.byType} />
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
        className="h-11 w-full min-w-0 sm:w-64 md:h-8"
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
                      <button
                        type="button"
                        onClick={() => onOpenAircraft(row.r)}
                        className="min-h-11 text-primary underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring pointer-fine:md:min-h-0"
                      >
                        {row.r}
                      </button>
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
                    <TableCell className="font-mono text-xs">{row.lf || <Unknown label="Not seen on a United flight yet" />}</TableCell>
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
