/**
 * The board itself: ten columns, a NOW divider, and one row per flight.
 *
 * Three things in here are load-bearing rather than decorative.
 *
 * **DELAY / RISK is "facts beat predictions".** A row with a known actual-or-estimated delta
 * shows the REAL delay; only a future row without one shows a prediction, and that prediction
 * is worded "RISK: …" so it can never be read as a fact. The shipped board once displayed
 * "V.HIGH" next to a flight already running 140 minutes late.
 *
 * **The NOW divider anchors on the EFFECTIVE row time** — `max(scheduled, estimated)` when
 * there is no real time — so a flight held on the ground floats below the line instead of
 * masquerading as resolved above it. It only appears on today's board under the default
 * time-ascending sort, because a "now" line halfway down a list sorted by flight number
 * means nothing.
 *
 * **A tail from live tracking says so.** The schedule feed omits registrations constantly; a
 * backfilled tail is real but it is not what the provider sent, and the tooltip says which.
 *
 * The scroll container, not the window, is the scroll parent: `offsetTop` inside it is what
 * "jump to now" and the palette's row highlight measure against.
 */

import { forwardRef, useImperativeHandle, useRef } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { delayColorVar } from '@/lib/delay-format.js';
import { cn } from '@/lib/utils';
import type { RowModel, SortColumn } from './useBoardModel';
import { STATUS_TONE, SWAP_TONE, delayToneClass, riskToneClass } from './tone';

export type ScheduleTableHandle = {
  /** Scroll the container so the NOW divider (or the first future row) sits near the top. */
  scrollToNow: (smooth?: boolean) => void;
  /** Scroll one flight into view and flash it — the search palette's landing. */
  revealFlight: (ident: string) => boolean;
};

const COLUMNS: { key: SortColumn | null; label: string; className?: string; srLabel?: string }[] = [
  { key: 'time', label: 'Time', className: 'min-w-[6.5rem]' },
  { key: 'flight', label: 'Flight' },
  { key: 'route', label: 'Route', className: 'min-w-[8.5rem]' },
  { key: 'aircraft', label: 'Aircraft' },
  { key: 'reg', label: 'Reg' },
  { key: null, label: 'Term / Gate' },
  { key: 'status', label: 'Status', className: 'min-w-[8rem]' },
  { key: null, label: 'Delay / Risk', className: 'min-w-[5.5rem]' },
  { key: null, label: 'Fleet' },
  { key: null, label: '👁️', srLabel: 'Watch' },
];

const HIGHLIGHT_MS = 2000;

/**
 * 44 px of hit area below `md:` for the buttons that sit INSIDE a row — the tail links and
 * the risk badge. Rows already wrap to two lines on a phone, so the taller target costs no
 * density there and none at all on a desktop, where it collapses back to the text height.
 */
const TAP_TARGET = 'inline-flex min-h-11 items-center md:min-h-0';

function SortableHead({
  column,
  label,
  className,
  sort,
  onSort,
}: {
  column: SortColumn;
  label: string;
  className?: string;
  sort: { column: SortColumn; asc: boolean };
  onSort: (column: SortColumn) => void;
}) {
  const active = sort.column === column;
  return (
    <TableHead
      scope="col"
      aria-sort={active ? (sort.asc ? 'ascending' : 'descending') : 'none'}
      className={cn('cursor-pointer select-none p-0', className)}
    >
      <button
        type="button"
        onClick={() => onSort(column)}
        className="flex min-h-11 w-full items-center gap-1 px-2 text-left text-[10px] uppercase tracking-wide md:min-h-8"
      >
        {label}
        <span aria-hidden="true" className={active ? 'text-primary' : 'text-muted-foreground'}>
          {active ? (sort.asc ? '↑' : '↓') : '↕'}
        </span>
      </button>
    </TableHead>
  );
}

