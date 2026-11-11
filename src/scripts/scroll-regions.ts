/**
 * Sideways-scrolling table containers (`[data-scroll-region]`, src/components/site/table-regions.ts).
 *
 * The HTML ships each container as a focusable, named region, which is right whenever the table is
 * wider than the screen. This keeps that only while it is true: a container whose content fits
 * loses its tab stop, its region role and its name (a `div` may not carry a name without a role),
 * and gets them back when a narrower window makes it scroll. A ResizeObserver catches both the
 * window and a font swap re-wrapping the table.
 *
 * Bundled by Astro under `_astro/` (CSP `script-src 'self'`); attributes only, no innerHTML.
 */

export function syncScrollRegion(el: HTMLElement): void {
  const scrolls = el.scrollWidth > el.clientWidth + 1;
  const label = el.dataset.scrollLabel || '';
  if (scrolls) {
    el.setAttribute('tabindex', '0');
    el.setAttribute('role', 'region');
    if (label) el.setAttribute('aria-label', label);
  } else if (document.activeElement !== el) {
    // Never pull the tab stop out from under a reader who is on it.
    el.removeAttribute('tabindex');
    el.removeAttribute('role');
    el.removeAttribute('aria-label');
  }
}

const regions = [...document.querySelectorAll<HTMLElement>('[data-scroll-region]')];
if (regions.length) {
  const regionOf = (node: Element) => node.closest<HTMLElement>('[data-scroll-region]');
  const observer =
    typeof ResizeObserver === 'function'
      ? new ResizeObserver((entries) => {
          for (const entry of entries) {
            const region = regionOf(entry.target);
            if (region) syncScrollRegion(region);
          }
        })
      : null;
  for (const el of regions) {
    syncScrollRegion(el);
    observer?.observe(el);
    // The table inside can change width without the container resizing (a font swap).
    const table = el.firstElementChild;
    if (table) observer?.observe(table);
    // A region kept as a tab stop only because a reader was on it is settled once they leave.
    el.addEventListener('focusout', () => syncScrollRegion(el));
  }
  if (!observer) window.addEventListener('resize', () => regions.forEach(syncScrollRegion), { passive: true });
}

export {};
