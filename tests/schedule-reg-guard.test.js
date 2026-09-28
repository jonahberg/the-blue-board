import { describe, it, expect } from 'vitest';

import { fleetFamily, regMatchesModel } from '../src/lib/schedule-reg-guard.js';

// Shapes from public/data/fleet.json (r = reg, t = fleet type).
const FLEET = {
  N76265: { r: 'N76265', t: '737-800', c: '16F/54E+/96Y', d: '2001' },
  N14502: { r: 'N14502', t: 'A321neo' },
  N37502: { r: 'N37502', t: '737 MAX 9' },
  N78004: { r: 'N78004', t: '777-200ER' },
};

describe('fleetFamily', () => {
  it('collapses variants to their family', () => {
    expect(fleetFamily('737 MAX 9')).toBe('737');
    expect(fleetFamily('737-900ER')).toBe('737');
    expect(fleetFamily('A321neo')).toBe('A32x');
    expect(fleetFamily('A319')).toBe('A32x');
    expect(fleetFamily('777-300ER')).toBe('777');
    expect(fleetFamily('787-10')).toBe('787');
    expect(fleetFamily('')).toBe('');
    expect(fleetFamily(undefined)).toBe('');
  });
});

describe('regMatchesModel (F15)', () => {
  it('rejects a 737-800 tail on an A321neo row (SFO UA2278, N76265)', () => {
    expect(regMatchesModel('N76265', 'A21N', FLEET)).toBe(false);
  });

  it('accepts a same-family tail, including variants the model text cannot resolve', () => {
    expect(regMatchesModel('N37502', 'B738', FLEET)).toBe(true);
    expect(regMatchesModel('N78004', 'B772', FLEET)).toBe(true);
    expect(regMatchesModel('N14502', 'A21N', FLEET)).toBe(true);
  });

  it('does not judge what it cannot know', () => {
    expect(regMatchesModel('N99999', 'A21N', FLEET)).toBe(true); // tail not in the fleet DB
    expect(regMatchesModel('N76265', 'E175', FLEET)).toBe(true); // regional type, no fleet map
    expect(regMatchesModel('N76265', '', FLEET)).toBe(true);
    expect(regMatchesModel('', 'A21N', FLEET)).toBe(true);
  });
});
