import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { polarisAircraftCount } from '../src/lib/fleet-utils.js';
import { fleetOrder, fleetTypes } from '../src/data/fleet/index.js';

// /fleet used to multiply type-level `hasPolaris` by the type count, which also counted the
// 777-200ERs flown in a domestic 32F/124E+/206Y layout with no Polaris cabin (227 vs 223 on
// the Nov 3 2026 data). The count is now per tail, from each row's config string.

describe('polarisAircraftCount', () => {
  it('counts only rows of the given types whose config has a J cabin', () => {
    const rows = [
      { t: '777-200ER', c: '50J/24PE/46E+/156Y' },
      { t: '777-200ER', c: '32F/124E+/206Y' },
      { t: '787-9', c: '48J/21PE/39E+/84Y' },
      { t: '757-200', c: '16J/42E+/118Y' }, // has J, but not a type we asked about
      { t: '787-9', c: '' },
      { t: '787-9' },
    ];
    expect(polarisAircraftCount(rows, ['777-200ER', '787-9'])).toBe(2);
  });

  it('does not mistake other cabin letters for J', () => {
    expect(polarisAircraftCount([{ t: 'X', c: '16F/54E+/96Y' }], ['X'])).toBe(0);
    expect(polarisAircraftCount([{ t: 'X', c: '20J' }], ['X'])).toBe(1);
  });

  it('on the live data, never exceeds the type-level total for the Polaris types', () => {
    const db = JSON.parse(readFileSync('public/data/fleet.json', 'utf8'));
    const keys = fleetOrder.filter((k) => fleetTypes[k].seatConfig.hasPolaris);
    const typeTotal = keys.reduce((n, k) => n + fleetTypes[k].count, 0);
    const perTail = polarisAircraftCount(db, keys.map((k) => fleetTypes[k].typeCode));
    expect(perTail).toBeGreaterThan(0);
    expect(perTail).toBeLessThanOrEqual(typeTotal);
  });
});
