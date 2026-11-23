/**
 * The dashboard canopy: brand, feed status, clock, and the controls that are reachable from
 * every tab.
 *
 * The LIVE/STALE chip keys off the AGE of the newest committed payload, never off the last
 * request's outcome — one failed poll against twelve-second-old data is still live data, and
 * the old chip flapping every 30 s taught that lesson the hard way. "NO DATA" is reserved
 * for the case where the feed has never produced flights at all.
 */

import { CircleHelp, Eye, HandHeart, House, Search } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { HELP_COVER_LABEL } from '@/lib/cover-a-day.js';
import { supportUrl } from '@/lib/support-link.js';
import { cn } from '@/lib/utils';
import { useFeed } from '../state/feed';
import { useMediaQuery, useNow } from '../state/hooks';
import { usePrefs } from '../state/prefs';
import { openSupportSheet } from '../state/support-sheet';
import { useUi } from '../state/ui';
import { useWatch } from '../state/watch';
import { TOUCH_CONTROL } from './touch-target';

/** HH:MM:SS in UTC — the clock every ops room runs on. */
function utcClock(now: number): string {
  return `${new Date(now).toISOString().slice(11, 19)}Z`;
}

/**
 * The header's controls (Nov 2026: the header is 44 px on a phone, down from 61): a 36 px ghost
 * surface with a 44 px hit box on touch (`TOUCH_CONTROL`). The box fills the header top to bottom,
 * and `z-10` keeps it above the brief row's own hit area, which reaches 8 px up into the header
 * from below (shell/Ticker) — under the controls the controls win, elsewhere the row does.
 */
const CONTROL = cn(TOUCH_CONTROL, 'z-10');

