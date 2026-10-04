/**
 * The board selector: which day, which hub, which direction, and how to narrow it.
 *
 * The day labels are hub-LOCAL dates (`getHubDayLabel`), which matters more than it sounds:
 * "Today" at NRT viewed from Chicago is a different calendar date, and the shipped code once
 * constructed these in browser-local time and lied about it.
 *
 * "Find in board" sits on the toolbar and the drawer's Search is the same state — one value,
 * one predicate. The shipped pair was two inputs mirrored by hand, which is the shape a
 * desync bug grows in.
 *
 * Escape closes the drawer and returns focus to the toggle (inventory §17), the same
 * contract every dialog on the site honours.
 *
 * Below `md` the same controls fold into TWO rows (day + direction, then hub · find · three
 * icon buttons). The wide toolbar wrapped to four 44 px rows on a phone, which together with
 * the stat cards pushed every flight below the fold at 360×780 (audit Oct 3 2026). Every
 * control is still here, at 44 px, with its full name in `aria-label`; only the words that
 * did not fit became icons. The desktop/tablet toolbar is untouched.
 */

import { CalendarDays, Crosshair, LoaderCircle, RotateCw, SlidersHorizontal } from 'lucide-react';
import { useEffect, useRef } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { getHubDayLabel } from '@/lib/hubTz.js';
import { activeAdvFilterCount, advFilterLabel } from '@/lib/schedule-load.js';
import { cn } from '@/lib/utils';
import type { BoardDirection } from '../../state/schedule';
import { AdvancedFilters } from './AdvancedFilters';
import type { FilterOption } from './AdvancedFilters';
import type { BoardFilters } from './useBoardModel';

/** All Hubs + the nine tracked airports, in the order the shipped select used. */
export const HUB_OPTIONS: { code: string; name: string }[] = [
  { code: 'ORD', name: "Chicago O'Hare" },
  { code: 'DEN', name: 'Denver' },
  { code: 'IAH', name: 'Houston' },
  { code: 'EWR', name: 'Newark' },
  { code: 'SFO', name: 'San Francisco' },
  { code: 'IAD', name: 'Washington Dulles' },
  { code: 'LAX', name: 'Los Angeles' },
  { code: 'NRT', name: 'Tokyo Narita' },
  { code: 'GUM', name: 'Guam' },
];

const ALL_HUBS = '__all__';
const DAYS: number[] = [-1, 0, 1];
const DAY_NAMES: Record<number, string> = { [-1]: 'Yesterday', 0: 'Today', 1: 'Tomorrow' };

