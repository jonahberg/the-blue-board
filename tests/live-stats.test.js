import { describe, it, expect } from 'vitest';
import { computeLiveStats, isOnGround } from '../src/lib/live-stats.js';

// Live-feed shape: alt in metres, vr in m/s, spd in m/s.
const flight = (over = {}) => ({ alt: 10000, vr: 0, spd: 240, onGround: false, reg: '', ...over });
const noMatch = () => null;
const deps = { matchAircraft: noMatch, isFiltered: false };
// Every flight resolves to an airframe — the utilization numerator counts matched mainline only.
const matchAll = () => ({ r: 'N1' });
const utilDeps = { matchAircraft: matchAll, isFiltered: false };

describe('computeLiveStats — counts', () => {
  it('splits airborne traffic across the phase buckets', () => {
    const filtered = [
      flight({ alt: 3000, vr: 10 }),   // Climb
      flight({ alt: 1000, vr: 3 }),    // Takeoff → climbing
      flight({ alt: 10000, vr: 0 }),   // Cruise
      flight({ alt: 5000, vr: 0 }),    // En Route → cruising
      flight({ alt: 3000, vr: -5 }),   // Descent
      flight({ alt: 300, vr: -5 }),    // Approach → descending
      flight({ alt: 0, vr: 0, spd: 5, onGround: true }),
    ];
    const s = computeLiveStats([], filtered, 1000, new Set(), deps);
    expect(s.airborne).toBe(6);
    expect(s.ground).toBe(1);
    expect(s.climbing).toBe(2);
    expect(s.cruising).toBe(2);
    expect(s.descending).toBe(2);
  });

  it('counts a flight the feed flags onGround as ground, whatever its telemetry says', () => {
    const s = computeLiveStats([], [flight({ alt: 10000, vr: 0, onGround: true })], 100, new Set(), deps);
    expect(s.ground).toBe(1);
    expect(s.airborne).toBe(0);
    expect(s.cruising).toBe(0);
  });

  it('uses ONE ground definition for the bar and the sidebar (F67)', () => {
    const flaggedTaxiing = flight({ alt: 0, vr: 0, spd: 30, onGround: true }); // taxiing at 58 kt
    const parkedUnflagged = flight({ alt: 0, vr: 0, spd: 5, onGround: false });
    const cruising = flight();
    const all = [flaggedTaxiing, parkedUnflagged, cruising];
    const s = computeLiveStats(all, all, 100, new Set(), deps);
    expect(s.ground).toBe(2);
    expect(s.phaseGroups.Ground).toBe(2);
    expect(s.airborne).toBe(1);
    expect(isOnGround(parkedUnflagged)).toBe(true);
  });

  it('counts Starlink aircraft via the fleet match and via the raw registration', () => {
    const filtered = [
      flight({ reg: 'N100' }),
      flight({ reg: 'N200' }),
      flight({ reg: 'N300' }),
    ];
    const matchAircraft = (f) => (f.reg === 'N100' ? { r: 'N999' } : null);
    const s = computeLiveStats([], filtered, 100, new Set(['N999', 'N200']), { matchAircraft, isFiltered: false });
    expect(s.starlink).toBe(2); // N100 via its matched tail N999, N200 via raw reg
  });

  it('normalises the raw registration the way the roster stores it (F101)', () => {
    const s = computeLiveStats([], [flight({ reg: 'n-200' })], 100, new Set(['N200']), deps);
    expect(s.starlink).toBe(1);
  });

  it('uses an injected Starlink predicate as-is, so the bar and the map share one rule', () => {
    const filtered = [flight({ reg: 'N1' }), flight({ reg: 'N2' })];
    const s = computeLiveStats([], filtered, 100, (f) => f.reg === 'N2', deps);
    expect(s.starlink).toBe(1);
  });
});

