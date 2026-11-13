/**
 * Flight numbers on content pages are links to that flight's page (`/flight/UA5789`).
 *
 * Shared by the page scripts that print United flight numbers in a list or a timeline: the hub
 * pages' departures board (hub-board.ts), the fleet pages' airborne strip (fleet-live.ts) and the
 * flight page's "Its recent flights" list and inbound-aircraft step (flight-page.ts).
 *
 * WHICH numbers link is the dashboard's rule, src/lib/flight-link.js `flightLink()` (v1.28.0), so a
 * number links on a hub page exactly when it links on the dashboard: a United prefix is required (a
 * bare "5789" does not say whose flight it is), a provider suffix ("UA526H") and an operating
 * callsign (SKW5123) stay text. This file only puts that answer into the DOM.
 *
 * Text nodes only (never innerHTML), and same-tab: the flight page is part of this site.
 */

import { flightLink } from '../lib/flight-link.js';

/** The flight page for a printed number, or null: `flightLink()`'s answer, as an href. */
const hrefFor = (raw: unknown): string | null => (flightLink(raw) as { href: string } | null)?.href ?? null;

/**
 * A run of text split around the United flight numbers in it, for a sentence such as
 * "Aircraft arrived from Tulsa (UA5442)". Only `UA` + 1–4 digits that `flightLink()` links
 * become a link part; everything else stays text, in order.
 */
export function splitFlightIdents(text: string): Array<{ text: string; href?: string }> {
  const parts: Array<{ text: string; href?: string }> = [];
  const re = /\bUA\d{1,4}\b/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const href = hrefFor(m[0]);
    if (!href) continue;
    if (m.index > last) parts.push({ text: text.slice(last, m.index) });
    parts.push({ text: m[0], href });
    last = m.index + m[0].length;
  }
  if (last < text.length || parts.length === 0) parts.push({ text: text.slice(last) });
  return parts;
}

/**
 * Point a template's flight-number `<a>` at its page. A number we have no page for — or the page
 * the reader is already on (`here`) — gets no href, and an `<a>` without one is plain text to
 * every reader: not focusable, no link role. The templates style `[&:not([href])]` as text.
 */
export function setFlightLink(a: Element, raw: string, here = ''): void {
  a.textContent = raw;
  const href = hrefFor(raw);
  if (href && href !== (here ? hrefFor(here) : null)) a.setAttribute('href', href);
  else a.removeAttribute('href');
}

const linksIn = (root: Element) => [...root.querySelectorAll<HTMLAnchorElement>('a[href]')];

/**
 * The link in the refreshed row with the same `data-key` that stands where `active` stood in its
 * row: the same `data-f` field when the link has one, otherwise the same occurrence of its address
 * in the row. Null when `active` sits in no keyed row of `container`, when that row has gone, or
 * when the row no longer has that link.
 */
function sameLinkInSameRow(active: HTMLAnchorElement, container: Element, nodes: Node[]): HTMLAnchorElement | null {
  const row = active.closest<HTMLElement>('[data-key]');
  if (!row || row === container || !container.contains(row)) return null;
  const key = row.dataset.key;
  const fresh = nodes
    .flatMap((n) => (n instanceof HTMLElement ? [n, ...n.querySelectorAll<HTMLElement>('[data-key]')] : []))
    .find((el) => el.dataset.key === key);
  if (!fresh) return null;
  const field = active.dataset.f;
  if (field) return linksIn(fresh).find((a) => a.dataset.f === field) ?? null;
  const href = active.getAttribute('href');
  const n = linksIn(row).filter((a) => a.getAttribute('href') === href).indexOf(active);
  return linksIn(fresh).filter((a) => a.getAttribute('href') === href)[n] ?? null;
}

/**
 * `container.replaceChildren(...nodes)` for a list that refreshes on a timer, without throwing a
 * keyboard reader's focus off their place. Focus is set at most once, straight on its target, so a
 * screen reader hears one link.
 *
 * Rows that carry `data-key` (a departure on the hub board, an aircraft in the fleet strip, a leg on
 * the flight page; each key the same on every refresh) are found again by key: focus goes to the
 * same link in the same row, however the rows around it moved. When that row has left the list,
 * or no longer has that link, or the list has no keys, the address decides: the n-th link with
 * that address, as it was the n-th before (addresses repeat: a hub ends one leg and starts the
 * next, four strip rows fly into SFO); else the first link with it; else the list's first link, so
 * focus stays in the list.
 */
export function replaceChildrenKeepingFocus(container: Element, nodes: Node[]): void {
  const active = document.activeElement;
  if (!(active instanceof HTMLAnchorElement) || !container.contains(active)) {
    container.replaceChildren(...nodes);
    return;
  }
  const href = active.getAttribute('href');
  const sameHref = (a: Element) => a.getAttribute('href') === href;
  const occurrence = linksIn(container).filter(sameHref).indexOf(active);
  const inRow = sameLinkInSameRow(active, container, nodes);
  container.replaceChildren(...nodes);
  const links = linksIn(container);
  const matches = links.filter(sameHref);
  const next = inRow ?? matches[occurrence] ?? matches[0] ?? links[0];
  next?.focus({ preventScroll: true });
}
