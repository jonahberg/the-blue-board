// ═══ FLEET TYPE PAGES — WHAT A REGISTRY ROW LINKS TO ═══
// The /fleet/{type} registry lists every aircraft of the type (about 1,150 rows across 19 pages).
// Links everywhere (Nov 2026; spec docs/superpowers/specs/2026-11-12-links-everywhere-design.md):
//   - the registration → the dashboard's aircraft dialog (`tailLink`, /?aircraft=N12345). A tail
//     has no page of its own, so the content side crosses to the dashboard. Link colour: the row
//     is about the tail.
//   - "Starlink" in the Wi-Fi column → the dashboard's Starlink tab (/#starlink, from
//     ./starlink-link.js), where the roster lists the aircraft (the spec's "Starlink or Wi-Fi
//     badge on a row"). Body colour with a quiet underline, in Starlink violet as everywhere.
//   - every other cell (fleet number, config, IFE, power, year, status) names nothing with a home
//     and stays text.
//
// DOM-free; tested in tests/fleet-registry-links.test.js.

import { STARLINK_TAB_HREF } from './starlink-link.js';
import { tailLink } from './tail-link.js';

/** The fleet database's Wi-Fi field says Starlink ('Starlink', 'starlink'). */
export function isStarlinkWifi(wifi) {
  return String(wifi ?? '').toLowerCase().includes('starlink');
}

/**
 * Where a registry row's names link, or null where they print as text.
 *
 * @param {{r?: string, w?: string}} ac  a fleet database row.
 * @returns {{reg: string|null, wifi: string|null}}
 */
export function registryRowLinks(ac) {
  return {
    reg: tailLink(ac?.r)?.href ?? null,
    wifi: isStarlinkWifi(ac?.w) ? STARLINK_TAB_HREF : null,
  };
}
