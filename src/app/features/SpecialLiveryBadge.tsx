/**
 * The special-livery marker: "this aircraft is wearing a special paint job" (Stars and Stripes,
 * Continental retro, Star Alliance …), from the curated list in `src/data/special-liveries.js`.
 *
 * Two shapes, because the places it appears differ in what may sit inside them:
 *  - `SpecialLiveryBadge` is its own `<button>` with a tooltip carrying the one-line
 *    description. It goes where nothing else is clickable around it — the flight sheet, the
 *    aircraft dialog, a fleet-table cell, the desktop schedule board's tail cell. The tooltip
 *    opens on hover, keyboard focus and (since v1.13.1) a touch tap.
 *  - `SpecialLiveryMarker` is inert: an icon with screen-reader words and a `title`. It goes
 *    INSIDE something that is already a button (a live-sidebar result, the phone board's
 *    stretched row), where a nested control would be invalid and steal the row's tap.
 *
 * The icon is lucide `Paintbrush` — not `Star`, which already means the fleet site's
 * named/special aircraft — and the chip is neutral: a livery is not a status, so it takes no
 * hue (DESIGN.md "Colour"). Both render nothing for a tail without a livery, so rows without
 * one never shift.
 */

import { Paintbrush } from 'lucide-react';

import { badgeVariants } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { liveryLabel, liveryShortName } from '@/lib/special-livery.js';
import { cn } from '@/lib/utils';

export type SpecialLivery = {
  tail: string;
  name: string;
  short?: string;
  description: string;
};

/**
 * `full` — "Special livery: Continental retro", badge-sized (flight sheet, aircraft dialog).
 * `compact` — the short name as a 9 px chip beside a registration (fleet tables).
 * `icon` — the brush alone, for a dense cell whose width is already spoken for.
 */
type Variant = 'full' | 'compact' | 'icon';

export function SpecialLiveryBadge({
  livery,
  variant = 'full',
  className,
}: {
  livery: SpecialLivery | null | undefined;
  variant?: Variant;
  className?: string;
}) {
  if (!livery) return null;
  const label = liveryLabel(livery);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={variant === 'full' ? undefined : label}
          className={cn(
            // `after:` widens the hit area to ~44 px on touch without growing the row
            // (DESIGN.md touch floor); `overflow-visible` keeps the badge from clipping it.
            'relative cursor-help overflow-visible after:absolute after:-inset-x-1 after:-inset-y-3 pointer-fine:md:after:inset-0',
            variant === 'full' && cn(badgeVariants({ variant: 'outline' }), 'overflow-visible'),
            variant === 'compact' &&
              'inline-flex items-center gap-0.5 rounded border px-1 py-0.5 align-middle text-[9px] leading-none text-foreground',
            variant === 'icon' &&
              'inline-flex items-center rounded-sm p-0.5 align-middle text-muted-foreground hover:text-foreground',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
            className,
          )}
        >
          <Paintbrush aria-hidden="true" className={variant === 'full' ? undefined : 'size-2.5'} />
          {variant === 'full' ? label : null}
          {variant === 'compact' ? liveryShortName(livery) : null}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="block max-w-[min(280px,70vw)]">
        <span className="block font-medium">{label}</span>
        <span className="block">{livery.description}</span>
      </TooltipContent>
    </Tooltip>
  );
}

export function SpecialLiveryMarker({
  livery,
  className,
}: {
  livery: SpecialLivery | null | undefined;
  className?: string;
}) {
  if (!livery) return null;
  const label = liveryLabel(livery);
  return (
    <span className={cn('inline-flex shrink-0 items-center', className)} title={label}>
      <Paintbrush aria-hidden="true" className="size-3" />
      <span className="sr-only">{label}</span>
    </span>
  );
}

export default SpecialLiveryBadge;