export const ScheduleTable = forwardRef<
  ScheduleTableHandle,
  {
    rows: RowModel[];
    dividerIndex: number;
    dividerLabel: string;
    firstFutureIndex: number;
    sort: { column: SortColumn; asc: boolean };
    onSort: (column: SortColumn) => void;
    isWatched: (flight: string) => boolean;
    onToggleWatch: (row: RowModel) => void;
    onOpenAircraft: (reg: string) => void;
    onExplainDelay: (context: Record<string, unknown>) => void;
    boardAsOf: string;
  }
>(function ScheduleTable(
  {
    rows,
    dividerIndex,
    dividerLabel,
    firstFutureIndex,
    sort,
    onSort,
    isWatched,
    onToggleWatch,
    onOpenAircraft,
    onExplainDelay,
    boardAsOf,
  },
  ref,
) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const dividerRef = useRef<HTMLTableRowElement>(null);
  const bodyRef = useRef<HTMLTableSectionElement>(null);

  useImperativeHandle(
    ref,
    () => ({
      scrollToNow(smooth = true) {
        const container = scrollRef.current;
        if (!container) return;
        const target =
          dividerRef.current ??
          (firstFutureIndex >= 0
            ? (bodyRef.current?.querySelectorAll('tr')[firstFutureIndex] as HTMLElement | undefined)
            : undefined);
        if (!target) return;
        const top = Math.max(0, target.offsetTop - 60);
        requestAnimationFrame(() => {
          if (typeof container.scrollTo === 'function') {
            container.scrollTo({ top, behavior: smooth ? 'smooth' : 'auto' });
          } else {
            container.scrollTop = top;
          }
        });
      },
      revealFlight(ident: string) {
        const container = scrollRef.current;
        if (!container || !ident) return false;
        const row = container.querySelector<HTMLElement>(
          `[data-flight-row="${CSS.escape(ident)}"]`,
        );
        if (!row) return false;
        row.scrollIntoView({ behavior: 'smooth', block: 'center' });
        row.dataset.highlight = 'on';
        setTimeout(() => {
          delete row.dataset.highlight;
        }, HIGHLIGHT_MS);
        return true;
      },
    }),
    [firstFutureIndex],
  );

  return (
    <div
      ref={scrollRef}
      tabIndex={0}
      aria-label="Schedule table, scrollable region"
      // `Table` wraps itself in an `overflow-x-auto` div. Left alone that div is a second
      // scrollport INSIDE this one, which is where the sticky header would stick (to a
      // container that never scrolls) and what `offsetTop` would be measured against.
      // Flattening it leaves exactly one scroll container for both axes.
      className={cn(
        'relative max-h-[65dvh] overflow-auto rounded-md border md:max-h-[calc(100dvh-20rem)]',
        '[&>[data-slot=table-container]]:overflow-visible',
      )}
    >
      <Table className="text-[11px]">
        {/* The sticky offset goes on the cells, not the `<thead>`: a background painted on
            a sticky `<thead>` does not cover the rows scrolling beneath it in every engine,
            and a half-visible row bleeding through the header reads as a rendering fault. */}
        <TableHeader className="[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-card">
          <TableRow>
            {COLUMNS.map((column) =>
              column.key ? (
                <SortableHead
                  key={column.label}
                  column={column.key}
                  label={column.label}
                  className={column.className}
                  sort={sort}
                  onSort={onSort}
                />
              ) : (
                <TableHead
                  key={column.label}
                  scope="col"
                  className={cn('text-[10px] uppercase tracking-wide', column.className)}
                >
                  {column.srLabel ? (
                    <>
                      <span aria-hidden="true">{column.label}</span>
                      <span className="sr-only">{column.srLabel}</span>
                    </>
                  ) : (
                    column.label
                  )}
                </TableHead>
              ),
            )}
          </TableRow>
        </TableHeader>
        <TableBody ref={bodyRef}>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={10} className="py-10 text-center text-muted-foreground">
                <span className="block text-2xl" aria-hidden="true">
                  🔍
                </span>
                No flights match your filters
                <span className="mt-1 block text-[10px]">
                  Try adjusting hub, status, or search criteria
                </span>
              </TableCell>
            </TableRow>
          ) : (
            rows.flatMap((row, index) => {
              const cells = [
                <TableRow
                  key={row.key}
                  data-flight-row={row.ident}
                  className="align-top data-[highlight=on]:bg-primary/20"
                >
                  <TableCell className="font-mono whitespace-nowrap">
                    {row.timeText}
                    {row.dateChip ? (
                      <span className="ml-1 rounded-sm border px-1 text-[9px] text-muted-foreground">
                        {row.dateChip}
                      </span>
                    ) : null}
                    {row.derivedActual ? (
                      <span className="block text-[9px] text-muted-foreground">actual</span>
                    ) : null}
                    {row.actualLine ? (
                      <span
                        className={cn(
                          'block text-[9px]',
                          row.actualLine.early ? 'text-emerald-400' : 'text-muted-foreground',
                        )}
                      >
                        {row.actualLine.text}
                      </span>
                    ) : null}
                  </TableCell>

                  <TableCell className="font-mono font-semibold text-primary">{row.ident}</TableCell>

                  <TableCell>
                    <span className="font-mono">{row.routeLine}</span>
                    {row.routeSub ? (
                      <span className="block text-[9px] text-muted-foreground">{row.routeSub}</span>
                    ) : null}
                  </TableCell>

                  <TableCell>
                    <span className="font-mono" title={row.acText}>
                      {row.acCode}
                    </span>
                    {row.acShort ? (
                      <span className="block text-[9px] text-muted-foreground">{row.acShort}</span>
                    ) : null}
                    {row.swap ? (
                      <span className="mt-0.5 block">
                        <span
                          className={cn(
                            'inline-flex items-center gap-1 rounded-sm border px-1 py-0.5 text-[9px]',
                            SWAP_TONE[row.swap.tone],
                          )}
                        >
                          <span aria-hidden="true">
                            {row.swap.tone === 'downgrade'
                              ? '🔴'
                              : row.swap.tone === 'upgrade'
                                ? '🟢'
                                : '⚠️'}
                          </span>
                          {row.swap.oldType} → {row.swap.newType}
                          {row.swap.reg ? (
                            <button
                              type="button"
                              className={cn('underline', TAP_TARGET)}
                              onClick={() => onOpenAircraft(row.swap!.reg)}
                            >
                              {row.swap.reg}
                            </button>
                          ) : null}
                        </span>
                        {row.swap.impacts.length ? (
                          <span className="mt-0.5 flex flex-wrap gap-1">
                            {row.swap.impacts.map((impact) => (
                              <span
                                key={impact.text}
                                className={cn(
                                  'rounded-sm border px-1 text-[9px]',
                                  SWAP_TONE[impact.cls] ?? SWAP_TONE.lateral,
                                )}
                              >
                                {impact.text}
                              </span>
                            ))}
                          </span>
                        ) : null}
                      </span>
                    ) : null}
                  </TableCell>

                  <TableCell className="max-w-40 font-mono text-[10px]">
                    {row.reg ? (
                      row.regFromLive ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              className={cn('underline decoration-dotted underline-offset-2', TAP_TARGET)}
                              onClick={() => onOpenAircraft(row.reg)}
                            >
                              {row.reg}
                            </button>
                          </TooltipTrigger>
                          <TooltipContent>
                            Tail from live flight tracking (not in the schedule feed)
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        <button
                          type="button"
                          className={cn('underline', TAP_TARGET)}
                          onClick={() => onOpenAircraft(row.reg)}
                        >
                          {row.reg}
                        </button>
                      )
                    ) : (
                      '—'
                    )}
                    {row.special ? (
                      <Badge variant="secondary" className="ml-1 px-1 py-0 text-[9px]">
                        ⭐ {row.special}
                      </Badge>
                    ) : null}
                    {row.fleet?.enrich ? (
                      <span
                        className="block truncate text-[9px] text-muted-foreground"
                        title={row.fleet.enrich}
                      >
                        {row.fleet.enrich}
                      </span>
                    ) : null}
                  </TableCell>

                  <TableCell className="font-mono whitespace-nowrap">{row.gate}</TableCell>

                  <TableCell>
                    <span className={cn('font-medium', STATUS_TONE[row.status.cls] ?? STATUS_TONE.unknown)}>
                      {row.status.text}
                      {row.status.presumed ? '*' : ''}
                    </span>
                    {row.status.live ? (
                      <Badge variant="secondary" className="ml-1 px-1 py-0 text-[9px]">
                        LIVE
                      </Badge>
                    ) : null}
                    {row.status.presumed ? (
                      <span className="block text-[9px] text-muted-foreground">
                        presumed — scheduled time passed without a live update
                      </span>
                    ) : null}
                    {row.status.asOf ? (
                      <span className="block text-[9px] text-muted-foreground">as of {boardAsOf}</span>
                    ) : null}
                    {row.faaContext ? (
                      <span className="block text-[9px] text-amber-400">{row.faaContext}</span>
                    ) : null}
                  </TableCell>

                  <TableCell className="text-right font-mono tabular-nums">
                    {row.delay.kind === 'delta' ? (
                      <span
                        className={delayToneClass(delayColorVar(row.delay.minutes) as string)}
                        title={row.delay.title}
                      >
                        {row.delay.text}
                      </span>
                    ) : row.delay.kind === 'risk' ? (
                      <button
                        type="button"
                        onClick={() => onExplainDelay((row.delay as { context: Record<string, unknown> }).context)}
                        className={cn(
                          'rounded-sm border px-1 py-0.5 text-[9px]',
                          TAP_TARGET,
                          riskToneClass(row.delay.risk.label),
                        )}
                        title="Click for AI analysis"
                      >
                        RISK: {row.delay.risk.label}
                      </button>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>

                  <TableCell className="max-w-28">
                    {row.fleet ? (
                      <span className="block truncate text-[10px]" title={row.fleet.badge}>
                        <span aria-hidden="true">{row.fleet.starlink ? '⚡' : '✓'}</span>{' '}
                        {row.fleet.badge}
                      </span>
                    ) : row.reg ? (
                      <span className="text-muted-foreground">—</span>
                    ) : null}
                  </TableCell>

                  <TableCell>
                    {row.ident !== '—' ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-11 md:size-7"
                        aria-label={isWatched(row.ident) ? 'Unwatch flight' : 'Watch flight'}
                        title={`${isWatched(row.ident) ? 'Unwatch' : 'Watch'} this flight`}
                        onClick={() => onToggleWatch(row)}
                      >
                        <span aria-hidden="true">{isWatched(row.ident) ? '👁️' : '👁'}</span>
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>,
              ];

              if (index === dividerIndex) {
                cells.unshift(
                  <TableRow
                    key="sched-now-divider"
                    ref={dividerRef}
                    aria-label="Current time marker"
                    className="bg-primary/10 hover:bg-primary/10"
                  >
                    <TableCell colSpan={10} className="p-0">
                      {/* Pinned to the left edge of the scrollport: centred across a table
                          that is ~1400 px wide, the label sits off-screen on a phone and the
                          divider reads as an unexplained empty band. */}
                      <span className="sticky left-0 block px-2 py-1 font-mono text-[10px] tracking-wide text-primary">
                        ── NOW · {dividerLabel} ──
                      </span>
                    </TableCell>
                  </TableRow>,
                );
              }
              return cells;
            })
          )}
        </TableBody>
      </Table>
    </div>
  );
});
