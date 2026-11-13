// ═══ STATS TAB: WHICH HEADLINE CARD LINKS WHERE ═══
// A headline card links to the view that shows what it counts (links everywhere, part 2):
//   - "Fleet Utilization · N of M mainline aircraft" counts the airborne flights matched to the
//     fleet database (`fleetUtilization`). The Fleet tab's Airborne view lists exactly those: its
//     sub-tab count is this card's N, and its rows are the feed's flights in the air matched to the
//     fleet database (`buildAirborneRows`, src/lib/fleet-view.js), under the same on-the-ground
//     rule, with the tab's type and search filters cleared by the link.
//   - "Flights Airborne" counts the feed's airborne flights. It opens the Live tab, the view those
//     flights are on: its map plots them, but beside aircraft on the ground and under whatever hub
//     or phase filter the reader left there, so it is not a list of exactly that set.
// "Avg Fleet Age" and "Starlink Coverage · N of M airborne" have no view of their own, so they
// stay text. Both addresses are the dashboard's own and are followed in place
// (`resolveDeepLink`, src/app/state/deep-links.ts).
//
// DOM-free; tested in tests/stats-links.test.ts.

import { FLEET_AIRBORNE_HREF, LIVE_TAB_HREF } from './tab-links.js';

/**
 * The linked cards, by their printed label. `where` is said to a screen reader after the label,
 * so the link's name says where it goes.
 *
 * @type {Readonly<Record<string, Readonly<{href: string, where: string}>>>}
 */
export const STATS_METRIC_LINKS = Object.freeze({
  'Flights Airborne': Object.freeze({ href: LIVE_TAB_HREF, where: 'Live tab' }),
  'Fleet Utilization': Object.freeze({ href: FLEET_AIRBORNE_HREF, where: 'Fleet tab, Airborne' }),
});

/** What a card prints before its data has answered. */
const NO_FIGURE = new Set(['', '—']);

/**
 * The link for a headline card, or null when it stays text: a card with no list of exactly its
 * set, or one with no figure yet.
 *
 * @param {unknown} label  the card's printed label.
 * @param {unknown} value  the card's printed figure.
 * @returns {Readonly<{href: string, where: string}> | null}
 */
export function metricLink(label, value) {
  if (typeof label !== 'string' || !Object.hasOwn(STATS_METRIC_LINKS, label)) return null;
  if (typeof value !== 'string' || NO_FIGURE.has(value.trim())) return null;
  return STATS_METRIC_LINKS[label];
}
