/**
 * The chrome's compact control: a 36 px surface with a 44 px hit box wherever a finger may be
 * the pointer (WCAG 2.5.5, DESIGN.md "Touch targets are ≥44px unless the pointer is fine").
 *
 * The `after:` box grows the TARGET by 4 px a side without growing the row it sits in — the
 * phone header is 44 px and the map's floating controls should not cover more map than they draw
 * (Nov 2026). Controls built from this sit 8 px apart (`gap-2`), so neighbouring boxes meet
 * without overlapping. Inside a scroller the box is clipped at the scroller's padding edge, so a
 * scrolling row of these carries `p-1` (see `views/live/MapControls`).
 *
 * The box is 5 px, not 4: an absolutely placed pseudo-element is measured from inside its
 * owner's border, and every Button and Toggle here carries a 1 px border (transparent on a ghost),
 * so `-inset-1` measured 42 × 42 with `elementFromPoint`.
 *
 * Only a mouse at `md`+ drops back to a 32 px control with no extra box: width is not input type,
 * and an iPad at 1024 px is a touch screen.
 */
export const TOUCH_CONTROL =
  'relative h-9 min-w-9 after:absolute after:-inset-[5px] pointer-fine:md:h-8 pointer-fine:md:min-w-8 pointer-fine:md:after:hidden';
