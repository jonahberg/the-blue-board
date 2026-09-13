/**
 * The radar half of the tab: the NEXRAD frame, its timestamp, and the category legend.
 *
 * The legend is the key to BOTH the map markers and the hub-card borders — one set of four
 * colours, explained once. It carries the category names as text, so the four colours are a
 * shorthand for a label that is already written down rather than the only way to read the
 * map.
 */

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
    <div className="flex min-h-0 flex-col gap-2">
      <h2 id="radar-title" className="shrink-0 font-mono text-xs text-muted-foreground">
        {title}
      </h2>
      {/* `isolate z-0`: Leaflet's panes sit at z-index 400+ and would otherwise paint over
          any Sheet or Dialog the shell opens at z-50. */}
      <div className="isolate z-0 min-h-[240px] flex-1 overflow-hidden rounded-lg border">
        <RadarMap hubs={hubs} onSelectHub={onSelectHub} className="size-full" />
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
      </ul>
    </div>
  );
}

export default RadarPanel;
