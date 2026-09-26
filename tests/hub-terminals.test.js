import { describe, it, expect } from 'vitest';
import { UNITED_HUB_TERMINALS, getUnitedTerminal } from '../src/lib/hub-terminals.js';

describe('UNITED_HUB_TERMINALS', () => {
  it('covers all nine hubs', () => {
    expect(Object.keys(UNITED_HUB_TERMINALS)).toEqual(['ORD', 'DEN', 'EWR', 'IAH', 'SFO', 'LAX', 'IAD', 'NRT', 'GUM']);
  });

  it('keeps the domestic/international split for the hubs that have one', () => {
    expect(UNITED_HUB_TERMINALS.IAH).toEqual({ domestic: 'C', international: 'E' });
    expect(UNITED_HUB_TERMINALS.SFO).toEqual({ domestic: '3', international: 'G' });
    expect(UNITED_HUB_TERMINALS.IAD).toEqual({ domestic: 'C', international: 'D' });
  });

  it('uses one terminal for both directions at the single-terminal hubs', () => {
    expect(UNITED_HUB_TERMINALS.ORD).toEqual({ domestic: '1', international: '1' });
    expect(UNITED_HUB_TERMINALS.DEN).toEqual({ domestic: 'B', international: 'B' });
    expect(UNITED_HUB_TERMINALS.GUM).toEqual({ domestic: '1', international: '1' });
  });
});

describe('getUnitedTerminal', () => {
  it('returns the domestic terminal for a domestic city pair', () => {
    expect(getUnitedTerminal('IAH', 'IAH', 'DEN')).toBe('C');
    expect(getUnitedTerminal('SFO', 'SFO', 'LAX')).toBe('3');
  });

  it('returns the international terminal when EITHER end of the route is international', () => {
    expect(getUnitedTerminal('IAH', 'IAH', 'LHR')).toBe('E');
    expect(getUnitedTerminal('IAD', 'FRA', 'IAD')).toBe('D');
    expect(getUnitedTerminal('SFO', 'SFO', 'NRT')).toBe('G');
  });

  it('returns the same letter either way at a single-terminal hub', () => {
    expect(getUnitedTerminal('ORD', 'ORD', 'DEN')).toBe('1');
    expect(getUnitedTerminal('ORD', 'ORD', 'LHR')).toBe('1');
  });

  it('returns an empty string for airports United does not hub at (edge case)', () => {
    expect(getUnitedTerminal('ATL', 'ATL', 'ORD')).toBe('');
    expect(getUnitedTerminal('', 'ORD', 'DEN')).toBe('');
    expect(getUnitedTerminal(undefined, 'ORD', 'DEN')).toBe('');
  });

  it('treats missing route endpoints as domestic (edge case)', () => {
    expect(getUnitedTerminal('IAH', undefined, undefined)).toBe('C');
    expect(getUnitedTerminal('SFO', '', '')).toBe('3');
  });
});
