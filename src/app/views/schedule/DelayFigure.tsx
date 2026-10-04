/**
 * A measured delay — the same markup on the desktop table and the phone row.
 *
 *   ≥ +66m          a floor (the live feed proved a landing; the gate time is no earlier)
 *   ≤ +12m          a ceiling (the feed had it airborne before the provider's "actual")
 *   [takeoff] +38m  measured to wheels-up: the provider sent no gate time, so taxi-out is in it
 *
 * The bound glyph and the runway icon are decoration; the words for both are in the element
 * (`sr-only`) and the board-delay explanation is its title (DESIGN.md: never a glyph alone).
 * `whitespace-nowrap` keeps "≥ +1h06m" on one line in a narrow cell.
 */

import { PlaneLanding, PlaneTakeoff } from 'lucide-react';

import { delayColorVar } from '@/lib/delay-format.js';
import { delayFigure, runwayDelayMarker } from '@/lib/schedule-row-display.js';
import { cn } from '@/lib/utils';
import type { DelayCell } from './useBoardModel';
import { delayToneClass } from './tone';

export function DelayFigure({
  delay,
  dir,
  actualFromRunway,
  className,
}: {
  delay: Extract<DelayCell, { kind: 'delta' }>;
  dir: 'departures' | 'arrivals';
  actualFromRunway: boolean;
  className?: string;
}) {
  const figure = delayFigure(delay);
  const marker = runwayDelayMarker(delay, dir, actualFromRunway);
  const Icon = marker?.kind === 'touchdown' ? PlaneLanding : PlaneTakeoff;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 whitespace-nowrap',
        delayToneClass(delayColorVar(delay.minutes) as string),
        className,
      )}
      title={delay.title}
      data-delay-basis={delay.basis || undefined}
    >
      {marker ? <Icon aria-hidden="true" className="size-3 shrink-0 text-muted-foreground" /> : null}
      {figure.glyph ? <span aria-hidden="true">{figure.glyph}&#8201;</span> : null}
      {figure.sr ? <span className="sr-only">{figure.sr}</span> : null}
      <span>{figure.value}</span>
      {marker ? <span className="sr-only"> ({marker.note})</span> : null}
    </span>
  );
}
