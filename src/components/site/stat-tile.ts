/**
 * One family for every stat tile on the content pages: `StatTile` (fleet pages, Newark's live
 * panel), the trackers' `StatStrip`, and the tracker detail pages' summary tiles
 * (src/components/trackers/detail.ts re-exports these).
 *
 * Label first, in the site's mono small caps; the figure under it in the data face (Geist Mono,
 * bold, tabular so digits line up across tiles); an optional sub-line in the label's face. Centred,
 * one padding. A figure is body colour unless it IS a status (DESIGN.md: colour is status only);
 * that tone is the caller's to add. Keep these whole strings — Tailwind only sees literals.
 */

/** The tile. */
export const STAT_CARD = 'rounded-lg border border-border bg-card px-3 py-3 text-center';

/** The label above the figure. */
export const STAT_LABEL =
  'block font-mono text-[11px] leading-snug font-semibold tracking-wider text-balance text-muted-foreground uppercase';

/** The figure. Words ("Not published") wrap rather than overflow a phone tile. */
export const STAT_VALUE = 'mt-1 block font-mono text-xl leading-tight font-bold tabular-nums text-balance sm:text-2xl';

/** An optional line under the figure. */
export const STAT_SUB = 'mt-1 block font-mono text-[11px] leading-snug tracking-wide text-balance text-muted-foreground';
