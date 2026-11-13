/**
 * The row-model decisions behind the links on the My Flights tab and in the overlays
 * (src/lib/name-links.js): which piece of a printed string is the code that links, and which
 * provider type strings may decide a type link.
 */

import { describe, expect, it } from 'vitest';

import { FLEET_TYPE_SLUGS, fleetTypeCodeFor } from '../src/lib/fleet-type-link.js';
import {
  SPECIAL_VIEW_HREF,
  STARLINK_TAB_HREF,
  providerTypeText,
  routeEndLabel,
  routeEnds,
} from '../src/lib/name-links.js';

describe('routeEnds: the delay explanation\'s "ORD→DEN", split so each end can link', () => {
  it('splits the form both callers build (`${orig}→${dest}`)', () => {
    expect(routeEnds('ORD→DEN')).toEqual({ origin: 'ORD', destination: 'DEN' });
    expect(routeEnds('EUG→SFO')).toEqual({ origin: 'EUG', destination: 'SFO' });
  });

  it('keeps an end the caller had no code for as empty, as the string printed it', () => {
    expect(routeEnds('→DEN')).toEqual({ origin: '', destination: 'DEN' });
    expect(routeEnds('ORD→')).toEqual({ origin: 'ORD', destination: '' });
  });

  it('is null for anything that is not two codes joined by the arrow, so it prints as sent', () => {
    for (const text of ['', '→', 'ORD', 'ORD-DEN', 'ORD → DEN → SFO', 'Chicago→Denver', null, undefined, 42]) {
      expect(routeEnds(text)).toBeNull();
    }
  });
});

describe('routeEndLabel: one end of a My Flights card route', () => {
  it('prints the city with its code in brackets', () => {
    expect(routeEndLabel('ORD', 'Chicago')).toEqual({ city: 'Chicago', code: 'ORD' });
  });

  it('prints the code alone when there is no city name for it ("EUG", not "EUG (EUG)")', () => {
    expect(routeEndLabel('EUG', 'EUG')).toEqual({ city: '', code: 'EUG' });
    expect(routeEndLabel('EUG', '')).toEqual({ city: '', code: 'EUG' });
  });

  it('prints "?" for an end with no code', () => {
    expect(routeEndLabel('', 'Chicago')).toEqual({ city: 'Chicago', code: '?' });
    expect(routeEndLabel('', '')).toEqual({ city: '', code: '?' });
  });
});

describe('providerTypeText: a provider type string that may decide a type link with no tail', () => {
  it('passes a string that is exactly a fleet type code', () => {
    expect(providerTypeText('737-900ER')).toBe('737-900ER');
    expect(providerTypeText('A321neo')).toBe('A321neo');
    expect(providerTypeText('787-10')).toBe('787-10');
  });

  it('never an ICAO designator, even the two that are fleet type codes too (A319, A320)', () => {
    expect(providerTypeText('A319')).toBeNull();
    expect(providerTypeText('A320')).toBeNull();
    expect(providerTypeText('B739')).toBeNull();
    expect(providerTypeText('A21N')).toBeNull();
  });

  it('every fleet type code that is shaped like a designator is held back, and only those', () => {
    const designatorShaped = Object.keys(FLEET_TYPE_SLUGS).filter((code) => providerTypeText(code) === null);
    expect(designatorShaped.sort()).toEqual(['A319', 'A320']);
  });

  it('never clipped or spelled-out provider text, a regional type, or a non-string', () => {
    for (const text of ['Boeing 737-900', 'Boeing 737', '737-900er', 'E175', 'CRJ550', '', null, undefined]) {
      expect(providerTypeText(text)).toBeNull();
    }
  });

  it('with a tail, the tail still decides (fleetTypeCodeFor ignores the text)', () => {
    const fleetByReg = { N75436: { t: '737-900ER' } };
    expect(fleetTypeCodeFor({ reg: 'N75436', typeText: providerTypeText('A320'), fleetByReg })).toBe('737-900ER');
    expect(fleetTypeCodeFor({ reg: '', typeText: providerTypeText('A320'), fleetByReg })).toBeNull();
    expect(fleetTypeCodeFor({ reg: '', typeText: providerTypeText('737 MAX 9'), fleetByReg })).toBe('737 MAX 9');
  });
});

describe('badge addresses', () => {
  it('the Starlink tab and the Fleet special view, as addresses the dashboard follows in place', async () => {
    const { resolveDeepLink } = await import('../src/app/state/deep-links');
    expect(resolveDeepLink(STARLINK_TAB_HREF)).toMatchObject({ tab: 'starlink', aircraft: null, fleet: null });
    expect(resolveDeepLink(SPECIAL_VIEW_HREF)).toMatchObject({ tab: 'fleet', fleet: { filter: null, view: 'special' } });
  });
});
