// ═══ A DASHBOARD LINK FOLLOWED IN PLACE: ITS ADDRESS AND ITS ANNOUNCEMENT ═══
// A link inside the dashboard (/?tab=schedule&hub=ORD) is followed without a reload
// (src/app/state/follow-link.ts). When it changes the tab it leaves one history entry, so Back
// returns to the tab the reader was on, and it says where it went through the page's one polite
// region. The two pure halves of that live here.
//
// DOM-free; tested in tests/followed-link.test.js.

/**
 * Query parameters that name a destination inside the dashboard. A cold load acts on each of them
 * (`useDeepLinks`, and the Fleet and Live views' own reads); anything else in the query (utm_*)
 * names nothing in the dashboard.
 */
export const DEEP_LINK_PARAMS = Object.freeze([
  'tab',
  'hub',
  'section',
  'flight',
  'q',
  'aircraft',
  'view',
  'filter',
  'type',
  'waitlist',
  'watch',
]);

/**
 * The address a followed link leaves in the history: the path, the query without the dashboard's
 * own deep-link parameters (the old ones would outrank the hash on a reload), every other
 * parameter kept, and the new tab's hash.
 *
 * @param {{pathname: string, search: string}} loc  the address the link was followed from.
 * @param {string} hash  the destination tab's hash, with its '#' ('#schedule').
 * @returns {string}
 */
export function addressAfterFollow({ pathname, search }, hash) {
  const params = new URLSearchParams(search);
  for (const key of DEEP_LINK_PARAMS) params.delete(key);
  const query = params.toString();
  return `${pathname}${query ? `?${query}` : ''}${hash}`;
}