describe('computeLiveStats — averages', () => {
  it('averages altitude in feet and speed in knots over airborne flights only', () => {
    const filtered = [
      flight({ alt: 10000, spd: 240 }),
      flight({ alt: 12000, spd: 250 }),
      flight({ alt: 0, spd: 5, onGround: true }),
    ];
    const s = computeLiveStats([], filtered, 100, new Set(), deps);
    expect(s.avgAlt).toBe('36,089ft'); // 11000 m mean ≈ 36,089 ft
    expect(s.avgSpd).toBe('476kts');
  });

  it('renders the placeholder when nothing is airborne (edge case)', () => {
    const s = computeLiveStats([], [flight({ onGround: true })], 100, new Set(), deps);
    expect(s.avgAlt).toBe('--');
    expect(s.avgSpd).toBe('--');
  });

  it('skips zero altitudes and speeds rather than dragging the average down (edge case)', () => {
    const filtered = [flight({ alt: 10000, spd: 240 }), flight({ alt: 0, spd: 0 })];
    const s = computeLiveStats([], filtered, 100, new Set(), deps);
    expect(s.avgAlt).toBe('32,808ft');
    expect(s.avgSpd).toBe('467kts');
  });
});

describe('computeLiveStats — utilization', () => {
  it('is matched mainline airborne over fleet size', () => {
    const filtered = Array.from({ length: 20 }, () => flight());
    expect(computeLiveStats([], filtered, 100, new Set(), utilDeps).utilization).toBe('20%');
  });

  it('leaves flights that match no airframe (Express, partners) out of the numerator (F92)', () => {
    const filtered = Array.from({ length: 20 }, (_, i) => flight({ reg: i < 15 ? 'MAIN' : 'EXPRESS' }));
    const matchMainline = (f) => (f.reg === 'MAIN' ? { r: 'N1' } : null);
    const s = computeLiveStats([], filtered, 100, new Set(), { matchAircraft: matchMainline, isFiltered: false });
    expect(s.utilization).toBe('15%');
    expect(s.airborne).toBe(20); // the airborne count itself still counts everything flying
  });

  it('is -- until the fleet database loads', () => {
    expect(computeLiveStats([], [flight()], 0, new Set(), deps).utilization).toBe('--');
  });

  it('appends (filtered) when a filter is active', () => {
    const filtered = Array.from({ length: 20 }, () => flight());
    const s = computeLiveStats([], filtered, 100, new Set(), { matchAircraft: matchAll, isFiltered: true });
    expect(s.utilization).toBe('20% (filtered)');
    expect(s.note).toBe(' (filtered)');
  });

  it('refuses to quote a percentage from a thin filtered sample (edge case)', () => {
    const filtered = Array.from({ length: 9 }, () => flight());
    const s = computeLiveStats([], filtered, 100, new Set(), { matchAircraft: noMatch, isFiltered: true });
    expect(s.utilization).toBe('n/a (small sample)');
  });

  it('quotes the percentage unfiltered even below 10 airborne (edge case)', () => {
    const filtered = Array.from({ length: 9 }, () => flight());
    expect(computeLiveStats([], filtered, 100, new Set(), utilDeps).utilization).toBe('9%');
  });
});

describe('computeLiveStats — sidebar phase groups', () => {
  it('groups ALL flights, not just the filtered set', () => {
    const all = [
      flight({ alt: 0, vr: 0, spd: 5 }),  // Ground
      flight({ alt: 3000, vr: 10 }),      // Climb
      flight({ alt: 10000, vr: 0 }),      // Cruise
      flight({ alt: 3000, vr: -5 }),      // Descent
      flight({ alt: 300, vr: -5 }),       // Approach
    ];
    const s = computeLiveStats(all, [], 100, new Set(), deps);
    expect(s.phaseGroups).toEqual({ Ground: 1, Climb: 1, Cruise: 1, Descent: 1, Approach: 1 });
    expect(s.airborne).toBe(0); // filtered set is empty
  });

  it('returns zeroed groups for an empty feed (edge case)', () => {
    expect(computeLiveStats([], [], 100, new Set(), deps).phaseGroups)
      .toEqual({ Ground: 0, Climb: 0, Cruise: 0, Descent: 0, Approach: 0 });
  });
});
