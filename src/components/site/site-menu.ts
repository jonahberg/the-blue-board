/**
 * Light-dismiss for SiteHeader's phone menu.
 *
 * The menu is a native <details> — it opens and closes without JavaScript — but a bare
 * <details> has no Escape handling and no outside-tap dismissal, and its panel is an absolute
 * popover over the page, so an open menu stayed open over the content (audit F27). This adds
 * both: Escape closes it and returns focus to the summary; a pointer-down outside closes it.
 *
 * Loaded through a processed Astro `<script>` (bundled to `_astro/`, never inline — CSP).
 */
export function wireSiteMenu(details: HTMLDetailsElement, doc: Document = document): () => void {
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !details.open) return;
    details.open = false;
    details.querySelector('summary')?.focus();
  };
  const onPointerDown = (event: Event) => {
    if (details.open && event.target instanceof Node && !details.contains(event.target)) {
      details.open = false;
    }
  };
  doc.addEventListener('keydown', onKeyDown);
  doc.addEventListener('pointerdown', onPointerDown);
  return () => {
    doc.removeEventListener('keydown', onKeyDown);
    doc.removeEventListener('pointerdown', onPointerDown);
  };
}
