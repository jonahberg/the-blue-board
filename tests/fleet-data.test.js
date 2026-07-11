import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { matchAircraft, icao24ToNNumber } from '../src/lib/fleet-match.js';

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

// Build the same FLEET_BY_REG index the dashboard builds, so we exercise the
// REAL matchAircraft (imported from src/lib/fleet-match.js) — the same lookup
// path the dashboard uses — not a copy. Mirrors src/dashboard/main.js:176.
function buildIndex(db) {
  const idx = {};
  db.forEach(a => { idx[a.r] = a; });
  return idx;
}

describe('matchAircraft regression cases', () => {
  const idx = buildIndex(FLEET);

  it('resolves N66808 (the reported bug) to a 737-900ER mainline entry', () => {
    const ac = matchAircraft({ reg: 'N66808' }, idx);
    expect(ac).toBeTruthy();
    expect(ac.r).toBe('N66808');
    expect(ac.t).toBe('737-900ER');
    expect(ac.nnum).toBe('N66808');
  });

  it('strips a dash from the FR24 registration before looking up', () => {
    const ac = matchAircraft({ reg: 'N6-6808' }, idx);
    expect(ac).toBeTruthy();
    expect(ac.r).toBe('N66808');
  });

  it('returns null for genuine non-mainline tails', () => {
    expect(matchAircraft({ reg: 'N999XX' }, idx)).toBeNull();
  });

  it('falls back to the ICAO24 -> N-number conversion when reg is absent', () => {
    // The copy this test used to run skipped this branch entirely. Drive the REAL
    // fallback: convert a US ICAO24 hex, index a synthetic tail under it, and confirm
    // matchAircraft recovers it via icao24 alone.
    const hex = 'A12345';
    const nnum = icao24ToNNumber(hex);
    expect(nnum).toMatch(/^N/);
    const synthetic = { [nnum]: { r: nnum, t: 'TEST-TYPE' } };
    const ac = matchAircraft({ icao24: hex }, synthetic);
    expect(ac).toBeTruthy();
    expect(ac.t).toBe('TEST-TYPE');
    expect(ac.nnum).toBe(nnum);
  });

  it('icao24ToNNumber rejects non-US (out-of-range) hex codes', () => {
    expect(icao24ToNNumber('400000')).toBeNull(); // below the A00001 US block
    expect(icao24ToNNumber('C00001')).toBeNull(); // above AFFFFF
  });
});
