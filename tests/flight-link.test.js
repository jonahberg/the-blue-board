import { describe, expect, it } from 'vitest';

import { flightLink } from '../src/lib/flight-link.js';

describe('flightLink: which printed flight numbers link to a flight page', () => {
  it('links a United flight number to /flight/<ident>', () => {
    expect(flightLink('UA576')).toEqual({ ident: 'UA576', href: '/flight/UA576' });
    expect(flightLink('UA2059')).toEqual({ ident: 'UA2059', href: '/flight/UA2059' });
  });

  it('reads the ICAO callsign and loose spellings as the same flight', () => {
    expect(flightLink('UAL576')?.href).toBe('/flight/UA576');
    expect(flightLink(' ua 576 ')?.href).toBe('/flight/UA576');
    expect(flightLink('UA0576')?.href).toBe('/flight/UA576');
  });

  it('does not link a provider letter suffix (the board prints UA526 for UA526H)', () => {
    expect(flightLink('UA526H')).toBeNull();
    expect(flightLink('UA526')?.href).toBe('/flight/UA526');
  });

  it('does not link an operating carrier callsign, which is not a United marketing number', () => {
    for (const callsign of ['SKW5123', 'RPA3508', 'OO4737', 'GJS4321', 'ASH5800']) {
      expect(flightLink(callsign), callsign).toBeNull();
    }
  });

  it('does not link a bare number, which does not say whose flight it is', () => {
    expect(flightLink('5123')).toBeNull();
  });

  it('does not link placeholders, empties or non-strings', () => {
    for (const value of ['—', '', '   ', '?', 'UA', 'UA0', 'UA12345', null, undefined, 576, ['UA576']]) {
      expect(flightLink(value), String(value)).toBeNull();
    }
  });
});
