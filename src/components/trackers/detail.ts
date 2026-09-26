/**
 * Shared Tailwind class strings for the tracker detail pages.
 *
 * `TrackerDetailLayout.astro` and the two `[code].astro` routes render the same
 * section / stat / card / FAQ shapes. Before the rebuild those shapes lived in
 * the layout's `<style is:global>` block; on the new design system they are plain
 * utilities, and these constants are how the three files stay identical without
 * a stylesheet. Keep them whole strings — Tailwind only sees literals.
 */

/** A rule-separated content section. */
export const SECTION = 'mb-10 border-t border-border pt-6';

/** Section heading, with the underline that separates it from its body. */
export const SECTION_H2 =
  'mb-3.5 border-b border-border pb-1.5 text-base font-bold tracking-tight text-foreground';

/** Sub-heading inside a section (also the FAQ question). */
export const SECTION_H3 = 'mb-1.5 text-sm font-semibold text-foreground';

/** Body copy: measured line length, muted. */
export const SECTION_P = 'mb-3 max-w-2xl text-sm leading-relaxed text-muted-foreground last:mb-0';

/** The 3–4 tile summary grid at the top of a detail page. */
export const SUMMARY_GRID = 'grid grid-cols-2 gap-2.5 sm:grid-cols-[repeat(auto-fit,minmax(150px,1fr))]';

/** One summary tile. */
export const STAT = 'rounded-md border border-border bg-card px-4 py-3.5';
export const STAT_VALUE = 'block font-mono text-lg font-bold leading-tight text-amber-400';
export const STAT_LABEL =
  'font-mono text-[9px] font-semibold uppercase tracking-wider text-muted-foreground';

/** An entry card (an airport, a construction project). */
export const CARD = 'mb-3 rounded-md border border-border bg-card px-4 py-3.5 last:mb-0';
export const CARD_HEAD =
  'mb-1.5 flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-start';
export const CARD_BADGES = 'flex flex-wrap gap-1.5';

/** The mono metadata strip under a card heading. */
export const CARD_META =
  'mb-1.5 flex flex-wrap gap-x-3.5 gap-y-1.5 font-mono text-[9px] uppercase tracking-wide text-muted-foreground';

/** Card body copy. */
export const CARD_P = 'text-xs leading-relaxed text-muted-foreground';

/** A pulled-out caveat, amber-railed like the sidebars on the parent pages. */
export const NOTE =
  'rounded-r-md border-l-[3px] border-amber-400 bg-muted px-4 py-3 text-xs text-muted-foreground';
