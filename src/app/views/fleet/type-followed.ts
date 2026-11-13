/**
 * A click handler for a list that holds type links (the Fleet Pulse rows, the Special cards): it
 * calls `onFollowed` when a click on a type link inside it was followed in place.
 *
 * Such a follow stays on this tab and only sets the type filter (the links plan, ruling 2), and
 * the table it filters is far below these lists, so FleetView then brings the controls row into
 * view, as a Composition variant card does. Put on the list, the handler runs after the link's
 * own (the click bubbles), so `defaultPrevented` says whether the link was followed in place: a
 * modified or middle click, left to the browser, is not, and scrolls nothing. A type cell in the
 * table itself does not use this; the reader is already looking at the rows it filters.
 */

import type { MouseEvent } from 'react';

export function typeLinkFollowed(onFollowed: (() => void) | undefined) {
  return (event: MouseEvent<HTMLElement>) => {
    if (!onFollowed || !event.defaultPrevented) return;
    if (event.target instanceof Element && event.target.closest('a[data-type-link]')) onFollowed();
  };
}
