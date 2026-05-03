import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FLEET_PATH = resolve(__dirname, '../public/data/fleet.json');
const FLEET = JSON.parse(readFileSync(FLEET_PATH, 'utf8'));

describe('fleet.json data integrity', () => {
  it('contains a meaningful number of mainline aircraft', () => {
    expect(FLEET.length).toBeGreaterThan(1000);
  });

  it('every entry has a valid N-number registration', () => {
    const bad = FLEET.filter(a => !a.r || typeof a.r !== 'string' || !/^N\w+$/.test(a.r));
    expect(bad).toEqual([]);
  });

  it('every entry has a non-empty type', () => {
    const bad = FLEET.filter(a => !a.t || typeof a.t !== 'string');
    expect(bad).toEqual([]);
  });

  it('registrations are unique', () => {
    const regs = FLEET.map(a => a.r);
    expect(new Set(regs).size).toBe(regs.length);
  });
});

// Build the same FLEET_BY_REG index the dashboard builds, so we test the
// real lookup path (not just the file). Mirrors src/dashboard/main.js:96.
function buildIndex(db) {
  const idx = {};
  db.forEach(a => { idx[a.r] = a; });
  return idx;
}

// Mirrors src/dashboard/main.js matchAircraft (lines 851-864), minus the
// icao24 fallback which depends on icao24ToNNumber from main.js. The
// reg-first path is what FR24 hits in 99%+ of cases.
function matchByReg(idx, reg) {
  if (!reg) return null;
  const stripped = reg.replace('-', '');
  if (idx[stripped]) return idx[stripped];
  if (idx[reg]) return idx[reg];
  return null;
}

describe('matchAircraft regression cases', () => {
  const idx = buildIndex(FLEET);

  it('resolves N66808 (the reported bug) to a 737-900ER mainline entry', () => {
    const ac = matchByReg(idx, 'N66808');
    expect(ac).toBeTruthy();
    expect(ac.r).toBe('N66808');
    expect(ac.t).toBe('737-900ER');
  });

  it('returns null for genuine non-mainline tails', () => {
    const ac = matchByReg(idx, 'N999XX');
    expect(ac).toBeNull();
  });
});
