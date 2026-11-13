// ═══ AIRCRAFT TYPE → FLEET PAGE OR FLEET TAB ═══
// A printed aircraft type links to its home on the side of the site the reader is on: inside the
// dashboard the Fleet tab filtered to that type (/?tab=fleet&type=737%20MAX%209); on a content
// page its fleet page (/fleet/737-max-9).
//
// Which types link:
//   - where the row has a tail, the type comes from the fleet database's `t` for that tail
//     (`fleetTypeCodeForTail`), never the printed string: the Starlink tracker lists N75436 as
//     "737-900" and the fleet database says 737-900ER;
//   - otherwise (a row with no tail) the printed string must equal one of the 19 fleet database
//     type codes exactly.
// Clipped provider text ("Boeing 737") and regional types print plain, and so do most ICAO codes
// (B739 is both the 737-900 and the 737-900ER). Not all: A319 and A320 are ICAO designators AND
// fleet database type codes. So the rule for callers is that a printed type passed in comes only
// from a fleet database string, never from a feed's `acType`.
//
// The map is written out here rather than read from the fleet pages' data module, which carries
// every fleet page's HTML and would land in the dashboard bundle. tests/fleet-type-link.test.js
// checks it is exactly the inversion of those pages.
//
// DOM-free; tested in tests/fleet-type-link.test.js.

import { tailLink } from './tail-link.js';

/** The fleet database's type code (`t`) → the slug of its fleet page. */
export const FLEET_TYPE_SLUGS = Object.freeze({
  '737-700': '737-700', '737-800': '737-800', '737-900': '737-900', '737-900ER': '737-900er',
  '737 MAX 8': '737-max-8', '737 MAX 9': '737-max-9',
  '757-200': '757-200', '757-300': '757-300', '767-300ER': '767-300er', '767-400ER': '767-400er',
  '777-200': '777-200', '777-200ER': '777-200er', '777-300ER': '777-300er',
  '787-8': '787-8-dreamliner', '787-9': '787-9-dreamliner', '787-10': '787-10-dreamliner',
  A319: 'a319', A320: 'a320', A321neo: 'a321neo',
});

/**
 * Where a fleet database type code links, or null when it has no fleet page.
 *
 * @param {unknown} typeCode  a fleet database type code, matched exactly ('737 MAX 9').
 * @param {'dashboard' | 'site'} side  the side of the site the link is printed on.
 * @returns {{typeCode: string, slug: string, href: string} | null}
 */
export function fleetTypeLink(typeCode, side) {
  if (typeof typeCode !== 'string' || !Object.hasOwn(FLEET_TYPE_SLUGS, typeCode)) return null;
  const slug = FLEET_TYPE_SLUGS[typeCode];
  if (side === 'dashboard') return { typeCode, slug, href: `/?tab=fleet&type=${encodeURIComponent(typeCode)}` };
  if (side === 'site') return { typeCode, slug, href: `/fleet/${slug}` };
  return null;
}

/**
 * The fleet database's type for a tail, when that type has a fleet page; null for a tail the
 * database does not know (every Express tail, a new delivery) or before it has loaded.
 *
 * @param {unknown} reg  the registration as printed.
 * @param {Record<string, {t?: string}> | null | undefined} fleetByReg  the fleet database by registration.
 * @returns {string | null}  a key of FLEET_TYPE_SLUGS, e.g. '737-900ER'.
 */
export function fleetTypeCodeForTail(reg, fleetByReg) {
  const tail = tailLink(reg)?.reg;
  if (!tail || !fleetByReg || !Object.hasOwn(fleetByReg, tail)) return null;
  const typeCode = fleetByReg[tail]?.t;
  return typeof typeCode === 'string' && Object.hasOwn(FLEET_TYPE_SLUGS, typeCode) ? typeCode : null;
}

/**
 * The type a row links to, by the rule above in one call.
 *
 *  - A row with a tail (`reg` a US registration): the tail decides, and only the tail
 *    (`fleetTypeCodeForTail`). Null while the fleet database is loading or after it failed, for a
 *    tail it does not know, and for a type with no fleet page; the printed text is never read, so
 *    N75436's "737-900" never links as the 737-900 while the database that says 737-900ER loads.
 *  - A row with no tail: the printed type text, only when it is exactly one of the fleet
 *    database's type codes.
 *
 * `typeText` must come from a fleet database string, never a feed's `acType`: A319 and A320 are
 * ICAO codes and fleet type codes at once, so an `acType` would link those two rows and not the
 * B739 beside them. Clipped provider text ("Boeing 737") and regional types are null.
 *
 * @param {{reg?: unknown, typeText?: unknown, fleetByReg?: Record<string, {t?: string}> | null}} row
 * @returns {string | null}  a key of FLEET_TYPE_SLUGS, e.g. '737-900ER'.
 */
export function fleetTypeCodeFor({ reg, typeText, fleetByReg } = {}) {
  if (tailLink(reg)) return fleetTypeCodeForTail(reg, fleetByReg);
  return typeof typeText === 'string' && Object.hasOwn(FLEET_TYPE_SLUGS, typeText) ? typeText : null;
}
