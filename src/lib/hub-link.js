// ═══ HUB CODE → SCHEDULE BOARD OR HUB PAGE ═══
// A hub code printed as a name (a route end, a matrix header, a table cell) links to that hub's
// home on the side of the site the reader is on: inside the dashboard its Schedule board, in place
// (/?tab=schedule&hub=ORD); on a content page its hub page (/hubs/ord). Only the nine hubs have
// either; any other airport prints as plain text. A hub code attached to a status (an FAA tag, a
// weather line) goes where that status is shown, which is the caller's address, not this one.
//
// DOM-free; tested in tests/hub-link.test.js.

import { HUB_ORDER } from './hub-health.js';

const HUBS = new Set(HUB_ORDER);

/**
 * Where a printed hub code links, or null when it is not one of the nine hubs.
 *
 * @param {unknown} code  the airport code as printed, any case.
 * @param {'dashboard' | 'site'} side  the side of the site the link is printed on.
 * @returns {{code: string, href: string} | null}
 */
export function hubLink(code, side) {
  if (typeof code !== 'string') return null;
  const hub = code.trim().toUpperCase();
  if (!HUBS.has(hub)) return null;
  if (side === 'dashboard') return { code: hub, href: `/?tab=schedule&hub=${hub}` };
  if (side === 'site') return { code: hub, href: `/hubs/${hub.toLowerCase()}` };
  return null;
}
