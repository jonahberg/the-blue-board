import { describe, it, expect } from 'vitest';
import { UNITED_HUBS, UNITED_HUB_SET, UNITED_HUB_TERMINALS, getHubTerminal } from '../api/_hubs.js';

describe('_hubs shared constants', () => {
  it('lists exactly the 9 United hubs', () => {
    expect([...UNITED_HUBS].sort()).toEqual(['DEN', 'EWR', 'GUM', 'IAD', 'IAH', 'LAX', 'NRT', 'ORD', 'SFO']);
  });

  it('UNITED_HUB_SET matches the hub list and excludes non-hubs', () => {
    for (const hub of UNITED_HUBS) expect(UNITED_HUB_SET.has(hub)).toBe(true);
    expect(UNITED_HUB_SET.has('JFK')).toBe(false);
    expect(UNITED_HUB_SET.has('ATL')).toBe(false);
  });

  it('has a terminal assignment for every hub', () => {
    for (const hub of UNITED_HUBS) {
      expect(UNITED_HUB_TERMINALS[hub]).toBeDefined();
      expect(UNITED_HUB_TERMINALS[hub].domestic).toBeTruthy();
      expect(UNITED_HUB_TERMINALS[hub].international).toBeTruthy();
    }
  });

  it('getHubTerminal resolves domestic vs international and is case-insensitive', () => {
    expect(getHubTerminal('IAH', false)).toBe('C');
    expect(getHubTerminal('IAH', true)).toBe('E');
    expect(getHubTerminal('iah', true)).toBe('E');
    expect(getHubTerminal('JFK', false)).toBe('');
  });
});
