/**
 * The nine-stat strip under the map.
 *
 * Hidden below 1081 px on purpose: between 769 and 1080 the map and sidebar already own
 * every pixel, and on mobile the bottom nav does. Every number comes from
 * `computeLiveStats()` — including the honest `n/a (small sample)` utilisation, which says
 * so rather than asserting a precise percentage off a handful of filtered flights.
 */

import type { LiveStats } from './stats';

export function StatsBar({ stats }: { stats: LiveStats }) {
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
    <div
      className="hidden shrink-0 items-center gap-x-6 gap-y-1 overflow-x-auto border-t bg-card/40 px-4 py-1.5 min-[1081px]:flex"
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
  );
}
