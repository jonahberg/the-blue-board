// ═══ HUB CODE → SCHEDULE BOARD OR HUB PAGE ═══
// A hub code printed as a name (a route end, a matrix header, a table cell) links to that hub's
// home on the side of the site the reader is on: inside the dashboard its Schedule board, in place
// (/?tab=schedule&hub=ORD); on a content page its hub page (/hubs/ord). Only the nine hubs have
// either; any other airport prints as plain text. A hub code attached to a status (an FAA tag, a
// weather line) goes where that status is shown, not to the board: `hubStatusLink`.
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

/**
 * The Weather tab's NAS status panel, which lists every FAA program at every airport: where an FAA
 * code links (`hubStatusLink(code, 'nas')`, Newark's program line included), and where a line about
 * FAA programs in general links with no code of its own (the Sources tab's FAA card, the brief's
 * planned-program chips, /hubs "Ground stops & FAA alerts"). The one place the address is written.
 */
export const NAS_STATUS_HREF = '/?tab=weather&section=nas';

/**
 * Where a hub code printed as part of a status links inside the dashboard: where that status is
 * shown, not the hub's board.
 *
 *  - 'weather': the hub's card on the Weather tab (`/?tab=weather&hub=EWR`), which shows its
 *    weather and its FAA programs. Only the nine hubs have a card; any other airport is null.
 *  - 'nas': the NAS status panel (`/?tab=weather&section=nas`), which lists FAA programs at every
 *    airport, so a planned program or one at a non-hub airport (LGA) still has a place to go. Any
 *    3- or 4-letter airport code.
 *
 * Both addresses are the Weather tab's own deep links (`weatherScrollTarget`, src/lib/tab-hash.js),
 * so a click follows in place to the card or the panel, as a cold load of the address does.
 *
 * @param {unknown} code  the airport code as printed, any case.
 * @param {'weather' | 'nas'} kind  which status the code is printed with.
 * @returns {{code: string, href: string} | null}
 */
export function hubStatusLink(code, kind) {
  if (typeof code !== 'string') return null;
  const airport = code.trim().toUpperCase();
  if (kind === 'weather') return HUBS.has(airport) ? { code: airport, href: `/?tab=weather&hub=${airport}` } : null;
  if (kind === 'nas') return /^[A-Z]{3,4}$/.test(airport) ? { code: airport, href: NAS_STATUS_HREF } : null;
  return null;
}
