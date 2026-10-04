/**
 * The nine-stat strip under the map, and the way into the 24-hour airborne graph.
 *
 * At ≥1081 px it is the full strip. Between 769 and 1080 the map and sidebar already own every
 * pixel, and on a phone the bottom nav does, so the nine stats stay hidden there — but the graph
 * a visitor asked for ("the 24 hour graph of that number") has to be reachable on a phone, so
 * below 1081 px the strip collapses to ONE 44 px row: the airborne count, its sparkline, "24h".
 * That row is the only map height this costs.
 *
 * Every number comes from `computeLiveStats()` — including the honest `n/a (small sample)`
 * utilisation, which says so rather than asserting a precise percentage off a handful of
 * filtered flights. The bar's Airborne stat follows the map filters; the graph, its sparkline and
 * the phone row count every flight (`airborneAll`), because that is what the server samples.
 *
 * The graph controls sit OUTSIDE the `role="status"` region: a live region re-reads itself whole
 * on every change, and a button inside it would be read out every 30 s.
 */

import { useState } from 'react';

import { AirborneHistoryDialog, AirborneSparkline, useAirborneHistory } from './AirborneHistory';
import type { LiveStats } from './stats';
import { useFeed } from '../../state/feed';

export function StatsBar({ stats }: { stats: LiveStats }) {
  const [graphOpen, setGraphOpen] = useState(false);
  const history = useAirborneHistory();
  const feed = useFeed();

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
    <>
      {/* Below 1081 px: one row, one tap target, the graph behind it. */}
      <div className="flex shrink-0 border-t bg-card/40 min-[1081px]:hidden">
        <button
          type="button"
          onClick={() => setGraphOpen(true)}
          aria-haspopup="dialog"
          data-testid="airborne-graph-row"
          className="flex min-h-11 w-full items-center gap-2 px-3 text-left text-xs hover:bg-accent pointer-fine:md:min-h-9"
        >
          <span className="text-muted-foreground">United airborne</span>
          <span className="font-mono font-medium tabular-nums">
            {stats.airborneAll > 0 ? stats.airborneAll.toLocaleString() : '—'}
          </span>
          <AirborneSparkline history={history.data} width={80} />
          <span className="ml-auto text-muted-foreground">
            24-hour graph <span aria-hidden="true">›</span>
          </span>
        </button>
      </div>

      <div className="hidden shrink-0 items-center gap-x-3 overflow-x-auto border-t bg-card/40 py-1 pr-4 pl-2 min-[1081px]:flex">
        <button
          type="button"
          onClick={() => setGraphOpen(true)}
          aria-haspopup="dialog"
          aria-label="24h graph: United flights airborne over the last 24 hours"
          data-testid="airborne-graph-chip"
          className="flex min-h-11 shrink-0 items-center gap-1.5 rounded-md px-2 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground pointer-fine:md:min-h-0 pointer-fine:md:py-0.5"
        >
          <AirborneSparkline history={history.data} />
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

      <AirborneHistoryDialog
        open={graphOpen}
        onOpenChange={setGraphOpen}
        history={history}
        liveAirborne={stats.airborneAll}
        liveFresh={feed.freshness === 'live' && feed.flights.length > 0}
      />
    </>
  );
}
