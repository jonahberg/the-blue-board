/**
 * The radar half of the tab: the NEXRAD frame, its timestamp, and the category legend.
 *
 * The legend is the key to the map markers and each hub card's category chip — one set of
 * four colours, explained once. It carries the category names as text, so the four colours
 * are a shorthand for a label that is already written down rather than the only way to read
 * the map. The ⚠ entry explains the one mark a marker label can carry beyond its category:
 * an ops impact (rain, gusts, fog) on top of it. (A card's top border is the worst-of ops
 * colour and is explained by the status line printed beneath it, not by this legend.)
 */

import { CloudRain } from 'lucide-react';

import { WX_LEGEND } from '@/lib/weather-cards.js';
import { RadarMap } from '../../map/RadarMap';
import type { RadarHub } from '../../map/RadarMap';

export function RadarPanel({
  title,
  hubs,
  onSelectHub,
}: {
  title: string;
  hubs: RadarHub[];
  onSelectHub: (hub: string) => void;
}) {
  const legend = WX_LEGEND as { cat: string; color: string }[];
  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <h2 id="radar-title" className="flex shrink-0 items-center gap-1.5 font-mono text-xs text-muted-foreground">
        <CloudRain aria-hidden="true" className="size-3.5 shrink-0" />
        {title}
      </h2>
      {/* `isolate z-0`: Leaflet's panes sit at z-index 400+ and would otherwise paint over
          any Sheet or Dialog the shell opens at z-50.

          The map host is absolutely positioned rather than `h-full`: a percentage height
          resolves against a parent's HEIGHT, and this box gets its size from `min-height`
          plus `flex-1`, so `h-full` collapsed the Leaflet container to 0 px and drew an
          empty black rectangle. `inset-0` needs no resolvable parent height at all. */}
      {/* On a phone the attribution line runs the map's full width (two lines at 375 px), so
          the zoom stack (bottom left) sat on top of it. Below `sm`, and scoped to this map, the
          stack is lifted clear of it; wider, the attribution sits right and nothing moves. `!`
          because leaflet.css is unlayered and outranks a layered utility. Where the shell hides
          the zoom buttons for touch, this changes nothing. */}
      <div className="relative isolate z-0 min-h-[240px] flex-1 overflow-hidden rounded-lg border max-sm:[&_.leaflet-bottom.leaflet-left_.leaflet-control-zoom]:mb-10!">
        <RadarMap hubs={hubs} onSelectHub={onSelectHub} className="absolute inset-0" />
      </div>
      <ul className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-muted-foreground">
        {legend.map((entry) => (
          <li key={entry.cat} className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              style={{ backgroundColor: entry.color }}
              className="size-2 rounded-full"
            />
            {entry.cat}
          </li>
        ))}
        <li className="flex items-center gap-1.5">
          <span aria-hidden="true">⚠</span>
          ops impact (rain, gusts, fog…)
        </li>
      </ul>
    </div>
  );
}

export default RadarPanel;
