import { describe, expect, it } from 'vitest';

import {
  EXPRESS_NUMBER_CHECK,
  EXPRESS_OPERATING_PREFIXES,
  flightLink,
  unitedNumber,
} from '../src/lib/flight-link.js';

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

describe('unitedNumber: the United number behind an Express operating number on a United row', () => {
  it.each([['SKW5415','UA5415'],['OO5506','UA5506'],['RPA3542','UA3542'],['YX3506','UA3506'],
           ['GJS4541','UA4541'],['G74612','UA4612'],['ASH3998','UA3998'],['YV4049','UA4049']])(
    '%s on a United row is %s', (printed, ua) => {
      expect(unitedNumber(printed, { airline: 'UA' })).toBe(ua);
      expect(flightLink(unitedNumber(printed, { airline: 'UA' }))).toEqual({ ident: ua, href: `/flight/${ua}` });
    });
  it.each([['SKW5415', {}], ['SKW5415', { airline: 'AA' }], ['UCA5004', { airline: 'UA' }],
           ['C55004', { airline: 'UA' }], ['5415', { airline: 'UA' }], ['SKW5415A', { airline: 'UA' }],
           ['UA576', { airline: 'UA' }], ['', { airline: 'UA' }], [null, { airline: 'UA' }]])(
    '%s with %o is not converted', (printed, row) => expect(unitedNumber(printed, row)).toBeNull());

  it('needs the row: no row, or a row not marked exactly UA, is not converted', () => {
    expect(unitedNumber('SKW5415')).toBeNull();
    expect(unitedNumber('SKW5415', null)).toBeNull();
    expect(unitedNumber('SKW5415', { airline: 'ua' })).toBeNull();
    expect(unitedNumber('SKW5415', { airline: 'UAL' })).toBeNull();
  });

  it('reads the printed number trimmed and in any case', () => {
    expect(unitedNumber(' skw5415 ', { airline: 'UA' })).toBe('UA5415');
    expect(unitedNumber('g74612', { airline: 'UA' })).toBe('UA4612');
  });

  it('gives the canonical ident flightLink uses: leading zeros dropped, an all-zero number refused', () => {
    expect(unitedNumber('SKW0415', { airline: 'UA' })).toBe('UA415');
    expect(flightLink(unitedNumber('SKW0415', { airline: 'UA' }))?.ident).toBe('UA415');
    expect(unitedNumber('SKW0', { airline: 'UA' })).toBeNull();
    expect(unitedNumber('SKW12345', { airline: 'UA' })).toBeNull();
  });

  it('leaves flightLink itself unchanged: a callsign passed straight in still has no page', () => {
    expect(flightLink('SKW5415')).toBeNull();
  });

  it('names exactly the tested operating prefixes, in a list nothing can change', () => {
    expect(EXPRESS_OPERATING_PREFIXES).toEqual(['SKW', 'OO', 'RPA', 'YX', 'GJS', 'G7', 'ASH', 'YV']);
    expect(Object.isFrozen(EXPRESS_OPERATING_PREFIXES)).toBe(true);
  });
});

// The check behind the rule, kept as data: 2026-11-12, flight_history joined on route and time.
it('records the sample that justified the rule', () => {
  expect(EXPRESS_NUMBER_CHECK).toMatchObject({ date: '2026-11-12', matched: 124, sameNumber: 124, sampled: 125 });
});