export function ScheduleControls({
  hub,
  dir,
  day,
  filters,
  aircraftOptions,
  drawerOpen,
  desktop,
  loading,
  showJumpToNow,
  onHub,
  onDir,
  onDay,
  onFilters,
  onDrawerOpen,
  onRefresh,
  onJumpToNow,
}: {
  hub: string;
  dir: BoardDirection;
  day: number;
  filters: BoardFilters;
  aircraftOptions: FilterOption[];
  drawerOpen: boolean;
  desktop: boolean;
  loading: boolean;
  showJumpToNow: boolean;
  onHub: (hub: string) => void;
  onDir: (dir: BoardDirection) => void;
  onDay: (day: number) => void;
  onFilters: (patch: Partial<BoardFilters>) => void;
  onDrawerOpen: (open: boolean) => void;
  onRefresh: () => void;
  onJumpToNow: () => void;
}) {
  const toggleRef = useRef<HTMLButtonElement>(null);
  const activeCount = activeAdvFilterCount(filters) as number;

  // Escape closes the drawer and puts focus back where the viewer left it. A window
  // listener, not an onKeyDown: focus is usually inside a Radix select's portal, which is
  // outside this subtree, so a bubbling React handler would never see the key.
  useEffect(() => {
    if (!drawerOpen || !desktop) return undefined;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      onDrawerOpen(false);
      toggleRef.current?.focus();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [drawerOpen, desktop, onDrawerOpen]);

  const filterPanel = (idPrefix: string) => (
    <AdvancedFilters
      filters={filters}
      aircraftOptions={aircraftOptions}
      onChange={onFilters}
      idPrefix={idPrefix}
    />
  );

  const filterSheet = (
    <Sheet open={drawerOpen} onOpenChange={onDrawerOpen}>
      <SheetContent
        side="bottom"
        className="data-[side=bottom]:h-[80vh]"
        // The sheet is opened by the toolbar button rather than a `SheetTrigger`, so
        // Radix has no remembered element to hand focus back to on close.
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          toggleRef.current?.focus();
        }}
      >
        <SheetHeader>
          <SheetTitle>Filters</SheetTitle>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6" id="sched-adv-filters-mobile">
          {filterPanel('sched-m')}
        </div>
      </SheetContent>
    </Sheet>
  );

  if (!desktop) {
    const filtersName = activeCount > 0 ? `Filters (${activeCount} active)` : 'Filters';
    return (
      <div className="flex flex-col gap-2">
        <h2 className="sr-only">Flight Schedule</h2>
        <div className="flex items-center justify-between gap-2">
          <ToggleGroup
            type="single"
            value={String(day)}
            onValueChange={(value) => {
              if (value) onDay(Number(value));
            }}
            size="sm"
            aria-label="Schedule day"
          >
            {DAYS.map((offset) => (
              <ToggleGroupItem
                key={offset}
                value={String(offset)}
                aria-label={`${DAY_NAMES[offset]} (${getHubDayLabel(hub || 'ORD', offset) as string})`}
                className="min-h-11 px-2 text-[11px]"
              >
                {DAY_NAMES[offset]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <ToggleGroup
            type="single"
            value={dir}
            onValueChange={(value) => {
              if (value) onDir(value as BoardDirection);
            }}
            size="sm"
            aria-label="Board direction"
          >
            <ToggleGroupItem value="departures" className="min-h-11 px-2 text-[11px]">
              Departures
            </ToggleGroupItem>
            <ToggleGroupItem value="arrivals" className="min-h-11 px-2 text-[11px]">
              Arrivals
            </ToggleGroupItem>
          </ToggleGroup>
        </div>

        <div className="flex items-center gap-1.5">
          <Select
            value={hub || ALL_HUBS}
            onValueChange={(value) => onHub(value === ALL_HUBS ? '' : value)}
          >
            <SelectTrigger
              size="sm"
              aria-label="Schedule hub"
              className="min-h-11 w-[5.75rem] shrink-0 font-mono text-xs"
            >
              {/* The code alone: the full "ORD — Chicago O'Hare" took a whole row on a phone. */}
              <SelectValue placeholder="All hubs">{hub || 'All hubs'}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_HUBS}>All Hubs</SelectItem>
              {HUB_OPTIONS.map((option) => (
                <SelectItem key={option.code} value={option.code}>
                  {option.code} — {option.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Input
            aria-label="Find in board"
            placeholder="Find…"
            value={filters.search}
            onChange={(event) => onFilters({ search: event.target.value })}
            // 16px: iOS zooms the page on focus below that (DESIGN.md).
            className="min-h-11 min-w-0 flex-1 font-mono text-base"
          />

          {showJumpToNow ? (
            <Button
              variant="outline"
              size="icon"
              className="size-11 shrink-0"
              onClick={onJumpToNow}
              aria-label="Jump to now"
              title="Scroll to the current time"
            >
              <Crosshair aria-hidden="true" />
            </Button>
          ) : null}

          <Button
            size="icon"
            className="size-11 shrink-0"
            onClick={onRefresh}
            disabled={loading}
            aria-label={loading ? 'Loading…' : 'Refresh'}
            title="Refresh the board"
          >
            {loading ? (
              <LoaderCircle aria-hidden="true" className="animate-spin" />
            ) : (
              <RotateCw aria-hidden="true" />
            )}
          </Button>

          <Button
            ref={toggleRef}
            variant="outline"
            size="icon"
            aria-expanded={drawerOpen}
            aria-haspopup="dialog"
            aria-label={filtersName}
            title={filtersName}
            className={cn('relative size-11 shrink-0', activeCount > 0 && 'text-primary')}
            onClick={() => onDrawerOpen(!drawerOpen)}
          >
            <SlidersHorizontal aria-hidden="true" />
            {activeCount > 0 ? (
              <span
                aria-hidden="true"
                className="absolute -top-1 -right-1 min-w-4 rounded-full bg-primary-fill px-1 font-mono text-[9px] leading-4 text-primary-foreground"
              >
                {activeCount}
              </span>
            ) : null}
          </Button>
        </div>

        {filterSheet}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.15em] text-primary">
          <CalendarDays aria-hidden="true" className="size-3.5" /> Flight Schedule
        </h2>

        <ToggleGroup
          type="single"
          value={String(day)}
          onValueChange={(value) => {
            if (value) onDay(Number(value));
          }}
          size="sm"
          aria-label="Schedule day"
        >
          {DAYS.map((offset) => (
            <ToggleGroupItem
              key={offset}
              value={String(offset)}
              className="min-h-11 px-2 text-[10px] pointer-fine:md:min-h-0"
            >
              {DAY_NAMES[offset]}
              <span className="ml-1 hidden text-muted-foreground sm:inline">
                ({getHubDayLabel(hub || 'ORD', offset) as string})
              </span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Select
            value={hub || ALL_HUBS}
            onValueChange={(value) => onHub(value === ALL_HUBS ? '' : value)}
          >
            <SelectTrigger
              size="sm"
              aria-label="Schedule hub"
              className="min-h-11 w-auto min-w-[9.5rem] font-mono text-[11px] pointer-fine:md:min-h-0"
            >
              <SelectValue placeholder="All Hubs" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_HUBS}>All Hubs</SelectItem>
              {HUB_OPTIONS.map((option) => (
                <SelectItem key={option.code} value={option.code}>
                  {option.code} — {option.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* A segmented control, not Tabs: the board is one table below, so there is no
              tab panel for a TabsTrigger's aria-controls to point at (F39). The `value &&`
              guard stops a click on the selected item from emptying the selection. */}
          <ToggleGroup
            type="single"
            value={dir}
            onValueChange={(value) => {
              if (value) onDir(value as BoardDirection);
            }}
            size="sm"
            aria-label="Board direction"
          >
            <ToggleGroupItem value="departures" className="min-h-11 px-2.5 text-[10px] pointer-fine:md:min-h-0">
              Departures
            </ToggleGroupItem>
            <ToggleGroupItem value="arrivals" className="min-h-11 px-2.5 text-[10px] pointer-fine:md:min-h-0">
              Arrivals
            </ToggleGroupItem>
          </ToggleGroup>

          <Input
            aria-label="Find in board"
            placeholder="Find in board…"
            value={filters.search}
            onChange={(event) => onFilters({ search: event.target.value })}
            // 16px monospace below md needs the wider box, or the placeholder is cut off (D13).
            className="min-h-11 w-44 font-mono text-base pointer-fine:md:min-h-0 md:w-[8.5rem] md:text-[11px]"
          />

          {showJumpToNow ? (
            <Button
              variant="outline"
              size="sm"
              className="min-h-11 text-[10px] pointer-fine:md:min-h-0"
              onClick={onJumpToNow}
              title="Scroll to the current time"
            >
              ⌖ Jump to now
            </Button>
          ) : null}

          <Button size="sm" className="min-h-11 text-[10px] pointer-fine:md:min-h-0" onClick={onRefresh} disabled={loading}>
            {loading ? '⏳ Loading…' : '↻ Refresh'}
          </Button>

          <Button
            ref={toggleRef}
            variant="outline"
            size="sm"
            aria-expanded={drawerOpen}
            aria-controls="sched-adv-filters"
            className={cn('min-h-11 text-[10px] pointer-fine:md:min-h-0', activeCount > 0 && 'text-primary')}
            onClick={() => onDrawerOpen(!drawerOpen)}
          >
            {advFilterLabel(activeCount, drawerOpen) as string}
          </Button>
        </div>
      </div>

      {desktop ? (
        <div id="sched-adv-filters" hidden={!drawerOpen} className="rounded-md border bg-card/40 p-2">
          {filterPanel('sched')}
        </div>
      ) : (
        filterSheet
      )}
    </div>
  );
}
