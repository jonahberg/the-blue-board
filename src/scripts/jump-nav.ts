/**
 * The in-page jump row (src/components/site/JumpNav.astro, and `.bb-content .jump-nav` in the
 * compact hub pages' raw HTML) scrolls sideways below `md`. While pills sit past an edge, that
 * edge fades: `data-overflow` is `right`, `left` or `both`, and absent when the row fits or wraps.
 * The same cue as the dashboard map toolbar (src/app/views/live/MapControls.tsx).
 *
 * Bundled by Astro under `_astro/` (CSP `script-src 'self'`); one attribute, no innerHTML.
 */

/** Which edges have more pills past them (1 px of slack for sub-pixel widths). */
export function overflowEdges(el: Pick<HTMLElement, 'scrollLeft' | 'clientWidth' | 'scrollWidth'>): 'left' | 'right' | 'both' | null {
  const left = el.scrollLeft > 1;
  const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
  return left && right ? 'both' : left ? 'left' : right ? 'right' : null;
}

function sync(el: HTMLElement): void {
  const edges = overflowEdges(el);
  if (edges) el.dataset.overflow = edges;
  else delete el.dataset.overflow;
}

/** The faded band at each edge (the mask's 2.5rem), plus the focus ring's 4 px. */
const FADE_PX = 44;

/**
 * Bring a focused pill fully clear of the faded edges. The browser's own focus scroll stops with
 * the pill flush against the edge, under the fade, its ring half-hidden.
 */
export function revealOffset(row: { left: number; right: number }, pill: { left: number; right: number }, scrollLeft: number): number {
  if (pill.right > row.right - FADE_PX) return pill.right - (row.right - FADE_PX);
  if (scrollLeft > 0 && pill.left < row.left + FADE_PX) return Math.max(-scrollLeft, pill.left - (row.left + FADE_PX));
  return 0;
}

const rows = [...document.querySelectorAll<HTMLElement>('[data-jump-nav], .bb-content .jump-nav')];
for (const row of rows) {
  sync(row);
  row.addEventListener('scroll', () => sync(row), { passive: true });
  // A pill reached by Tab: scroll it clear of the fades (instant, so reduced motion is moot), then
  // the fade follows.
  row.addEventListener('focusin', (event) => {
    const pill = event.target instanceof HTMLElement ? event.target : null;
    if (pill && row.scrollWidth > row.clientWidth + 1) {
      const dx = revealOffset(row.getBoundingClientRect(), pill.getBoundingClientRect(), row.scrollLeft);
      if (dx) row.scrollLeft += dx;
    }
    requestAnimationFrame(() => sync(row));
  });
}
if (rows.length) {
  if (typeof ResizeObserver === 'function') {
    const observer = new ResizeObserver((entries) => entries.forEach((e) => sync(e.target as HTMLElement)));
    rows.forEach((row) => observer.observe(row));
  } else {
    window.addEventListener('resize', () => rows.forEach(sync), { passive: true });
  }
}

export {};
