import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { fleetTypes } from '../src/data/fleet/index.js'; // the TEST may import it; the lib may not
import { FLEET_TYPE_SLUGS, fleetTypeCodeFor, fleetTypeCodeForTail, fleetTypeLink } from '../src/lib/fleet-type-link.js';

describe('FLEET_TYPE_SLUGS: the fleet database type code behind each fleet page', () => {
  it('is exactly the inversion of the fleet pages', () => {
    expect(FLEET_TYPE_SLUGS).toEqual(Object.fromEntries(Object.entries(fleetTypes).map(([slug, d]) => [d.typeCode, slug])));
  });

  it('cannot be changed at runtime', () => {
    expect(Object.isFrozen(FLEET_TYPE_SLUGS)).toBe(true);
  });

  it('the lib does not import the fleet page data', () =>
    expect(readFileSync('src/lib/fleet-type-link.js', 'utf8')).not.toMatch(/data\/fleet/));
});

describe('fleetTypeLink: which printed type codes link, and where', () => {
  it('links a fleet database type code to its fleet page on the site and the Fleet tab on the dashboard', () => {
    expect(fleetTypeLink('737 MAX 9', 'site')).toEqual({ typeCode: '737 MAX 9', slug: '737-max-9', href: '/fleet/737-max-9' });
    expect(fleetTypeLink('737 MAX 9', 'dashboard').href).toBe('/?tab=fleet&type=737%20MAX%209');
  });

  it('links every one of the 19 types on both sides', () => {
    for (const [typeCode, slug] of Object.entries(FLEET_TYPE_SLUGS)) {
      expect(fleetTypeLink(typeCode, 'site'), typeCode).toEqual({ typeCode, slug, href: `/fleet/${slug}` });
      expect(fleetTypeLink(typeCode, 'dashboard'), typeCode).toEqual({
        typeCode,
        slug,
        href: `/?tab=fleet&type=${encodeURIComponent(typeCode)}`,
      });
    }
  });

  it('does not link ICAO codes, regional types, clipped provider text or empties', () => {
    for (const bad of ['B739', 'ERJ-175', 'E175SC', 'CRJ-550', '777-224(ER)', 'Boeing 737', '', null]) {
      expect(fleetTypeLink(bad, 'site'), String(bad)).toBeNull();
    }
  });

  it('matches the type code exactly, and never an inherited property name', () => {
    for (const bad of ['737 max 9', 'a321NEO', 'constructor', 'toString', '__proto__', 'hasOwnProperty', 42]) {
      expect(fleetTypeLink(bad, 'site'), String(bad)).toBeNull();
    }
  });

  it('gives no address for a side it does not know, rather than guessing one', () => {
    expect(fleetTypeLink('737 MAX 9', 'Site')).toBeNull();
    expect(fleetTypeLink('737 MAX 9', undefined)).toBeNull();
  });
});

describe('fleetTypeCodeForTail: the type a tail links to comes from the fleet database', () => {
  it('reads the database type for a tail it knows', () => {
    expect(fleetTypeCodeForTail('N75436', { N75436: { t: '737-900ER' } })).toBe('737-900ER');
  });

  it('finds the tail however the registration was printed', () => {
    expect(fleetTypeCodeForTail('n-75436', { N75436: { t: '737-900ER' } })).toBe('737-900ER');
  });

  it('has no type for a tail the database does not know, or with no database yet', () => {
    expect(fleetTypeCodeForTail('N613UX', { N75436: { t: '737-900ER' } })).toBeNull();
    expect(fleetTypeCodeForTail('N75436', null)).toBeNull();
    expect(fleetTypeCodeForTail('N75436', undefined)).toBeNull();
  });

  it('has no type when the database entry has none, or names a type with no fleet page', () => {
    expect(fleetTypeCodeForTail('N75436', { N75436: {} })).toBeNull();
    expect(fleetTypeCodeForTail('N75436', { N75436: null })).toBeNull();
    expect(fleetTypeCodeForTail('N613UX', { N613UX: { t: 'E175' } })).toBeNull();
    expect(fleetTypeCodeForTail('N75436', { N75436: { t: 'constructor' } })).toBeNull();
  });

  it('has no type for a value that is not a registration', () => {
    for (const bad of ['UA576', '', null, 42]) {
      expect(fleetTypeCodeForTail(bad, { N75436: { t: '737-900ER' } }), String(bad)).toBeNull();
    }
  });
});

describe('fleetTypeCodeFor: a row with a tail by the tail only; a row without one by an exact type string', () => {
  const fleetByReg = { N75436: { t: '737-900ER' }, N37502: { t: '737 MAX 9' }, N999XX: { t: '737-600' } };

  it('a tail the database knows decides, whatever the row prints', () => {
    expect(fleetTypeCodeFor({ reg: 'N75436', typeText: '737-900', fleetByReg })).toBe('737-900ER');
    expect(fleetTypeCodeFor({ reg: 'n-75436', typeText: 'B739', fleetByReg })).toBe('737-900ER');
    expect(fleetTypeCodeFor({ reg: 'N37502', fleetByReg })).toBe('737 MAX 9');
  });

  it('a row with a tail never reads its printed text: null while the database loads or after it failed', () => {
    for (const db of [null, undefined, {}]) {
      expect(fleetTypeCodeFor({ reg: 'N75436', typeText: '737-900', fleetByReg: db }), JSON.stringify(db)).toBeNull();
    }
  });

  it('a row with a tail the database does not know, or whose type has no fleet page, is null', () => {
    expect(fleetTypeCodeFor({ reg: 'N613UX', typeText: 'A321neo', fleetByReg })).toBeNull();
    expect(fleetTypeCodeFor({ reg: 'N999XX', typeText: '737-700', fleetByReg })).toBeNull();
  });

  it('a row with no tail links an exact fleet database type string', () => {
    expect(fleetTypeCodeFor({ typeText: '737 MAX 9', fleetByReg })).toBe('737 MAX 9');
    expect(fleetTypeCodeFor({ reg: null, typeText: '787-10', fleetByReg: null })).toBe('787-10');
    // A value that is not a registration is no tail.
    expect(fleetTypeCodeFor({ reg: 'UA576', typeText: 'A319', fleetByReg })).toBe('A319');
  });

  it('without a tail, clipped or differently written text, regional types and most ICAO codes are null', () => {
    for (const text of ['B739', 'B772', 'B38M', 'Boeing 737', '737 max 9', '737-900 ', 'E175', 'CRJ-550', 'A320neo', '', null, 42]) {
      expect(fleetTypeCodeFor({ typeText: text, fleetByReg }), String(text)).toBeNull();
    }
    // A319 and A320 are ICAO codes and fleet type codes at once: why typeText must never be an acType.
    expect(fleetTypeCodeFor({ typeText: 'A319' })).toBe('A319');
    expect(fleetTypeCodeFor({ typeText: 'A320' })).toBe('A320');
    expect(fleetTypeCodeFor()).toBeNull();
  });

  it('every value it returns has a fleet page and a Fleet tab link', () => {
    for (const typeText of Object.keys(FLEET_TYPE_SLUGS)) {
      const code = fleetTypeCodeFor({ typeText });
      expect(code, typeText).toBe(typeText);
      expect(fleetTypeLink(code, 'dashboard')?.href, typeText).toBe(`/?tab=fleet&type=${encodeURIComponent(typeText)}`);
    }
  });
});
