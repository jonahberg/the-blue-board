import { describe, it, expect } from 'vitest';

import { SUPPORTERS } from '../src/data/supporters.js';

// The original wall, verbatim and in order (Feb 2026). A rewrite that loses or "tidies" one of
// these names has dropped a person who paid for the site.
const ORIGINAL_WALL = [
  '@LinBros88',
  'Greeby',
  'u/WrldDriftR',
  'LoveBlueBoard',
  '@paytonwolfee',
  'Danny',
  '@misadventurelab',
  'natto',
  '@MissLynsey',
  'K2',
  'James W',
  'Aaron',
  '@pconrad0',
  'Stephen R',
  'FlyerTalk JCG1005',
  'ML',
  'Leo',
];

describe('Supporters Wall (src/data/supporters.js)', () => {
  it('still starts with the original seventeen names, verbatim and in order', () => {
    expect(SUPPORTERS.slice(0, ORIGINAL_WALL.length)).toEqual(ORIGINAL_WALL);
  });

  it('includes the supporters added in Oct 2026', () => {
    for (const name of ['@Benchilada129', 'Paul Leonard', 'Mickey Kopanski', '/u/bcb354', 'james macnutt', 'Greg Calvert']) {
      expect(SUPPORTERS).toContain(name);
    }
  });

  it('has no duplicates, blanks, padding or anonymous placeholders', () => {
    expect(new Set(SUPPORTERS.map((n) => n.toLowerCase())).size).toBe(SUPPORTERS.length);
    for (const name of SUPPORTERS) {
      expect(typeof name).toBe('string');
      expect(name.trim()).toBe(name);
      expect(name.length).toBeGreaterThan(0);
      expect(name).not.toBe('Someone');
    }
  });
});