/** Where the desktop support link's words show: the `min-[1081px]:` classes on it, as a query. */
const LABEL_SHOWN = '(min-width: 1081px)';

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
  const labelShown = useMediaQuery(LABEL_SHOWN);

  // The chip counts EVERY row in the feed, the way the shipped header did — the stat bar
  // below the map is where "airborne" (which excludes aircraft on the ground) is reported.
  const tracked = feed.flights.length;
  // 'loading' until the first poll answers: the red NO DATA used to greet every visitor for the
  // second before the feed landed. NO DATA is for a feed that answered (or failed) with nothing.
  const state: 'live' | 'stale' | 'none' | 'loading' =
    feed.flights.length > 0
      ? feed.freshness === 'live'
        ? 'live'
        : 'stale'
      : feed.failed || feed.lastGoodTs !== null
        ? 'none'
        : 'loading';

  return (
    <header className="flex h-11 shrink-0 items-center gap-x-3 border-b px-3 md:h-12 md:px-4">
      {/* Named by its own words plus an sr-only purpose (WCAG 2.5.3): an aria-label over the
          visible wordmark and tagline announced different words from the ones on screen. The
          capitals are CSS, so a screen reader reads a name, not an acronym. */}
      <a href="#live" className="relative flex min-w-0 items-baseline gap-2 no-underline">
        <span className="whitespace-nowrap text-xs font-semibold tracking-tight uppercase sm:text-sm">
          The Blue Board
        </span>
        <span className="hidden truncate text-[10px] uppercase tracking-widest text-muted-foreground xl:inline">
          <span className="sr-only">: </span>
          For United flyers, by United flyers
        </span>
        <span className="sr-only">, back to the live map</span>
      </a>

      <div className="ml-auto flex items-center gap-2 md:gap-1.5">
        <Badge
          variant="outline"
          className={cn(
            'gap-1.5 font-mono',
            state === 'live' && 'border-bb-ok/30 text-bb-ok',
            state === 'stale' && 'border-bb-warn/30 text-bb-warn',
            state === 'none' && 'border-destructive/30 text-destructive',
            state === 'loading' && 'text-muted-foreground',
          )}
        >
          <span aria-hidden="true">
            {state === 'live' ? '●' : state === 'stale' ? '▲' : state === 'none' ? '■' : '○'}
          </span>
          {state === 'live' ? 'LIVE' : state === 'stale' ? 'STALE' : state === 'none' ? 'NO DATA' : 'LOADING'}
          {feed.flights.length > 0 ? (
            <span className="hidden text-muted-foreground sm:inline">
              · {tracked.toLocaleString()} flights{state === 'stale' ? ' (stale)' : ''}
            </span>
          ) : null}
        </Badge>

        <span className="hidden whitespace-nowrap text-[11px] text-muted-foreground lg:inline">
          {feed.countdown === null
            ? 'Paused (tab hidden)'
            : `Next refresh: ${feed.countdown}s`}
        </span>
        <span className="mr-1 hidden font-mono text-[11px] text-muted-foreground lg:inline">
          {utcClock(now)}
        </span>

        <Button
          variant="outline"
          // Below `sm` the label and the ⌘K hint are hidden and this is a ghost magnifier like the
          // icons beside it; from `sm` it is the outlined search field.
          className={cn(
            CONTROL,
            'gap-2 px-0 text-xs text-muted-foreground max-sm:border-transparent max-sm:bg-transparent max-sm:dark:border-transparent max-sm:dark:bg-transparent sm:px-2.5',
          )}
          onClick={() => setSearchOpen(true)}
          // Named by its own label, which is `sr-only` (never `hidden`, which would drop the name
          // too) below `sm`. No aria-label: one over the visible "Find a flight ⌘K" announced
          // different words from the ones on screen (WCAG 2.5.3). The ⌘K hint is aria-hidden and
          // exposed as aria-keyshortcuts instead.
          aria-haspopup="dialog"
          aria-keyshortcuts="Meta+K Control+K"
          // Where an overlay's focus goes when what opened it has left the page (a ⌘K result
          // opens the flight sheet, then the palette unmounts): src/lib/focus-return.js.
          data-focus-fallback=""
        >
          <Search aria-hidden="true" />
          <span className="max-sm:sr-only">Find a flight</span>
          <kbd
            aria-hidden="true"
            className="pointer-events-none hidden rounded border bg-muted px-1 font-mono text-[10px] sm:inline"
          >
            ⌘K
          </kbd>
        </Button>

        <Button
          variant="ghost"
          className={cn(CONTROL, 'gap-1 px-2 text-muted-foreground')}
          onClick={onOpenWatch}
          aria-expanded={watchOpen}
          aria-controls="watch-panel"
        >
          {/* Named by its words, the count it shows among them (WCAG 2.5.3): "Watched flights 2".
              An aria-label of "Watched flights (2)" over the visible "2" failed axe. */}
          <Eye aria-hidden="true" />
          <span className="sr-only">Watched flights</span>
          {watch.watched.length > 0 ? (
            <>
              {' '}
              <span className="rounded-full bg-primary-fill px-1.5 font-mono text-[10px] text-primary-foreground">
                {watch.watched.length}
              </span>
            </>
          ) : null}
        </Button>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              className={cn(CONTROL, 'hidden px-2 text-xs text-muted-foreground md:inline-flex')}
              onClick={cycleHomeAirport}
              aria-label={`Home hub: ${homeAirport || 'no preference'}. Change.`}
            >
              <House aria-hidden="true" />
              {/* With no hub set this said "–", which named nothing. */}
              {homeAirport ? <span className="font-mono">{homeAirport}</span> : 'Home hub'}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            Home hub — centres the map and picks the default schedule board
          </TooltipContent>
        </Tooltip>

        {/* From `md:` up (Nov 2026). Desktop had no visible way to give on first load: the strip
            waits for five minutes of use and ⓘ → About is a menu. So this is a plain link to the
            any-amount Stripe link, as quiet as its ghost neighbours, with its words showing from
            1081 px. Below that the words are `sr-only` (still the link's name, never `hidden`)
            and the tooltip says them. Measured in the widest state (stale feed, four-digit count,
            a watch count, "Paused"), the words ran 43 px into the wordmark at 1024 px and cleared
            it by 14 px at 1081 (the width where the stat strip under the map comes back). The
            tooltip stays shut while the words show (LABEL_SHOWN mirrors the classes), so they
            are not read twice. Counted as `desktop-header` by the delegated support_click
            listener (src/lib/support-tracking.js). */}
        <Tooltip open={labelShown ? false : undefined}>
          <TooltipTrigger asChild>
            <Button
              asChild
              variant="ghost"
              className={cn(
                CONTROL,
                'hidden px-0 text-xs text-muted-foreground md:inline-flex min-[1081px]:gap-1.5 min-[1081px]:px-2',
              )}
            >
              <a
                href={supportUrl('desktop-header')}
                target="_blank"
                rel="noopener noreferrer"
                data-support="desktop-header"
              >
                <HandHeart aria-hidden="true" />
                <span className="max-[1081px]:sr-only">{HELP_COVER_LABEL}</span>
              </a>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{HELP_COVER_LABEL}</TooltipContent>
        </Tooltip>

        {/* Phones only (below `md:`; the labelled link above takes over from `md:`). The ⓘ menu
            sits in the attribution strip, hidden below `md:`, and the phone header has no room
            for a fifth control (13 px spare at 360 px) — so below `md:` this slot is the support
            icon and "What is this dashboard?" moves into the More sheet. Since Nov 22 2026 the
            icon is a button that opens the "Cover a day" sheet, the amounts first
            (features/SupportSheet.tsx), not a link to Stripe: a tap on it is counted as
            `support_open` with `from: 'mobile-header'` (state/support-sheet.ts), not as a
            `support_click`; the sheet's links are the `support_click`s, labelled
            `mobile-header-<amount>` and `mobile-header-other` (src/lib/support-tracking.js). */}
        <Button
          variant="ghost"
          className={cn(CONTROL, 'p-0 text-muted-foreground md:hidden')}
          onClick={(event) => openSupportSheet('mobile-header', event.currentTarget)}
          aria-haspopup="dialog"
          aria-label="Cover a day of The Blue Board"
          title="Cover a day of The Blue Board"
        >
          <HandHeart aria-hidden="true" />
        </Button>

        <Button
          variant="ghost"
          className={cn(CONTROL, 'hidden p-0 text-muted-foreground md:inline-flex')}
          onClick={onOpenHelp}
          aria-label="What is this dashboard?"
        >
          <CircleHelp aria-hidden="true" />
        </Button>
      </div>
    </header>
  );
}
