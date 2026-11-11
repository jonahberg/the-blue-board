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

const rows = [...document.querySelectorAll<HTMLElement>('[data-jump-nav], .bb-content .jump-nav')];
for (const row of rows) {
  sync(row);
  row.addEventListener('scroll', () => sync(row), { passive: true });
  // A pill reached by Tab scrolls the row; the fade follows.
  row.addEventListener('focusin', () => requestAnimationFrame(() => sync(row)));
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
