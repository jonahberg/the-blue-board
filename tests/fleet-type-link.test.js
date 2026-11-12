import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { fleetTypes } from '../src/data/fleet/index.js'; // the TEST may import it; the lib may not
import { FLEET_TYPE_SLUGS, fleetTypeCodeForTail, fleetTypeLink } from '../src/lib/fleet-type-link.js';

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
