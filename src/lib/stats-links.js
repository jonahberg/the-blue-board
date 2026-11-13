// ═══ STATS TAB: WHICH HEADLINE CARD LINKS WHERE ═══
// A headline card links only when the destination lists exactly what the card counts (links
// everywhere, part 2):
//   - "Flights Airborne" counts the feed's airborne flights, which the Live tab shows;
//   - "Fleet Utilization · N of M mainline aircraft" counts the airborne flights matched to the
//     fleet database (`fleetUtilization`). The Fleet tab's Airborne view is where those aircraft are
//     listed: its sub-tab count is this card's N, and its rows are the feed's flights in the air
//     matched to the fleet database (`buildAirborneRows`, src/lib/fleet-view.js).
// "Avg Fleet Age" and "Starlink Coverage · N of M airborne" have no list of exactly that set, so
// they stay text. Both addresses are the dashboard's own and are followed in place
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
