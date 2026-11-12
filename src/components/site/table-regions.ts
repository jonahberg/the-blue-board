/**
 * Horizontally scrolling table containers on content pages.
 *
 * A table wider than a phone gets its OWN scroll container — never the whole section, which slid
 * the heading and the prose sideways with it. A container that scrolls must be reachable by
 * keyboard and announced (axe `scrollable-region-focusable`, WCAG 2.1.1), so in the HTML it is a
 * focusable, named region:
 *
 *   <div class="bb-scroll-region …" role="region" aria-label="Aircraft registry" tabindex="0"
 *        data-scroll-region data-scroll-label="Aircraft registry">
 *
 * That is complete on its own (no JS: the region is always a tab stop). With JS,
 * src/scripts/scroll-regions.ts keeps the role, the name and the tab stop only while the table
 * actually overflows, so a table that fits — every one at 1440 px — is not an empty tab stop or a
 * landmark.
 *
 * Two producers share the markup: `ScrollRegion.astro` for tables written in a page, and
 * `wrapTables()` below for the raw `contentHtml` strings in src/data (fleet seat-configuration
 * tables), which cannot be hand-wrapped.
 */

/**
 * The container's classes. The focus ring is drawn INSIDE the edge (`outline-offset: -2px`): an
 * ancestor that clips overflow (the raw strings' `.section`) would cut an outset ring off.
 */
export const SCROLL_REGION_CLASS =
  'bb-scroll-region overflow-x-auto overscroll-x-contain focus-visible:outline-offset-[-2px]';

const escapeAttr = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Visible text of an HTML fragment: tags dropped, the common entities decoded, spaces collapsed.
 *
 * Tags are stripped until nothing changes and any stray angle bracket is dropped, so a nested
 * fragment ("<scr<script>ipt>") cannot leave a tag behind; `&amp;` is decoded LAST, so the text
 * "&amp;quot;" comes out as "&quot;" rather than being unescaped twice. The result is only ever
 * re-escaped into an attribute (`escapeAttr`), but it should be right on its own.
 */
export function htmlText(fragment: string): string {
  let text = String(fragment ?? '');
  for (let previous = ''; previous !== text; ) {
    previous = text;
    text = text.replace(/<[^>]*>/g, '');
  }
  return text
    .replace(/[<>]/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&rsquo;|&lsquo;/g, "'")
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The opening tag of a region named `label`. */
export function scrollRegionOpen(label: string): string {
  const name = escapeAttr(label);
  return `<div class="${SCROLL_REGION_CLASS}" role="region" aria-label="${name}" tabindex="0" data-scroll-region data-scroll-label="${name}">`;
}

/**
 * Wrap every `<table>…</table>` in a raw HTML string in a scroll region named after the nearest
 * heading above it ("Seat configuration table"), or "Table" when there is none. Tables are never
 * nested in these strings; a string with no table comes back unchanged.
 */
export function wrapTables(html: string): string {
  if (!html || !/<table[\s>]/i.test(html)) return html;
  let out = '';
  let last = 0;
  const re = /<table[\s>][\s\S]*?<\/table>/gi;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    const before = html.slice(0, m.index);
    const headings = [...before.matchAll(/<h[2-4][^>]*>([\s\S]*?)<\/h[2-4]>/gi)];
    const heading = headings.length ? htmlText(headings[headings.length - 1][1]) : '';
    const label = heading ? `${heading} table` : 'Table';
    out += html.slice(last, m.index) + scrollRegionOpen(label) + m[0] + '</div>';
    last = m.index + m[0].length;
  }
  return out + html.slice(last);
}
