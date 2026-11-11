/**
 * The one-line row under the canopy: the brief's headline when there is a current brief, the
 * rotating ticker when there is not.
 *
 * THE BRIEF ROW. On every tab, one line: the tone (calm plain; watch and disrupted with an icon,
 * a word and a status colour) and the brief's headline, truncated with an ellipsis. It is a
 * button: below `lg`, and on every tab but Live at `lg`+, it opens the full brief as a sheet
 * (`features/BriefSheet`); on Live at `lg`+, where the full brief already sits open at the top of
 * the sidebar, it brings that panel into view and focuses it. Same 28 px as the ticker row it
 * replaces, so the page does not move; on a coarse pointer its hit area reaches 8 px up into the
 * header's bottom padding (36 px), never down into the hub chips. Not a live region.
 *
 * AN EMERGENCY SQUAWK IS NEVER HIDDEN BY THE BRIEF. The ticker's squawk lines (the items
 * `buildTickerItems` marks `critical`) take the row's text while they last — the tone word stays,
 * the row still opens the brief, and its name says both (`briefAlertLine`, `briefRowLabel`). The
 * ops-health advisory line is not carried over: the brief covers it.
 *
 * THE FALLBACK. No brief yet, or one that is no longer current (src/lib/brief-view.js) → today's
 * ticker, unchanged: a 5-second fade rotation. The old marquee is gone — it only ever ran
 * above 768 px AND when the ticker sat outside the header, which stopped being true once the
 * strip moved into the canopy, so every real visitor has been seeing the fade for a long time.
 *
 * `aria-live="off"` is deliberate and load-bearing (inventory §2, §17). A strip that rotates
 * every five seconds would interrupt a screen-reader user continuously; the ONE polite
 * announcer on the page is `IropsAnnouncer`, which speaks only when the network state
 * actually changes. Item priority — advisory, counts, emergency squawks, the green line only
 * when nothing above it is an advisory — lives in `src/lib/ticker.js`.
 */

import { ChevronRight } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { decodeSquawk, isOnGround } from '@/lib/flight-phase.js';
import { deriveOpsHealth } from '@/lib/ops-health.js';
import { buildTickerItems } from '@/lib/ticker.js';
import { cn } from '@/lib/utils';
import { BRIEF_TONE_WORD, briefAlertLine, briefRowLabel } from '@/lib/brief-view.js';
import { ToneMark } from '../features/BriefTone';
import { useBrief } from '../state/brief';
import type { BriefReady } from '../state/brief';
import { useFeed } from '../state/feed';
import { useFleet } from '../state/fleet';
import { useIrops } from '../state/irops';
import { HUB_ORDER, useHubHealth } from '../state/schedule';
import { useMediaQuery } from '../state/hooks';
import { useUi } from '../state/ui';
import { useWeather } from '../state/weather';

const ROTATE_MS = 5000;
const FADE_MS = 400;

type TickerItem = { text: string; cls: string };

export function Ticker() {
  const { view } = useBrief();
  const items = useTickerItems();
  return view.status === 'ready' ? (
    <BriefRow view={view} alert={briefAlertLine(items)} />
  ) : (
    <RotatingTicker items={items} />
  );
}

/** The ticker's lines, in priority order (src/lib/ticker.js). */
function useTickerItems(): TickerItem[] {
  const feed = useFeed();
  const { fleetDb, starlink } = useFleet();
  const irops = useIrops();
  const weather = useWeather();
  const { byHub } = useHubHealth();

  return useMemo<TickerItem[]>(() => {
    const squawks = feed.flights
      .map((flight) => {
        const decoded = decodeSquawk(flight.squawk) as { text: string; cls: string } | null;
        if (!decoded || decoded.cls !== 'squawk-alert') return null;
        return {
          text: decoded.text,
          callsign: flight.callsign || flight.flightIATA || '',
          squawk: String(flight.squawk ?? ''),
        };
      })
      .filter((entry): entry is { text: string; callsign: string; squawk: string } =>
        Boolean(entry),
      );

    const opsHealth = deriveOpsHealth({
      hubOtps: byHub,
      faaIndex: weather.faaIndex,
      hubCodes: HUB_ORDER as string[],
      // The client fallback fills this when /api/irops is dark — see `state/irops.tsx`.
      iropsScore: irops.score,
    }) as { level: string; text: string };

    return buildTickerItems({
      opsHealth,
      // Same definition as the stat bar and the 24-hour graph (isOnGround), not the raw feed
      // flag: a parked jet with no ground flag, or a flagged one at altitude, counted differently.
      airborne: feed.flights.filter((f) => !isOnGround(f)).length,
      total: feed.flights.length,
      fleetCount: fleetDb.length,
      starlinkCount: starlink.tails.size,
      squawks,
    }) as TickerItem[];
  }, [feed.flights, fleetDb.length, starlink.tails, byHub, weather.faaIndex, irops.score]);
}

