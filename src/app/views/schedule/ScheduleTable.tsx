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
 * **The NOW divider sits after the last resolved-past row**, placed on the EFFECTIVE row time
 * (`max(scheduled, estimated)` when there is no real time) so a held flight is never counted
 * as resolved, and one held row can no longer drag the line above hours of departed flights
 * (board-now.js). It only appears on today's board under the default time-ascending sort,
 * because a "now" line halfway down a list sorted by flight number means nothing.
 *
 * **Only a window of rows is painted** (schedule-window.js): a 640-row board laid out in full
 * cost ~360 ms of style + layout every time the tab was shown again. The window opens around
 * NOW, grows on request, and follows "jump to now" and the search palette to rows outside it.
 *
 * **A tail from live tracking says so.** The schedule feed omits registrations constantly; a
 * backfilled tail is real but it is not what the provider sent, and the tooltip says which.
 *
 * The scroll container, not the window, is the scroll parent: `offsetTop` inside it is what
 * "jump to now" and the palette's row highlight measure against.
 *
 * **Below `md` the same window paints a list, not the table** (`compact`). At 390 px the
 * ten-column table was 1,065 px wide: tail, seats, Wi-Fi, status, LIVE and the watch eye were
 * all off-screen with no hint that they existed (audit Oct 3 2026). The phone list
 * (`SchedulePhoneRow`) keeps everything that makes this component work — the painted window,
 * the NOW divider, `data-row-index` / `data-flight-row`, jump-to-now and the palette reveal —
 * and swaps only the markup each row paints. Desktop and tablet keep the table untouched.
 */

import { CalendarDays, Clock, Eye, SearchX, Star, TriangleAlert, Zap } from 'lucide-react';
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';

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
import { scrollBehavior } from '@/lib/motion.js';
import { statusEvidenceNote } from '@/lib/schedule-row-display.js';
import { liveryForTail } from '@/lib/special-livery.js';
import { clampWindow, expandWindow, initialWindow, windowIncluding } from '@/lib/schedule-window.js';
import { cn } from '@/lib/utils';
import type { RowModel, SortColumn } from './useBoardModel';
import { DelayFigure } from './DelayFigure';
import { SpecialLiveryBadge } from '../../features/SpecialLiveryBadge';
import { SchedulePhoneRow } from './SchedulePhoneRow';
import { STATUS_TONE, SWAP_TONE, riskToneClass } from './tone';

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
  // Capped: an uncapped presumed note set the whole column to ~313 px of mostly empty space
  // while the Reg enrichment line beside it was truncated (F64).
  { key: 'status', label: 'Status', className: 'w-[9rem] min-w-[8rem]' },
  // Right-aligned like the values under it (tailwind-merge lets this beat the base text-left).
  { key: null, label: 'Delay / Risk', className: 'min-w-[5.5rem] text-right' },
  { key: null, label: 'Fleet' },
  { key: null, label: 'watch', srLabel: 'Watch' },
];

const HIGHLIGHT_MS = 2000;

const noop = () => {};

/**
 * 44 px of hit area below `md:` for the buttons that sit INSIDE a row — the tail links and
 * the risk badge. Rows already wrap to two lines on a phone, so the taller target costs no
 * density there and none at all on a desktop, where it collapses back to the text height.
 */
const TAP_TARGET = 'inline-flex min-h-11 items-center pointer-fine:md:min-h-0';

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
        className="flex min-h-11 w-full items-center gap-1 px-2 text-left text-[10px] uppercase tracking-wide pointer-fine:md:min-h-8"
      >
        {label}
        <span aria-hidden="true" className={active ? 'text-primary' : 'text-muted-foreground'}>
          {active ? (sort.asc ? '↑' : '↓') : '↕'}
        </span>
      </button>
    </TableHead>
  );
}

