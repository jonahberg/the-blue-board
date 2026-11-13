// @ts-check
// ═══ CONTENT PAGES — WHERE A STARLINK FACT LINKS ═══
// Links everywhere (Nov 2026; spec docs/superpowers/specs/2026-11-12-links-everywhere-design.md,
// "Starlink or Wi-Fi badge on a row"): on a content page, "Starlink" printed on a row (a fleet
// registry's Wi-Fi cell, a flight page's "Starlink Wi-Fi") goes to the dashboard's Starlink tab,
// whose roster lists every equipped aircraft. The content pages have no Starlink page of their own,
// so the link crosses to the dashboard. The /fleet FAQ's "Starlink Tracker" goes there too.
//
// DOM-free; tested in tests/starlink-link.test.js.

/** The dashboard's Starlink tab: the home of a Starlink fact on a content page. */
export const STARLINK_TAB_HREF = '/#starlink';
