// @ts-check
// ═══ WHERE A STARLINK FACT LINKS ═══
// Links everywhere (Nov 2026; spec docs/superpowers/specs/2026-11-12-links-everywhere-design.md,
// "Starlink or Wi-Fi badge on a row"): "Starlink" printed on a row goes to the dashboard's
// Starlink tab, whose roster lists every equipped aircraft. On a content page (a fleet registry's
// Wi-Fi cell, a flight page's "Starlink Wi-Fi", the /fleet FAQ's "Starlink Tracker") the link
// crosses to the dashboard, since those pages have no Starlink page of their own; inside the
// dashboard it opens the tab in place (a Schedule row's ⚡ Starlink, a Fleet row's SL mark, the
// Starlink badges in My Flights and the overlays, the Sources card, the brief's chip). The one
// place the address is written.
//
// DOM-free; tested in tests/starlink-link.test.js.

/** The dashboard's Starlink tab: the home of a Starlink fact, on either side of the site. */
export const STARLINK_TAB_HREF = '/#starlink';
