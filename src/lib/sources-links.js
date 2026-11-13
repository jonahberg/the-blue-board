// ═══ SOURCES TAB: WHICH SOURCE CARD NAMES A DASHBOARD VIEW ═══
// A Sources card's name links to the dashboard view that shows that source's data (links
// everywhere, part 2; the spec's "A Sources card that names a dashboard view | that tab"):
// Flightradar24's positions are the Live tab, AeroDataBox's boards the Schedule tab, the fleet
// database the Fleet tab, the Starlink tracker the Starlink tab, AWC's observations and the NEXRAD
// radar the Weather tab, and the FAA's NAS status the Weather tab's NAS panel. The basemap, the
// route estimate and the subreddit have no view of their own, so their names stay text.
//
// Keyed by the card's printed name (src/app/views/SourcesView.tsx); a renamed card with no entry
// here prints a plain name, which tests/sources-view-links.test.tsx catches. Every address is the
// dashboard's own and is followed in place (`resolveDeepLink`).
//
// DOM-free; tested in tests/sources-links.test.ts.

import { NAS_STATUS_HREF } from './hub-link.js';
import { STARLINK_TAB_HREF } from './starlink-link.js';
import { FLEET_TAB_HREF, LIVE_TAB_HREF, SCHEDULE_TAB_HREF, WEATHER_TAB_HREF } from './tab-links.js';

/**
 * `where` is said to a screen reader after the name, so the link's name says where it goes.
 *
 * @type {Readonly<Record<string, Readonly<{href: string, where: string}>>>}
 */
export const SOURCE_VIEW_LINKS = Object.freeze({
  'Live Flight Positions — Flightradar24': Object.freeze({ href: LIVE_TAB_HREF, where: 'Live tab' }),
  'Flight Schedule — AeroDataBox': Object.freeze({ href: SCHEDULE_TAB_HREF, where: 'Schedule tab' }),
  'Fleet Database — United Fleet Site': Object.freeze({ href: FLEET_TAB_HREF, where: 'Fleet tab' }),
  'Starlink Tracker — @martinamps': Object.freeze({ href: STARLINK_TAB_HREF, where: 'Starlink tab' }),
  'Aviation Weather — AWC': Object.freeze({ href: WEATHER_TAB_HREF, where: 'Weather tab' }),
  'NEXRAD Radar — Iowa State / NWS': Object.freeze({ href: WEATHER_TAB_HREF, where: 'Weather tab' }),
  'NAS Status — FAA': Object.freeze({ href: NAS_STATUS_HREF, where: 'Weather tab, NAS status' }),
});

/**
 * The view a source card's name links to, or null when no view shows that source.
 *
 * @param {unknown} name  the card's printed name.
 * @returns {Readonly<{href: string, where: string}> | null}
 */
export function sourceViewLink(name) {
  if (typeof name !== 'string' || !Object.hasOwn(SOURCE_VIEW_LINKS, name)) return null;
  return SOURCE_VIEW_LINKS[name];
}
