/**
 * The nine-stat strip under the map, and the airborne chip that floats on the map below 1081 px.
 * Both open the 24-hour airborne graph, which LiveView owns (one poll, one dialog).
 *
 * At ≥1081 px it is the full strip. Between 769 and 1080 the map and sidebar already own every
 * pixel, and on a phone the bottom nav does, so the nine stats stay hidden there — but the graph
 * a visitor asked for ("the 24 hour graph of that number") has to be reachable on a phone. Until
 * Nov 2026 that was a 45 px row under the map: "United airborne 645 ⌇ 24-hour graph ›". It is now
 * a chip on the map beside the Key button, in the Key's own style, so the map gets those 45 px
 * back: the count, "airborne" and the sparkline, named in full for assistive tech.
 *
 * Every number comes from `computeLiveStats()` — including the honest `n/a (small sample)`
 * utilisation, which says so rather than asserting a precise percentage off a handful of
 * filtered flights. The bar's Airborne stat follows the map filters; the graph, its sparkline and
 * the chip count every flight (`airborneAll`), because that is what the server samples.
 *
 * The graph controls sit OUTSIDE the `role="status"` region: a live region re-reads itself whole
 * on every change, and a button inside it would be read out every 30 s.
 */

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { AirborneHistory } from '../../data/types';
import { AirborneSparkline } from './AirborneHistory';
import { MAP_BUTTON } from './MapControls';
import type { LiveStats } from './stats';

/** The phone/tablet way into the graph: a map control, paired with the Key button. */
export function AirborneChip({
  airborne,
  history,
  onOpen,
  className,
}: {
  airborne: number;
  history: AirborneHistory | null;
  onOpen: () => void;
  className?: string;
}) {
  const count = airborne > 0 ? airborne.toLocaleString() : null;
  return (
    <Button
      variant="outline"
      onClick={onOpen}
      aria-haspopup="dialog"
      data-testid="airborne-graph-row"
      className={cn(MAP_BUTTON, 'gap-1.5 px-2.5 font-normal', className)}
    >
      {/* The name is the visible words plus the rest for a screen reader, so what is seen is
          what is announced (WCAG 2.5.3); no aria-label to drift from the text. */}
      <span className="font-mono font-medium tabular-nums">
        {count ?? <span aria-hidden="true">—</span>}
      </span>{' '}
      <span className="text-muted-foreground">
        {count ? 'airborne' : 'Airborne'}{' '}
        <span className="sr-only">
          {count ? 'United flights. Open the 24-hour graph' : 'United flights: open the 24-hour graph'}
        </span>
      </span>
      <AirborneSparkline history={history} width={40} height={14} />
    </Button>
  );
}

export function StatsBar({
  stats,
  history,
  onOpenGraph,
}: {
  stats: LiveStats;
  history: AirborneHistory | null;
  onOpenGraph: () => void;
}) {
  const items: { label: string; value: string }[] = [
    { label: 'Airborne', value: stats.airborne.toLocaleString() },
    { label: 'Utilization', value: stats.utilization },
    { label: '⚡ Starlink', value: stats.starlink.toLocaleString() },
    { label: 'Climbing', value: stats.climbing.toLocaleString() },
    { label: 'Cruising', value: stats.cruising.toLocaleString() },
    { label: 'Descending', value: stats.descending.toLocaleString() },
    { label: 'Ground', value: stats.ground.toLocaleString() },
    { label: 'Avg Alt', value: stats.avgAlt },
    { label: 'Avg Spd', value: stats.avgSpd },
  ];

  return (
    <div className="hidden shrink-0 items-center gap-x-3 overflow-x-auto border-t bg-card/40 py-1 pr-4 pl-2 min-[1081px]:flex">
      <button
        type="button"
        onClick={onOpenGraph}
        aria-haspopup="dialog"
        aria-label="24h graph: United flights airborne over the last 24 hours"
        data-testid="airborne-graph-chip"
        className="flex min-h-11 shrink-0 items-center gap-1.5 rounded-md px-2 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground pointer-fine:md:min-h-0 pointer-fine:md:py-0.5"
      >
        <AirborneSparkline history={history} />
        24h
      </button>
      <div
        className="flex items-center gap-x-6 gap-y-1"
        role="status"
        aria-live="polite"
        aria-label="Live fleet statistics"
      >
        {items.map((item) => (
          <div key={item.label} className="flex shrink-0 items-baseline gap-1.5 text-xs">
            <span className="text-muted-foreground">{item.label}</span>
            <span className="font-mono font-medium tabular-nums">{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
