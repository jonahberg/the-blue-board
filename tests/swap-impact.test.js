import { describe, it, expect } from 'vitest';
import { analyzeSwapImpact } from '../src/lib/swap-impact.js';

// Injected fleet lookups. Tests pass a `stats` map (code -> typical-fleet-stats) and
// a `byReg` map (tail -> aircraft) plus the set of Starlink tails.
function makeDeps({ stats = {}, byReg = {}, starlink = [] } = {}) {
  return {
    getTypicalFleetStats: (code) => stats[code] || null,
    fleetByReg: byReg,
    starlinkTails: new Set(starlink),
  };
}

const has = (impacts, text) => impacts.some((i) => i.text === text);

describe('analyzeSwapImpact', () => {
  it('returns no impacts when neither aircraft is known', () => {
    expect(analyzeSwapImpact('X', 'Y', '—', makeDeps())).toEqual([]);
  });

  it('flags a widebody->narrowbody cabin downgrade as "Lost Polaris"', () => {
    const deps = makeDeps({
      stats: {
        '777': { topCabin: 'J', seats: { J: 40, 'E+': 50, Y: 200 }, tot: 290, wifi: 'ViaSat Ka', ife: 'AVOD', hasStarlink: false },
        '737': { topCabin: 'E+', seats: { 'E+': 30, Y: 150 }, tot: 180, wifi: 'ViaSat Ka', ife: 'AVOD', hasStarlink: false },
      },
    });
    const impacts = analyzeSwapImpact('777', '737', '—', deps);
    expect(has(impacts, 'Lost Polaris')).toBe(true);
    const cabin = impacts.find((i) => i.text === 'Lost Polaris');
    expect(cabin.cls).toBe('downgrade');
  });

  it('signs the seat-count delta (gain is lateral, loss is downgrade)', () => {
    const gain = makeDeps({
      stats: {
        A: { topCabin: 'Y', seats: { Y: 100 }, tot: 100, wifi: 'NO', ife: 'PDE', hasStarlink: false },
        B: { topCabin: 'Y', seats: { Y: 120 }, tot: 120, wifi: 'NO', ife: 'PDE', hasStarlink: false },
      },
    });
    const up = analyzeSwapImpact('A', 'B', '—', gain);
    expect(has(up, '+20 seats')).toBe(true);
    expect(up.find((i) => i.text === '+20 seats').cls).toBe('lateral');

    const down = analyzeSwapImpact('B', 'A', '—', gain);
    expect(has(down, '-20 seats')).toBe(true);
    expect(down.find((i) => i.text === '-20 seats').cls).toBe('downgrade');
  });

  it('classifies a WiFi rank change gated by WIFI_RANK', () => {
    const deps = makeDeps({
      stats: {
        C: { topCabin: 'Y', seats: { Y: 100 }, tot: 100, wifi: 'NO', ife: 'PDE', hasStarlink: false },
        D: { topCabin: 'Y', seats: { Y: 100 }, tot: 100, wifi: 'ViaSat Ka', ife: 'PDE', hasStarlink: false },
      },
    });
    const impacts = analyzeSwapImpact('C', 'D', '—', deps);
    const wifi = impacts.find((i) => i.text === 'ViaSat Ka WiFi');
    expect(wifi).toBeTruthy();
    expect(wifi.cls).toBe('upgrade');
  });

  it('adds a Starlink upgrade when the actual tail is Starlink-equipped', () => {
    const deps = makeDeps({
      stats: {
        OLD: { topCabin: 'Y', seats: { Y: 100 }, tot: 100, wifi: 'ViaSat Ka', ife: 'PDE', hasStarlink: false },
      },
      // tail is in STARLINK_TAILS even though its w field isn't "Starlink" — membership drives the badge
      byReg: { N127SY: { r: 'N127SY', seats: { Y: 100 }, tot: 100, w: 'ViaSat Ka', i: 'PDE' } },
      starlink: ['N127SY'],
    });
    const impacts = analyzeSwapImpact('OLD', 'NEW', 'N127SY', deps);
    expect(has(impacts, '⚡ Starlink')).toBe(true);
    expect(impacts.find((i) => i.text === '⚡ Starlink').cls).toBe('upgrade');
  });

  it('flags "Lost Starlink" when the new tail is not Starlink-equipped', () => {
    const deps = makeDeps({
      stats: {
        OLD: { topCabin: 'Y', seats: { Y: 100 }, tot: 100, wifi: 'ViaSat Ka', ife: 'PDE', hasStarlink: true },
      },
      byReg: { N999ZZ: { r: 'N999ZZ', seats: { Y: 100 }, tot: 100, w: 'ViaSat Ka', i: 'PDE' } },
      starlink: [],
    });
    const impacts = analyzeSwapImpact('OLD', 'NEW', 'N999ZZ', deps);
    expect(has(impacts, 'Lost Starlink')).toBe(true);
    expect(impacts.find((i) => i.text === 'Lost Starlink').cls).toBe('downgrade');
  });
});
