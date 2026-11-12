// ═══ TAIL → AIRCRAFT DIALOG ═══
// A printed registration links to the dashboard's aircraft dialog (/?aircraft=N12345), from either
// side of the site; there are no pages for single tails.
//
// This reads the format only: a US registration, N then a non-zero digit then one to four digits
// or letters, after upper-casing and removing a hyphen ("n78501", "N-613UX"). Whether the fleet
// database or the Starlink roster knows the tail is the caller's question.
//
// DOM-free; tested in tests/tail-link.test.js.

const US_REGISTRATION_RE = /^N[1-9][0-9A-Z]{1,4}$/;

/**
 * Where a printed registration links, or null when it is not a US registration.
 *
 * @param {unknown} reg  the registration as printed.
 * @returns {{reg: string, href: string} | null}  `reg` is the canonical form, e.g. 'N613UX'.
 */
export function tailLink(reg) {
  if (typeof reg !== 'string') return null;
  const tail = reg.trim().toUpperCase().replace('-', '');
  if (!US_REGISTRATION_RE.test(tail)) return null;
  return { reg: tail, href: `/?aircraft=${tail}` };
}
