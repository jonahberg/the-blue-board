/**
 * Flight numbers on content pages are links to that flight's page (`/flight/UA5789`).
 *
 * Shared by the page scripts that print United flight numbers in a list or a timeline: the hub
 * pages' departures board (hub-board.ts), the fleet pages' airborne strip (fleet-live.ts) and the
 * flight page's "Its recent flights" list and inbound-aircraft step (flight-page.ts). A number
 * `parseFlightIdent` cannot read stays plain text, so a link never points at a page that would
 * only say "not a flight number".
 *
 * Text nodes only (never innerHTML), and same-tab: the flight page is part of this site.
 */

import { flightPagePath, parseFlightIdent } from '../lib/flight-page.js';

/** The flight page for a printed number ("UA5789", "UAL5789", "5789"), or null when it is not one. */
export function flightHref(raw: string | null | undefined): string | null {
  const parsed = parseFlightIdent(String(raw ?? ''));
  return parsed ? flightPagePath(parsed.ident) : null;
}

/**
 * A run of text split around the United flight numbers in it, for a sentence such as
 * "Aircraft arrived from Tulsa (UA5442)". Only `UA` + 1–4 digits that `parseFlightIdent`
 * accepts become a link part; everything else stays text, in order.
 */
export function splitFlightIdents(text: string): Array<{ text: string; href?: string }> {
  const parts: Array<{ text: string; href?: string }> = [];
  const re = /\bUA\d{1,4}\b/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const href = flightHref(m[0]);
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
  const href = flightHref(raw);
  if (href && href !== (here ? flightHref(here) : null)) a.setAttribute('href', href);
  else a.removeAttribute('href');
}

/**
 * `container.replaceChildren(...nodes)` for a list that refreshes on a timer, without throwing a
 * keyboard reader's focus back to the top of the page: when focus was on a link inside the old
 * list, it moves to the link with the same address in the new one (or to the list's first link,
 * so it stays inside the board when that flight has rolled off).
 */
export function replaceChildrenKeepingFocus(container: Element, nodes: Node[]): void {
  const active = document.activeElement;
  const hadFocus = active instanceof HTMLAnchorElement && container.contains(active) ? active.getAttribute('href') : null;
  container.replaceChildren(...nodes);
  if (hadFocus === null) return;
  const links = [...container.querySelectorAll<HTMLAnchorElement>('a[href]')];
  const next = links.find((a) => a.getAttribute('href') === hadFocus) ?? links[0];
  next?.focus({ preventScroll: true });
}