function BriefRow({ view, alert }: { view: BriefReady; alert: string | null }) {
  const { tab } = useUi();
  const { sheetOpen, setSheetOpen, revealPanel } = useBrief();
  // Keep in step with LiveView's sidebar query (DESIGN.md: the class and the query move together).
  const desktop = useMediaQuery('(min-width: 1024px)');
  const panelShowing = desktop && tab === 'live';

  return (
    <div className="flex h-7 shrink-0 border-b bg-card/40">
      <button
        type="button"
        onClick={() => (panelShowing ? revealPanel() : setSheetOpen(true))}
        aria-label={briefRowLabel(view.tone, view.headline, panelShowing ? 'reveal' : 'open', alert)}
        aria-haspopup={panelShowing ? undefined : 'dialog'}
        aria-expanded={panelShowing ? undefined : sheetOpen}
        aria-controls={panelShowing ? 'brief-panel' : undefined}
        className={cn(
          'relative flex min-w-0 flex-1 items-center gap-2 px-3 text-left text-[11px] transition-colors duration-100 hover:bg-accent/50 md:px-4',
          'pointer-coarse:after:absolute pointer-coarse:after:inset-x-0 pointer-coarse:after:-top-2 pointer-coarse:after:bottom-0',
        )}
      >
        {view.tone === 'calm' ? (
          <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            {BRIEF_TONE_WORD.calm}
          </span>
        ) : (
          <ToneMark tone={view.tone} className="font-mono text-[10px] uppercase tracking-wider" />
        )}
        {alert ? (
          // The squawk wins the row's text while it lasts; the headline is one tap away.
          <span className="min-w-0 flex-1 truncate font-medium text-destructive">{alert}</span>
        ) : (
          <span className="min-w-0 flex-1 truncate font-medium text-foreground">{view.headline}</span>
        )}
        <span aria-hidden="true" className="hidden shrink-0 text-muted-foreground sm:inline">
          {panelShowing ? 'In the sidebar' : 'Full brief'}
        </span>
        <ChevronRight aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
      </button>
    </div>
  );
}

function RotatingTicker({ items }: { items: TickerItem[] }) {
  const [index, setIndex] = useState(0);
  const [fading, setFading] = useState(false);

  useEffect(() => {
    setIndex(0);
  }, [items.length]);

  useEffect(() => {
    if (items.length <= 1) return undefined;
    const timer = setInterval(() => {
      setFading(true);
      setTimeout(() => {
        setIndex((current) => (current + 1) % items.length);
        setFading(false);
      }, FADE_MS);
    }, ROTATE_MS);
    return () => clearInterval(timer);
  }, [items.length]);

  if (items.length === 0) return null;
  const item = items[Math.min(index, items.length - 1)];

  return (
    <div
      // Never "polite": see the file header.
      aria-live="off"
      className="flex h-7 shrink-0 items-center overflow-hidden border-b bg-card/40 px-3 md:px-4"
    >
      <p
        className={cn(
          'truncate text-[11px] transition-opacity duration-300 motion-reduce:transition-none',
          fading ? 'opacity-0' : 'opacity-100',
          item.cls === 'advisory' && 'text-bb-warn',
          item.cls === 'critical' && 'font-medium text-destructive',
          item.cls === 'disclaimer' && 'text-muted-foreground',
        )}
      >
        {item.text}
      </p>
    </div>
  );
}
