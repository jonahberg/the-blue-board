// @ts-check
// ═══ TRACKER PAGES → THEIR ENTRIES AND THE HUB PAGES ═══
// Links everywhere (Nov 12 2026): on the tracker pages, a hub named as a hub links to its hub page
// (`/hubs/ord`, through `hubLink(code, 'site')`), and a tracker entry links to its own place: a
// hub tower's ATC page (`/trackers/atc/ord`), a hub's construction page
// (`/trackers/united-hubs/iah`), a project's card on that page (`…/iah#iah-club-b-north`). The
// pages and components build their links from here, never from `src/data/trackers/*`, whose
// objects also feed the CSV and JSON downloads.
//
// DOM-free; tested in tests/tracker-links.test.js.

import { hubLink } from './hub-link.js';

/** A three-letter code, lower-cased for a path, or '' when it is not one. */
const pathCode = (/** @type {unknown} */ code) => {
  const c = String(code ?? '').trim().toLowerCase();
  return /^[a-z]{3}$/.test(c) ? c : '';
};

/**
 * A hub tower's page on the ATC tracker ('/trackers/atc/ord'), or null. Only the United hubs in the
 * FAA program have one; the caller passes that set (`atcHubDetailCodes`).
 *
 * @param {unknown} code
 * @param {Iterable<string>} hubTowerCodes
 * @returns {string | null}
 */
export function atcEntryHref(code, hubTowerCodes) {
  const c = pathCode(code);
  return c && new Set(hubTowerCodes).has(c.toUpperCase()) ? `/trackers/atc/${c}` : null;
}

/**
 * A hub's page on the United hub tracker ('/trackers/united-hubs/iah'), or null when the tracker
 * has no page for that code (`unitedHubDetailCodes`).
 *
 * @param {unknown} code
 * @param {Iterable<string>} trackedHubCodes
 * @returns {string | null}
 */
export function unitedHubEntryHref(code, trackedHubCodes) {
  const c = pathCode(code);
  return c && new Set(trackedHubCodes).has(c.toUpperCase()) ? `/trackers/united-hubs/${c}` : null;
}

/**
 * A construction project's card on its hub's tracker page ('/trackers/united-hubs/iah#iah-club-b-north').
 *
 * @param {{hub?: unknown, id?: unknown} | null | undefined} project
 * @returns {string | null}
 */
export function projectEntryHref(project) {
  const hub = pathCode(project?.hub);
  const id = String(project?.id ?? '').trim();
  return hub && /^[a-z0-9-]+$/.test(id) ? `/trackers/united-hubs/${hub}#${id}` : null;
}

/**
 * The links a tracker map prints for a place it lists "Beyond the map" (Guam): for a United hub,
 * its own entry on this tracker (in link colour) and then its hub page (quiet, worded as the
 * dashboard's door, "ORD hub guide"). Any other airport gets none: its home is its row in the table
 * under the map. The marker cards print none (src/components/trackers/TrackerMap.astro).
 *
 * @param {unknown} code
 * @param {string | null} entryHref  this tracker's page for the hub, or null when it has none.
 * @param {string} entryText  the entry link's words ("ORD status →", "IAH projects →").
 * @returns {{href: string, text: string, tone: 'entry' | 'quiet'}[]}
 */
export function mapPlaceLinks(code, entryHref, entryText) {
  const hub = hubLink(code, 'site');
  if (!hub) return [];
  const links = /** @type {{href: string, text: string, tone: 'entry' | 'quiet'}[]} */ ([]);
  if (entryHref) links.push({ href: entryHref, text: entryText, tone: 'entry' });
  links.push({ href: hub.href, text: `${hub.code} hub guide`, tone: 'quiet' });
  return links;
}
