/**
 * A printed flight number: a link to its flight page (/flight/UA576) when it has one, plain body
 * text when it does not (`flightLink()` in src/lib/flight-link.js decides).
 *
 * Link colour means link. The Schedule board printed "UA576" in `text-primary` as a plain cell;
 * the owner clicked it expecting the flight page and nothing happened (Nov 2026). So a flight
 * number is either a real `<a href>` — same tab, underline on hover, the global focus ring,
 * middle-click and "copy link" for free — or it is body text.
 *
 * Touch targets (DESIGN.md "A control may draw smaller than its target"):
 *  - `hit="box"` (default): the text keeps its size and an `after:` box gives it 44 px of height
 *    and at least 44 px of width on a coarse pointer, centred on the text. For dense rows, where a
 *    taller element would grow the row. The link is `relative` for the box; a caller whose row
 *    has a stretched control of its own adds `z-10` so the number sits above it.
 *  - `hit="inline"`: the element itself is 44 px tall on touch (`min-h-11`), relaxed only for a
 *    mouse at `md`+. For a cell or a heading that already has the height to spare.
 *  - `hit="none"`: no extra area (the number sits inside something that is already 44 px).
 */

import type { ReactNode } from 'react';

import { flightLink } from '@/lib/flight-link.js';
import { cn } from '@/lib/utils';

const HIT = {
  box: 'relative after:absolute after:top-1/2 after:left-1/2 after:h-11 after:w-[max(calc(100%+0.5rem),2.75rem)] after:-translate-x-1/2 after:-translate-y-1/2 pointer-fine:md:after:hidden',
  inline: 'inline-flex min-h-11 items-center pointer-fine:md:min-h-0',
  none: '',
} as const;

export type FlightLinkProps = {
  /** The flight number exactly as it is printed. */
  ident: string;
  /** Classes for both renderings (font, size, weight). */
  className?: string;
  /** Classes for the link only. */
  linkClassName?: string;
  hit?: keyof typeof HIT;
  /** Printed instead of `ident` (rare: the ident still decides the link). */
  children?: ReactNode;
};

export function FlightLink({ ident, className, linkClassName, hit = 'box', children }: FlightLinkProps) {
  const link = flightLink(ident);
  if (!link) return <span className={className}>{children ?? ident}</span>;
  return (
    <a
      href={link.href}
      data-flight-link={link.ident}
      className={cn('text-primary underline-offset-2 hover:underline', HIT[hit], className, linkClassName)}
    >
      {children ?? ident}
    </a>
  );
}

export default FlightLink;
