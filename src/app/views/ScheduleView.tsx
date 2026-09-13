/**
 * Schedule — the departure and arrival boards for the nine tracked hubs (inventory §20).
 *
 * The store owns loading policy and the raw rows; this view owns everything a viewer can
 * change and everything derived from it. A few decisions worth stating:
 *
 *  - The filters that feed the derived model are DEBOUNCED (120 ms) while the inputs stay
 *    controlled and instant. Typing into "Find in board" on a 700-row ORD board otherwise
 *    reclassifies and re-risk-scores the whole thing on every keystroke.
 *  - Changing hub, direction or day resets the four contextual filters (route type, wifi,
 *    time range, delay risk) and nothing else. Those four describe a board; a status filter
 *    or a search term describes what the viewer is looking for, and silently dropping it on
 *    a hub switch is the more annoying failure.
 *  - The board loads from an effect keyed on the selection, so a deep link (`?hub=DEN`), the
 *    search palette's `goto` and a click on the hub select all take the same path.
 *  - AeroDataBox is credited before any other provider in the footer — the schedules are
 *    theirs, and crediting Flightradar24 here was a ToS violation. FR24 credit belongs to
 *    live aircraft positions only.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { getTypicalFleetStats } from '@/lib/equipment-swaps.js';
import { getHubDayLabel, getStartOfHubDay } from '@/lib/hubTz.js';
import { boardAsOfMs, describeBoardCondition, formatBoardAsOf } from '@/lib/schedule-load.js';
import { analyzeSwapImpact } from '@/lib/swap-impact.js';
import { useFeed } from '../state/feed';
import { useFleet } from '../state/fleet';
import { useMediaQuery } from '../state/hooks';
import { useIrops } from '../state/irops';
import { boardKey, useHubHealth, useSchedule } from '../state/schedule';
import type { BoardDirection, EquipmentSwap } from '../state/schedule';
import { useUi } from '../state/ui';
import { useWatch } from '../state/watch';
import { useWeather } from '../state/weather';
import { ScheduleControls } from './schedule/ScheduleControls';
import { ScheduleStats } from './schedule/ScheduleStats';
import { ScheduleTable } from './schedule/ScheduleTable';
import type { ScheduleTableHandle } from './schedule/ScheduleTable';
import { StalenessBanner } from './schedule/StalenessBanner';
import type { BoardCondition } from './schedule/StalenessBanner';
import { SwapSummary } from './schedule/SwapSummary';
import { WatchBanner } from './schedule/WatchBanner';
import { EMPTY_FILTERS, aircraftOptions, useBoardModel } from './schedule/useBoardModel';
import type { BoardFilters, RowModel, SortColumn } from './schedule/useBoardModel';

/** How long a filter change waits before the board is recomputed. */
const RENDER_DEBOUNCE_MS = 120;

/** Contextual filters describe a BOARD, so they reset when the board changes. */
const CONTEXTUAL_FILTERS = {
  routeType: '',
  starlink: '',
  timeRange: '',
  risk: '',
} satisfies Partial<BoardFilters>;

