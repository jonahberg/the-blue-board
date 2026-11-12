/**
 * How a dashboard link looks and how much it gives a finger: one set of classes for every link
 * that prints a name (FlightLink, DashLink and the per-kind links in EntityLinks).
 *
 * Tone (the plan's Global Constraints, spec "How a link looks"):
 *  - `identity`: link colour, underline on hover. One per row: the thing the row is about (a
 *    flight number on a flight row, the tail on a roster row).
 *  - `quiet`: body colour, underlined at rest in a muted line that takes the text colour on hover
 *    and focus. Every other link in the row. The underline is what says "link" without colour
 *    (WCAG 1.4.1), as prose links on content pages already do.
 *
 * Touch targets (DESIGN.md "A control may draw smaller than its target"):
 *  - `box`: the text keeps its size and an `after:` box gives it 44 px of height and at least
 *    44 px of width on a coarse pointer, centred on the text. For dense rows, where a taller
 *    element would grow the row. The link is `relative` for the box; a caller whose row has a
 *    stretched control of its own adds `z-10` so the link sits above it.
 *  - `inline`: the element itself is 44 px tall on touch (`min-h-11`), relaxed only for a mouse
 *    at `md`+. For a cell or a heading that already has the height to spare.
 *  - `none`: no extra area (the link sits inside something that is already 44 px).
 */

export const LINK_TONE = {
  identity: 'text-primary underline-offset-2 hover:underline',
  quiet:
    'text-inherit underline decoration-muted-foreground/40 underline-offset-2 hover:decoration-current focus-visible:decoration-current',
} as const;

export const LINK_HIT = {
  box: 'relative after:absolute after:top-1/2 after:left-1/2 after:h-11 after:w-[max(calc(100%+0.5rem),2.75rem)] after:-translate-x-1/2 after:-translate-y-1/2 pointer-fine:md:after:hidden',
  inline: 'inline-flex min-h-11 items-center pointer-fine:md:min-h-0',
  none: '',
} as const;

export type LinkTone = keyof typeof LINK_TONE;
export type LinkHit = keyof typeof LINK_HIT;
