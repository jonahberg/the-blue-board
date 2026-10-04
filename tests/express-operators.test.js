import { describe, expect, it } from 'vitest';

import {
  flightAwareIdent,
  UNITED_OPERATORS,
  isExpressFlight,
  operatedByLine,
  operatorFromCallsign,
} from '../src/lib/express-operators.js';

describe('operatorFromCallsign', () => {
  it('names every United Express operator seen in the live feed (Oct 4 2026 sample)', () => {
    expect(operatorFromCallsign('SKW5123')).toEqual({ code: 'SKW', name: 'SkyWest Airlines', express: true });
    expect(operatorFromCallsign('RPA3401')).toEqual({ code: 'RPA', name: 'Republic Airways', express: true });
    expect(operatorFromCallsign('GJS3375')).toEqual({ code: 'GJS', name: 'GoJet Airlines', express: true });
    expect(operatorFromCallsign('UCA4321')).toEqual({ code: 'UCA', name: 'CommutAir', express: true });
    expect(operatorFromCallsign('ASH6011')).toEqual({ code: 'ASH', name: 'Mesa Airlines', express: true });
    expect(operatorFromCallsign('AWI3890')).toEqual({ code: 'AWI', name: 'Air Wisconsin', express: true });
  });

  it('reads a UAL callsign as mainline United', () => {
    expect(operatorFromCallsign('UAL1')).toEqual({ code: 'UAL', name: 'United Airlines', express: false });
    expect(operatorFromCallsign('UAL2287')?.express).toBe(false);
  });

  it('tolerates case and whitespace', () => {
    expect(operatorFromCallsign(' skw5123 ')?.code).toBe('SKW');
  });

  it('returns null — never a guess — for an unknown prefix (edge case)', () => {
    expect(operatorFromCallsign('DAL123')).toBeNull();
    expect(operatorFromCallsign('ASQ4100')).toBeNull(); // ExpressJet, retired
    expect(operatorFromCallsign('ENY3000')).toBeNull();
  });

  it('returns null for blank, malformed or non-string input (edge case)', () => {
    expect(operatorFromCallsign('')).toBeNull();
    expect(operatorFromCallsign(null)).toBeNull();
    expect(operatorFromCallsign(undefined)).toBeNull();
    expect(operatorFromCallsign('SKW')).toBeNull();
    expect(operatorFromCallsign('N12345')).toBeNull();
    expect(operatorFromCallsign('G73375')).toBeNull(); // an IATA flight number is not a callsign
    expect(operatorFromCallsign(42)).toBeNull();
  });

  it('does not resolve inherited object keys as operators (edge case)', () => {
    expect(operatorFromCallsign('PRO1')).toBeNull();
    expect(Object.keys(UNITED_OPERATORS)).not.toContain('__proto__');
  });
});

describe('isExpressFlight', () => {
  it('goes by the callsign, not the always-UAL airline field', () => {
    expect(isExpressFlight({ callsign: 'SKW5123', airline: 'UAL', flightIATA: 'UA5123' })).toBe(true);
    expect(isExpressFlight({ callsign: 'GJS3375', airline: 'UAL', flightIATA: 'G73375' })).toBe(true);
    expect(isExpressFlight({ callsign: 'UAL60', airline: 'UAL', flightIATA: 'UA60' })).toBe(false);
  });

  it('is false for an unknown or missing callsign (edge case)', () => {
    expect(isExpressFlight({ callsign: '' })).toBe(false);
    expect(isExpressFlight({ callsign: 'XYZ1' })).toBe(false);
    expect(isExpressFlight({})).toBe(false);
    expect(isExpressFlight(null)).toBe(false);
    expect(isExpressFlight(undefined)).toBe(false);
  });
});

describe('operatedByLine', () => {
  it('names the Express operator and the brand', () => {
    expect(operatedByLine({ callsign: 'SKW5123' })).toBe('Operated by SkyWest Airlines (United Express)');
    expect(operatedByLine({ callsign: 'GJS3375' })).toBe('Operated by GoJet Airlines (United Express)');
  });

  it('says United Airlines for mainline', () => {
    expect(operatedByLine({ callsign: 'UAL60' })).toBe('Operated by United Airlines');
  });

  it('says nothing when the operator is unknown (edge case)', () => {
    expect(operatedByLine({ callsign: '' })).toBeNull();
    expect(operatedByLine({ callsign: 'DAL1' })).toBeNull();
    expect(operatedByLine(null)).toBeNull();
  });
});

describe('flightAwareIdent', () => {
  it('tracks an Express flight under its operator callsign (GoJet rows read G73375)', () => {
    expect(flightAwareIdent('G73375', 'GJS3375')).toBe('GJS3375');
    expect(flightAwareIdent('UA4672', ' skw4672 ')).toBe('SKW4672');
  });

  it('keeps UAL + number for mainline, whether the ident is an IATA number or a callsign', () => {
    expect(flightAwareIdent('UA123', 'UAL123')).toBe('UAL123');
    expect(flightAwareIdent('UAL123', undefined)).toBe('UAL123');
    expect(flightAwareIdent('UA1', null)).toBe('UAL1');
  });
});
