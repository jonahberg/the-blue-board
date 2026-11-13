// @ts-check
// ═══ CONTENT PAGES — WHERE "THE FAA'S STATUS" LINKS ═══
// Links everywhere (Nov 2026): a content page line about FAA programs and ground stops (Newark's
// program line, /hubs "Ground stops & FAA alerts") links to the dashboard's Delays · Weather tab,
// landed on its NAS status panel, which lists every FAA program in force. The dashboard resolves
// the address with src/lib/tab-hash.js `weatherScrollTarget` ('nas-section').
//
// One named place for an address the pages used to type by hand. It moves to `hubStatusLink(code,
// 'nas')` in ./hub-link.js when the dashboard links branch (part 2) merges, and this file goes.
//
// DOM-free; tested in tests/nas-status-link.test.js.

/** The dashboard's NAS status panel, on the Delays · Weather tab. */
export const NAS_STATUS_HREF = '/?tab=weather&section=nas';
