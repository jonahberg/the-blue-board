/**
 * The Live map's key: what each aircraft colour and size means.
 *
 * Added in v1.14.0 because a visitor "couldn't figure out the meaning of the color-coding of
 * the aircraft icons" — there was no key at all, only a desktop-only "Starlink-equipped" chip.
 *
 * Every swatch is the marker itself: `PLANE_LEGEND` (src/lib/plane-icon.js) runs each row's
 * flags through `planeIconSpec`, so the fill and size here are the ones the map draws and the
 * two cannot drift. Rows the map cannot currently draw (long-haul with the layer off, Starlink
 * without a roster) are left out by `visibleLegendRows`.
 *
 * A disclosure, not a Popover: on a tablet or desktop the key is simply open in the map's
 * bottom-left corner (the Leaflet controls live bottom-right). Below `md` it starts closed —
 * a 44 px "Key" button — so it never covers a phone's map until asked for.
 */

import { Info } from 'lucide-react';
import { useId, useState } from 'react';

import { Button } from '@/components/ui/button';
import { PLANE_PATH, visibleLegendRows } from '@/lib/plane-icon.js';
import { cn } from '@/lib/utils';
import { useMediaQuery } from '../../state/hooks';

type LegendRow = { id: string; label: string; fill: string; size: number };

export function MapLegend({
  longhaulLayer,
  starlinkRoster,
  className,
}: {
  /** The Long-haul layer is on, so amber markers can appear. */
  longhaulLayer: boolean;
  /** The Starlink roster has tails, so violet markers can appear. */
  starlinkRoster: boolean;
  className?: string;
}) {
  const roomy = useMediaQuery('(min-width: 768px)');
  // Follows the breakpoint until the viewer chooses; their choice then sticks for the visit.
  const [choice, setChoice] = useState<boolean | null>(null);
  const open = choice ?? roomy;
  const panelId = useId();
  const rows = visibleLegendRows({ longhaulLayer, starlinkRoster }) as LegendRow[];

  return (
    <div className={cn('flex flex-col items-start gap-1', className)}>
      <div
        id={panelId}
        role="group"
        aria-label="Map key"
        hidden={!open}
        className="pointer-events-auto rounded-md border bg-background px-2 py-1.5 text-[11px]"
      >
        <ul className="space-y-1">
          {rows.map((row) => (
            <li key={row.id} className="flex items-center gap-2" data-legend={row.id}>
              {/* A 16 px cell holds every size, so the labels line up while each plane keeps
                  its real on-map size (watched 16, long-haul 14, default 10, Express 8.5). */}
              <span className="flex size-4 shrink-0 items-center justify-center" aria-hidden="true">
                <svg
                  width={row.size}
                  height={row.size}
                  viewBox="0 0 256 256"
                  fill={row.fill}
                  style={{ filter: `drop-shadow(0 0 2px ${row.fill})` }}
                >
                  <path d={PLANE_PATH} />
                </svg>
              </span>
              <span>{row.label}</span>
            </li>
          ))}
        </ul>
        {/* Most Express jets are Starlink aircraft and draw violet, so size is the Express cue
            that survives every colour (plane-icon.js). */}
        <p className="mt-1 text-muted-foreground">Smaller icon = United Express</p>
      </div>
      <Button
        size="sm"
        variant="outline"
        className="pointer-events-auto min-h-11 bg-background text-xs pointer-fine:md:min-h-8"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setChoice(!open)}
      >
        <Info aria-hidden="true" /> {open ? 'Hide key' : 'Key'}
      </Button>
    </div>
  );
}
