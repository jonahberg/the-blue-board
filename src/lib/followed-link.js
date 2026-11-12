// ═══ A DASHBOARD LINK FOLLOWED IN PLACE: ITS ADDRESS AND ITS ANNOUNCEMENT ═══
// A link inside the dashboard (/?tab=schedule&hub=ORD) is followed without a reload
// (src/app/state/follow-link.tsx). When it changes the tab it leaves one history entry, so Back
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

/** The Fleet tab's sub-views as their tabs print them (FleetView). */
const FLEET_VIEW_NAMES = Object.freeze({ airborne: 'Airborne Now', special: 'Special', express: 'United Express' });

/**
 * What the page's polite region says after a followed link changes the tab: the tab's name as the
 * tab bar prints it, then the board or filter the link named. "Schedule, ORD"; "Fleet, 737 MAX 9";
 * "Delays · Weather · Hubs".
 *
 * @param {string} tabLabel  the destination tab's label (`TABS[].label` in src/app/tabs.ts).
 * @param {{scheduleHub?: string | null, fleet?: {filter: string | null, view: string | null} | null}} intent
 * @returns {string}
 */
export function followAnnouncement(tabLabel, intent) {
  const fleet = intent.fleet ?? null;
  const view = fleet?.view ? (FLEET_VIEW_NAMES[/** @type {keyof typeof FLEET_VIEW_NAMES} */ (fleet.view)] ?? null) : null;
  const detail = intent.scheduleHub || fleet?.filter || view;
  return detail ? `${tabLabel}, ${detail}` : tabLabel;
}
