/**
 * The dashboard canopy: brand, feed status, clock, and the controls that are reachable from
 * every tab.
 *
 * The LIVE/STALE chip keys off the AGE of the newest committed payload, never off the last
 * request's outcome — one failed poll against twelve-second-old data is still live data, and
 * the old chip flapping every 30 s taught that lesson the hard way. "NO DATA" is reserved
 * for the case where the feed has never produced flights at all.
 */

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useFeed } from '../state/feed';
import { useNow } from '../state/hooks';
import { usePrefs } from '../state/prefs';
import { useUi } from '../state/ui';
import { useWatch } from '../state/watch';

/** HH:MM:SS in UTC — the clock every ops room runs on. */
function utcClock(now: number): string {
  return `${new Date(now).toISOString().slice(11, 19)}Z`;
}

export function Header({
  onOpenWatch,
  watchOpen,
  onOpenHelp,
}: {
  onOpenWatch: () => void;
  watchOpen: boolean;
  onOpenHelp: () => void;
}) {
  const feed = useFeed();
  const { homeAirport, cycleHomeAirport } = usePrefs();
  const { setSearchOpen } = useUi();
  const watch = useWatch();
  const now = useNow(1000);

  // The chip counts EVERY row in the feed, the way the shipped header did — the stat bar
  // below the map is where "airborne" (which excludes aircraft on the ground) is reported.
  const tracked = feed.flights.length;
  const state: 'live' | 'stale' | 'none' =
    feed.flights.length === 0 ? 'none' : feed.freshness === 'live' ? 'live' : 'stale';

  return (
    <header className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b px-3 py-2 md:px-4">
      <a
        href="#live"
        className="flex items-baseline gap-2 no-underline"
        aria-label="The Blue Board — back to the live map"
      >
        <span className="text-sm font-semibold tracking-tight">THE BLUE BOARD</span>
        <span className="hidden text-[10px] uppercase tracking-widest text-muted-foreground sm:inline">
          For United flyers, by United flyers
        </span>
      </a>

      {/* Touch targets: `min-h-11` (44 px, WCAG 2.5.5) up to the md breakpoint, then back to
          desktop density where the pointer is precise. */}
      <div className="ml-auto flex flex-wrap items-center gap-1.5">
        <Badge
          variant="outline"
          className={cn(
            'gap-1.5 font-mono',
            state === 'live' && 'border-emerald-500/30 text-emerald-400',
            state === 'stale' && 'border-amber-500/30 text-amber-400',
            state === 'none' && 'border-red-500/30 text-red-400',
          )}
        >
          <span aria-hidden="true">{state === 'live' ? '●' : state === 'stale' ? '▲' : '■'}</span>
          {state === 'live' ? 'LIVE' : state === 'stale' ? 'STALE' : 'NO DATA'}
          {feed.flights.length > 0 ? (
            <span className="hidden text-muted-foreground sm:inline">
              · {tracked.toLocaleString()} flights{state === 'stale' ? ' (stale)' : ''}
            </span>
          ) : null}
        </Badge>

        <span className="hidden text-[11px] text-muted-foreground lg:inline">
          {feed.countdown === null
            ? 'Paused (tab hidden)'
            : `Next refresh: ${feed.countdown}s`}
        </span>
        <span className="hidden font-mono text-[11px] text-muted-foreground lg:inline">
          {utcClock(now)}
        </span>

        <Button
          variant="outline"
          size="sm"
          // min-w too: below `sm` the label and the ⌘K hint are hidden and the button
          // collapses to the magnifier alone, which measured 38 px wide on a 400 px viewport.
          className="min-h-11 min-w-11 gap-2 text-muted-foreground md:h-8 md:min-h-0 md:min-w-0"
          onClick={() => setSearchOpen(true)}
        >
          <span aria-hidden="true">🔍</span>
          <span className="hidden sm:inline">Find a flight</span>
          <kbd className="pointer-events-none hidden rounded border bg-muted px-1 font-mono text-[10px] sm:inline">
            ⌘K
          </kbd>
        </Button>

        <Button
          variant="outline"
          size="sm"
          className="relative min-h-11 min-w-11 md:h-8 md:min-h-0 md:min-w-0"
          onClick={onOpenWatch}
          aria-expanded={watchOpen}
          aria-controls="watch-panel"
          aria-label={`Watched flights (${watch.watched.length})`}
        >
          <span aria-hidden="true">👁️</span>
          {watch.watched.length > 0 ? (
            <span className="ml-1 rounded-full bg-primary px-1.5 font-mono text-[10px] text-primary-foreground">
              {watch.watched.length}
            </span>
          ) : null}
        </Button>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="hidden h-8 font-mono text-xs md:inline-flex"
              onClick={cycleHomeAirport}
              aria-label={`Home hub: ${homeAirport || 'no preference'}. Change.`}
            >
              <span aria-hidden="true">🏠</span> {homeAirport || '—'}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            Home hub — centres the map and picks the default schedule board
          </TooltipContent>
        </Tooltip>

        <Button
          variant="ghost"
          size="sm"
          className="min-h-11 min-w-11 p-0 md:h-8 md:w-8 md:min-h-0 md:min-w-0"
          onClick={onOpenHelp}
          aria-label="What is this dashboard?"
        >
          ?
        </Button>
      </div>
    </header>
  );
}