export default function ScheduleView() {
  const schedule = useSchedule();
  const { current, boards, loading, errors, load, refresh, nowSec } = schedule;
  const { hub, dir, day } = current;

  const feed = useFeed();
  const fleet = useFleet();
  const weather = useWeather();
  const irops = useIrops();
  const watch = useWatch();
  const ui = useUi();
  const hubHealth = useHubHealth();
  const desktop = useMediaQuery('(min-width: 768px)');

  const [filters, setFilters] = useState<BoardFilters>(EMPTY_FILTERS);
  const [debouncedFilters, setDebouncedFilters] = useState<BoardFilters>(EMPTY_FILTERS);
  const [sort, setSort] = useState<{ column: SortColumn; asc: boolean }>({
    column: 'time',
    asc: true,
  });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const tableRef = useRef<ScheduleTableHandle>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedFilters(filters), RENDER_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [filters]);

  // One load path for every way the selection can change: the controls, a deep link, and the
  // search palette's `goto` all just set `current`.
  const key = boardKey(hub, dir, day);
  const board = boards[key];
  const isLoading = Boolean(loading[key]);
  const error = errors[key];
  useEffect(() => {
    if (!hub) return;
    if (boards[key] || loading[key]) return;
    void load(hub, dir, day);
    // `boards`/`loading` are read, not depended on: a board landing must not re-trigger a
    // load, and the guard above already reads their current values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hub, dir, day, key, load]);

  // Reset the four board-shaped filters whenever the board changes.
  useEffect(() => {
    setFilters((prev) => ({ ...prev, ...CONTEXTUAL_FILTERS }));
  }, [hub, dir, day]);

  const dayStartSec = useMemo(() => {
    if (!hub) return 0;
    try {
      return getStartOfHubDay(hub, day) as number;
    } catch {
      return 0;
    }
  }, [hub, day]);

  const rows = board?.rows ?? [];
  const swaps = board?.swaps ?? [];

  const model = useBoardModel({
    rows,
    hub,
    dir,
    day,
    dayStartSec,
    nowSec: nowSec(),
    meta: board?.meta ?? null,
    filters: debouncedFilters,
    sort,
    swaps,
    liveFlights: feed.flights,
    liveFeedTs: feed.lastGoodTs,
    lookupReg: feed.lookupReg,
    fleetDb: fleet.fleetDb,
    fleetByReg: fleet.fleetByReg,
    starlinkTails: fleet.starlink.tails,
    special: fleet.special,
    faaIndex: weather?.faaIndex ?? {},
    weatherOpsByHub: weather?.weatherOpsByHub ?? {},
    nas: weather?.nas ?? null,
    hubOtp: hubHealth.byHub,
    iropsHubRates: irops.hubRates,
  });

  const asOf = useMemo(
    () =>
      board
        ? (formatBoardAsOf(
            boardAsOfMs(board.meta, board.fetchedAt) as number,
            model.hubTz,
          ) as string)
        : '',
    [board, model.hubTz],
  );

  const condition = useMemo<BoardCondition>(
    () =>
      board
        ? (describeBoardCondition(
            {
              partial: board.partial,
              degraded: board.degraded,
              stale: board.stale,
              meta: board.meta ?? {},
            },
            { asOf },
          ) as BoardCondition)
        : { kind: 'none', message: '', suffix: '', tone: 'muted', icon: '' },
    [board, asOf],
  );

  // One-shot: anchor a freshly loaded TODAY board at NOW, never on a filter re-render and
  // never while the viewer is on another tab.
  const lastAnchored = useRef(0);
  useEffect(() => {
    if (!schedule.autoScrollKey || schedule.autoScrollKey === lastAnchored.current) return;
    if (ui.tab !== 'schedule') return;
    if (model.firstFutureIndex < 0) return;
    lastAnchored.current = schedule.autoScrollKey;
    tableRef.current?.scrollToNow(false);
  }, [schedule.autoScrollKey, ui.tab, model.firstFutureIndex]);

  // The search palette asked for a row. The board may still be loading, so this retries on
  // each render until the row exists (or the viewer navigates away and clears it).
  const { pendingGoto, clearGoto } = schedule;
  useEffect(() => {
    if (!pendingGoto) return;
    if (isLoading) return;
    const found = tableRef.current?.revealFlight(pendingGoto.flight);
    if (found || !board) clearGoto();
  }, [pendingGoto, isLoading, board, model.rows, clearGoto]);

  const impactsFor = useCallback(
    (swap: EquipmentSwap) =>
      analyzeSwapImpact(swap.oldAc, swap.newAc, swap.reg || '', {
        getTypicalFleetStats: (code: string) =>
          getTypicalFleetStats(code, fleet.fleetDb, fleet.starlink.tails),
        fleetByReg: fleet.fleetByReg,
        starlinkTails: fleet.starlink.tails,
      }) as { cls: string }[],
    [fleet.fleetDb, fleet.fleetByReg, fleet.starlink.tails],
  );

  const onFilters = useCallback(
    (patch: Partial<BoardFilters>) => setFilters((prev) => ({ ...prev, ...patch })),
    [],
  );

  const onSort = useCallback((column: SortColumn) => {
    setSort((prev) => (prev.column === column ? { column, asc: !prev.asc } : { column, asc: true }));
  }, []);

  const onToggleWatch = useCallback(
    (row: RowModel) => {
      watch.toggle(row.ident, row.watchRoute, row.status.text);
    },
    [watch],
  );

  const aircraft = useMemo(
    () => aircraftOptions(rows).map((option) => ({ value: option.code, label: option.label })),
    [rows],
  );

  const dayLabel = (getHubDayLabel(hub || 'ORD', day) as string) ?? '';
  const showJumpToNow = day === 0 && model.firstFutureIndex >= 0;

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-2 md:p-3">
      <ScheduleControls
        hub={hub}
        dir={dir}
        day={day}
        filters={filters}
        aircraftOptions={aircraft}
        drawerOpen={drawerOpen}
        desktop={desktop}
        loading={isLoading}
        showJumpToNow={showJumpToNow}
        onHub={(next) => schedule.setCurrent({ hub: next })}
        onDir={(next: BoardDirection) => schedule.setCurrent({ dir: next })}
        onDay={(next) => schedule.setCurrent({ day: next })}
        onFilters={onFilters}
        onDrawerOpen={setDrawerOpen}
        onRefresh={refresh}
        onJumpToNow={() => tableRef.current?.scrollToNow(true)}
      />

      <WatchBanner alert={schedule.watchAlert} onDismiss={schedule.clearWatchAlert} />

      {!hub ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-muted-foreground">
          <span className="text-2xl" aria-hidden="true">
            📅
          </span>
          <p className="text-xs">Select a hub to load schedule data</p>
        </div>
      ) : error ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <span className="text-2xl" aria-hidden="true">
            ⚠️
          </span>
          <p className="text-xs">Error loading schedule: {error}</p>
          <p className="text-[10px] text-muted-foreground">Try again in a moment</p>
          <Button size="sm" onClick={refresh}>
            ↻ Retry
          </Button>
        </div>
      ) : isLoading && !board ? (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            <span className="mr-1" aria-hidden="true">
              ✈️
            </span>
            Loading {hub} {dir} for {dayLabel}…
          </p>
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : (
        <>
          <SwapSummary swaps={swaps} impactsFor={impactsFor} onOpenFilters={() => setDrawerOpen(true)} />
          <ScheduleStats
            stats={model.stats}
            dir={dir}
            dayLabel={dayLabel}
            hub={hub}
            hubDisruptionMinutes={
              board?.meta?.hubDisruptionMinutes != null ? Number(board.meta.hubDisruptionMinutes) : null
            }
          />
          <StalenessBanner condition={condition} onRetry={refresh} />
          <ScheduleTable
            ref={tableRef}
            rows={model.rows}
            dividerIndex={model.dividerIndex}
            dividerLabel={model.dividerLabel}
            firstFutureIndex={model.firstFutureIndex}
            sort={sort}
            onSort={onSort}
            isWatched={watch.isWatched}
            onToggleWatch={onToggleWatch}
            onOpenAircraft={ui.openAircraft}
            onExplainDelay={ui.openDelayExplain}
            boardAsOf={asOf}
          />
          <p className="text-center text-[9px] text-muted-foreground">
            Schedule data via{' '}
            <a
              href="https://aerodatabox.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-emerald-400 underline"
            >
              AeroDataBox
            </a>{' '}
            · United flights only · All times {hub || 'selected hub'} local (
            <b>{model.tzAbbrev}</b>)
          </p>
        </>
      )}
    </div>
  );
}