/** Why a board paints no rows — each says something different to the viewer (F14). */
export type EmptyReason = 'filtered' | 'deferred' | 'upstream' | 'none';

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
    /** Changes whenever the board, its filters or its sort change: the painted window resets. */
    windowKey: string;
    emptyReason: EmptyReason;
    /** "Tomorrow's arrivals at EWR" — used by the empty states. */
    emptySubject: string;
    onClearFilters: () => void;
    /** Paint the phone list instead of the table (below `md`). */
    compact?: boolean;
    /** A phone row was tapped: open its flight sheet. */
    onOpenFlight?: (row: RowModel) => void;
    /** The board's direction: a runway-time delay is wheels-up on one, touchdown on the other. */
    dir?: 'departures' | 'arrivals';
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
    windowKey,
    emptyReason,
    emptySubject,
    onClearFilters,
    compact = false,
    onOpenFlight,
    dir = 'departures',
  },
  ref,
) {
  const scrollRef = useRef<HTMLDivElement>(null);
  // The `<tbody>` on a desktop, the `<ol>` on a phone: both carry the same row attributes.
  const bodyRef = useRef<HTMLElement>(null);

  // The painted window: reset around NOW whenever the board/filter/sort identity changes, and
  // only clamped (never reset) when the same board just re-derives on a clock tick.
  const anchor = dividerIndex >= 0 ? dividerIndex : firstFutureIndex;
  const [windowState, setWindowState] = useState(() => ({ key: windowKey, ...initialWindow(rows.length, anchor) }));
  let win = windowState;
  if (windowState.key !== windowKey) {
    win = { key: windowKey, ...initialWindow(rows.length, anchor) };
    setWindowState(win);
  }
  const { start, end } = clampWindow(win, rows.length);
  const setWin = (next: { start: number; end: number }) => setWindowState({ key: windowKey, ...next });

  // A scroll/reveal that targets a row outside the window grows the window first and finishes
  // after that render commits.
  const pending = useRef<{ kind: 'now'; smooth: boolean } | { kind: 'flight'; ident: string } | null>(null);
  // Growing the window upward pushes the rows the viewer is looking at down; keep them put.
  const prependAnchor = useRef<number | null>(null);

  const rowElement = (index: number) =>
    bodyRef.current?.querySelector<HTMLElement>(`[data-row-index="${index}"]`) ?? null;

  const scrollToElement = (target: HTMLElement, smooth: boolean) => {
    const container = scrollRef.current;
    if (!container) return;
    // 60 px clears the desktop table's sticky header and shows the row before NOW; the phone
    // list has no header, so it only needs room for the NOW divider itself.
    const top = Math.max(0, target.offsetTop - (compact ? 28 : 60));
    requestAnimationFrame(() => {
      if (typeof container.scrollTo === 'function') {
        container.scrollTo({ top, behavior: smooth ? scrollBehavior() : 'auto' });
      } else {
        container.scrollTop = top;
      }
    });
  };

  const highlight = (row: HTMLElement) => {
    row.scrollIntoView({ behavior: scrollBehavior(), block: 'center' });
    row.dataset.highlight = 'on';
    setTimeout(() => {
      delete row.dataset.highlight;
    }, HIGHLIGHT_MS);
  };

  useLayoutEffect(() => {
    const container = scrollRef.current;
    if (prependAnchor.current !== null && container) {
      container.scrollTop += container.scrollHeight - prependAnchor.current;
      prependAnchor.current = null;
    }
    const job = pending.current;
    if (!job) return;
    pending.current = null;
    if (job.kind === 'now') {
      const target = rowElement(anchor);
      if (target) scrollToElement(target, job.smooth);
    } else {
      const row = bodyRef.current?.querySelector<HTMLElement>(`[data-flight-row="${CSS.escape(job.ident)}"]`);
      if (row) highlight(row);
    }
  });

  // Keep `pending` from surviving a board switch.
  useEffect(() => {
    pending.current = null;
  }, [windowKey]);

  useImperativeHandle(
    ref,
    () => ({
      scrollToNow(smooth = true) {
        if (anchor < 0) return;
        const target = rowElement(anchor);
        if (target) {
          scrollToElement(target, smooth);
          return;
        }
        pending.current = { kind: 'now', smooth };
        setWin(windowIncluding({ start, end }, rows.length, anchor));
      },
      revealFlight(ident: string) {
        if (!ident) return false;
        const index = rows.findIndex((row) => row.ident === ident);
        if (index < 0) return false;
        const painted = bodyRef.current?.querySelector<HTMLElement>(
          `[data-flight-row="${CSS.escape(ident)}"]`,
        );
        if (painted) {
          highlight(painted);
          return true;
        }
        pending.current = { kind: 'flight', ident };
        setWin(windowIncluding({ start, end }, rows.length, index));
        return true;
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [anchor, rows, start, end, windowKey],
  );

  const openFlight = onOpenFlight ?? noop;

  const showEarlier = () => {
    prependAnchor.current = scrollRef.current?.scrollHeight ?? null;
    setWin(expandWindow({ start, end }, rows.length, 'earlier'));
  };
  const showLater = () => setWin(expandWindow({ start, end }, rows.length, 'later'));
  const showAll = () => {
    prependAnchor.current = scrollRef.current?.scrollHeight ?? null;
    setWin(expandWindow({ start, end }, rows.length, 'all'));
  };

  const moreRow = (key: string, count: number, label: string, onMore: () => void, withShowAll: boolean) => (
    <TableRow key={key} className="hover:bg-transparent">
      <TableCell colSpan={10} className="p-1">
        <span className="sticky left-0 flex flex-wrap items-center gap-2 px-1">
          <Button variant="outline" size="sm" className="min-h-11 text-[10px] pointer-fine:md:min-h-0" onClick={onMore}>
            {label} ({count})
          </Button>
          {withShowAll ? (
            <Button variant="ghost" size="sm" className="min-h-11 text-[10px] pointer-fine:md:min-h-0" onClick={showAll}>
              Show all {rows.length}
            </Button>
          ) : null}
        </span>
      </TableCell>
    </TableRow>
  );

  const emptyContent =
    emptyReason === 'filtered' ? (
      <>
        <SearchX aria-hidden="true" className="mx-auto mb-1 size-6" />
        No flights match your filters
        <span className="mt-1 block text-[10px]">
          Try adjusting status, search or the advanced filters
        </span>
        <Button variant="outline" size="sm" className="mt-2 min-h-11 text-[10px] pointer-fine:md:min-h-0" onClick={onClearFilters}>
          Clear filters
        </Button>
      </>
    ) : emptyReason === 'deferred' ? (
      <>
        <Clock aria-hidden="true" className="mx-auto mb-1 size-6" />
        Still waiting on {emptySubject}
        <span className="mt-1 block text-[10px]">
          The schedule provider is paced to a daily limit — try Retry in a little while
        </span>
      </>
    ) : emptyReason === 'upstream' ? (
      <>
        <TriangleAlert aria-hidden="true" className="mx-auto mb-1 size-6" />
        Couldn't load {emptySubject} from the schedule provider
        <span className="mt-1 block text-[10px]">Try Retry in a moment</span>
      </>
    ) : (
      <>
        <CalendarDays aria-hidden="true" className="mx-auto mb-1 size-6" />
        No United flights listed for {emptySubject} yet
        <span className="mt-1 block text-[10px]">
          The provider publishes a day's board as it approaches
        </span>
      </>
    );

  if (compact) {
    const moreItem = (key: string, count: number, label: string, onMore: () => void, withShowAll: boolean) => (
      <li key={key} className="flex flex-wrap items-center gap-2 border-b p-1">
        <Button variant="outline" size="sm" className="min-h-11 text-xs" onClick={onMore}>
          {label} ({count})
        </Button>
        {withShowAll ? (
          <Button variant="ghost" size="sm" className="min-h-11 text-xs" onClick={showAll}>
            Show all {rows.length}
          </Button>
        ) : null}
      </li>
    );
    return (
      <div
        ref={scrollRef}
        tabIndex={0}
        data-schedule-scroller=""
        aria-label="Flight list, scrollable region"
        // Fills what the phone column leaves (ScheduleView is height-locked below `md`).
        className="relative min-h-48 flex-1 basis-0 overflow-y-auto rounded-md border bg-card/30"
      >
        {rows.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-muted-foreground">{emptyContent}</div>
        ) : (
          // `role="list"` is explicit because Safari drops list semantics from a list with
          // `list-style: none`, which is every Tailwind list.
          <ol ref={bodyRef as React.RefObject<HTMLOListElement>} role="list" aria-label="Flights">
            {start > 0 ? moreItem('sched-more-earlier', start, 'Show earlier flights', showEarlier, end >= rows.length) : null}
            {rows.slice(start, end).flatMap((row, offset) => {
              const index = start + offset;
              const items = [
                <SchedulePhoneRow
                  key={row.key}
                  row={row}
                  index={index}
                  watched={isWatched(row.ident)}
                  boardAsOf={boardAsOf}
                  dir={dir}
                  onOpenFlight={openFlight}
                  onToggleWatch={onToggleWatch}
                  onExplainDelay={onExplainDelay}
                />,
              ];
              if (index === dividerIndex) {
                items.unshift(
                  <li
                    key="sched-now-divider"
                    aria-label="Current time marker"
                    className="border-b bg-primary/10 px-2 py-1 font-mono text-[10px] tracking-wide text-primary"
                  >
                    ── NOW · {dividerLabel} ──
                  </li>,
                );
              }
              return items;
            })}
            {end < rows.length ? moreItem('sched-more-later', rows.length - end, 'Show later flights', showLater, true) : null}
          </ol>
        )}
      </div>
    );
  }

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
                      <Eye aria-hidden="true" className="size-3.5" />
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
        <TableBody ref={bodyRef as React.RefObject<HTMLTableSectionElement>}>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={10} className="py-10 text-center text-muted-foreground">
                {emptyContent}
              </TableCell>
            </TableRow>
          ) : (
            [
              ...(start > 0 ? [moreRow('sched-more-earlier', start, 'Show earlier flights', showEarlier, end >= rows.length)] : []),
              ...rows.slice(start, end).flatMap((row, offset) => {
              const index = start + offset;
              const cells = [
                <TableRow
                  key={row.key}
                  data-row-index={index}
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
                          row.actualLine.early ? 'text-bb-ok' : 'text-muted-foreground',
                        )}
                      >
                        {row.actualLine.text}
                      </span>
                    ) : null}
                  </TableCell>

                  {/* The printed number drops a provider suffix ("UA526H" → "UA526"); the row
                      attributes, the watch toggle and the palette keep the raw `ident`. */}
                  <TableCell className="font-mono font-semibold text-primary">{row.identDisplay}</TableCell>

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

                  <TableCell className="max-w-48 font-mono text-[10px]">
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
                    ) : row.regPending ? (
                      <span
                        className="font-sans text-muted-foreground"
                        title="The schedule has not named the aircraft yet. It usually appears a few hours before departure, or as soon as the plane shows up on live tracking."
                      >
                        Not assigned yet
                      </span>
                    ) : (
                      '—'
                    )}
                    {row.reg ? (
                      <SpecialLiveryBadge livery={liveryForTail(row.reg)} variant="icon" className="ml-0.5" />
                    ) : null}
                    {row.special ? (
                      <Badge variant="secondary" className="ml-1 px-1 py-0 text-[9px]">
                        <Star aria-hidden="true" /> {row.special}
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

                  <TableCell className="max-w-36">
                    <span className={cn('font-medium', STATUS_TONE[row.status.cls] ?? STATUS_TONE.unknown)}>
                      {row.status.text}
                      {row.status.presumed ? '*' : ''}
                    </span>
                    {row.status.live ? (
                      <Badge variant="secondary" className="ml-1 px-1 py-0 text-[9px]">
                        LIVE
                      </Badge>
                    ) : null}
                    {(() => {
                      // seen landing → seen airborne → presumed (schedule-row-display.js).
                      const evidence = statusEvidenceNote(row.status);
                      return evidence ? (
                        <span className="block text-[9px] text-muted-foreground" title={evidence.title}>
                          {evidence.text}
                          {evidence.note.startsWith(evidence.text) && evidence.note !== evidence.text ? (
                            <span className="sr-only">{evidence.note.slice(evidence.text.length)}</span>
                          ) : null}
                        </span>
                      ) : null;
                    })()}
                    {row.status.asOf ? (
                      <span className="block text-[9px] text-muted-foreground">as of {boardAsOf}</span>
                    ) : null}
                    {row.faaContext ? (
                      <span className="block text-[9px] text-bb-warn">{row.faaContext}</span>
                    ) : null}
                  </TableCell>

                  <TableCell className="text-right font-mono tabular-nums">
                    {row.delay.kind === 'delta' ? (
                      <DelayFigure delay={row.delay} dir={dir} actualFromRunway={row.actualFromRunway} />
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
                        {row.fleet.starlink ? (
                          <Zap aria-hidden="true" className="inline size-3 align-[-2px]" />
                        ) : (
                          <span aria-hidden="true">✓</span>
                        )}{' '}
                        {row.fleet.badge}
                      </span>
                    ) : row.reg ? (
                      <span className="text-muted-foreground">—</span>
                    ) : null}
                  </TableCell>

                  <TableCell>
                    {row.ident !== '—' ? (
                      // A toggle: one name per flight, the state in aria-pressed (F18) — a
                      // column of identical "Watch flight" buttons told a screen reader nothing.
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-11 pointer-fine:md:size-7"
                        aria-label={`Watch ${row.identDisplay}`}
                        aria-pressed={isWatched(row.ident)}
                        title={`${isWatched(row.ident) ? 'Stop watching' : 'Watch'} ${row.identDisplay}`}
                        onClick={() => onToggleWatch(row)}
                      >
                        <Eye
                          aria-hidden="true"
                          className={isWatched(row.ident) ? 'text-primary' : 'text-muted-foreground'}
                        />
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>,
              ];

              if (index === dividerIndex) {
                cells.unshift(
                  <TableRow
                    key="sched-now-divider"
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
            }),
              ...(end < rows.length ? [moreRow('sched-more-later', rows.length - end, 'Show later flights', showLater, true)] : []),
            ]
          )}
        </TableBody>
      </Table>
    </div>
  );
});
