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
 * operator, and Wi-Fi is stated only when it is Starlink — a dash is "not known", never "none".
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
  // No Express cabin is verified yet: the column appears with the first one, not as a column of
  // dashes.
  const showCabin = rows.some((row) => row.c);
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
                <SortableHeader col="r" label="Reg" sort={sort} onSort={onSort} />
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
                    <TableCell className="font-mono">
                      <button
                        type="button"
                        onClick={() => onOpenAircraft(row.r)}
                        className="min-h-11 text-primary underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring pointer-fine:md:min-h-0"
                      >
                        {row.r}
                      </button>
                    </TableCell>
                    <TableCell>
                      {row.t || (
                        <span className="text-muted-foreground">
                          <span aria-hidden="true">—</span>
                          <span className="sr-only">Type not known</span>
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs">{row.o || '—'}</TableCell>
                    <TableCell className="text-xs">
                      {row.w === 'Starlink' ? (
                        <span className="inline-flex items-center gap-0.5 whitespace-nowrap text-bb-starlink">
                          <Zap aria-hidden="true" className="size-3" /> Starlink
                        </span>
                      ) : (
                        // Off the Starlink roster the Wi-Fi is unknown — not "none".
                        <span className="text-muted-foreground" title="Not known — only Starlink is tracked here">
                          <span aria-hidden="true">—</span>
                          <span className="sr-only">Not known</span>
                        </span>
                      )}
                    </TableCell>
                    {showCabin ? (
                      <TableCell className="font-mono text-xs">{row.c || '—'}</TableCell>
                    ) : null}
                    <TableCell className="font-mono text-xs">{row.lf || '—'}</TableCell>
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
