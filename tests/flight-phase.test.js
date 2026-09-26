import { describe, it, expect } from 'vitest';
import { getPhase, getPhaseGroup, decodeSquawk, PHASE_ICONS } from '../src/lib/flight-phase.js';

// The live feed reports SI units: altitude in metres, vertical rate in m/s, speed in m/s.
// getPhase converts internally (ft = m × 3.28084, fpm = m/s × 196.85, kt = m/s × 1.944).
const M_PER_FT = 1 / 3.28084;

describe('getPhase', () => {
  it('reports Ground below 100 ft and 50 kt', () => {
    expect(getPhase(0, 0, 5)).toEqual({ phase: 'Ground', icon: '🅿️', cls: 'phase-ground' });
    expect(getPhase(20 * M_PER_FT, 0, 10)).toEqual({ phase: 'Ground', icon: '🅿️', cls: 'phase-ground' });
  });

  it('reports Takeoff below 5000 ft when climbing faster than 500 fpm', () => {
    expect(getPhase(300, 10, 80)).toEqual({ phase: 'Takeoff', icon: '🛫', cls: 'phase-climb' });
  });

  it('reports Approach below 5000 ft when descending faster than 300 fpm', () => {
    expect(getPhase(300, -5, 80)).toEqual({ phase: 'Approach', icon: '🛬', cls: 'phase-approach' });
  });

  it('reports Climb and Descent above 5000 ft', () => {
    expect(getPhase(3000, 10, 200)).toEqual({ phase: 'Climb', icon: '↗️', cls: 'phase-climb' });
    expect(getPhase(3000, -5, 200)).toEqual({ phase: 'Descent', icon: '↘️', cls: 'phase-descent' });
  });

  it('reports Cruise above 25000 ft and En Route in between', () => {
    expect(getPhase(10000, 0, 240)).toEqual({ phase: 'Cruise', icon: '✈️', cls: 'phase-cruise' });
    expect(getPhase(5000, 0, 200)).toEqual({ phase: 'En Route', icon: '✈️', cls: 'phase-cruise' });
  });

  it('prefers Takeoff over Climb only above 500 fpm (edge case at the boundary)', () => {
    // 1000 m ≈ 3281 ft — under the 5000 ft gate either way.
    expect(getPhase(1000, 3, 120).phase).toBe('Takeoff'); // 590 fpm
    expect(getPhase(1000, 2, 120).phase).toBe('Climb'); //  394 fpm
  });

  it('falls through to En Route when telemetry fields are missing (edge case)', () => {
    expect(getPhase(null, null, null)).toEqual({ phase: 'En Route', icon: '✈️', cls: 'phase-cruise' });
    // On the ground but with no speed reading: the Ground gate needs both.
    expect(getPhase(0, null, null).phase).toBe('En Route');
    // Parked but taxiing fast enough to clear the 50 kt gate.
    expect(getPhase(0, 0, 30).phase).toBe('En Route');
  });
});

describe('PHASE_ICONS', () => {
  it('carries one icon per phase getPhase can return', () => {
    expect(PHASE_ICONS).toEqual({
      Ground: '🅿️',
      Takeoff: '🛫',
      Approach: '🛬',
      Climb: '↗️',
      Descent: '↘️',
      Cruise: '✈️',
      'En Route': '✈️',
    });
  });

  it('agrees with the icon getPhase actually emits', () => {
    expect(getPhase(0, 0, 5).icon).toBe(PHASE_ICONS.Ground);
    expect(getPhase(300, 10, 80).icon).toBe(PHASE_ICONS.Takeoff);
    expect(getPhase(10000, 0, 240).icon).toBe(PHASE_ICONS.Cruise);
  });

  it('shares one glyph between Cruise and En Route (edge case — they are not distinct on the map)', () => {
    expect(PHASE_ICONS.Cruise).toBe(PHASE_ICONS['En Route']);
  });
});

describe('getPhaseGroup', () => {
  it('collapses Takeoff and Climb into Climb', () => {
    expect(getPhaseGroup('Takeoff')).toBe('Climb');
    expect(getPhaseGroup('Climb')).toBe('Climb');
  });

  it('collapses Cruise and En Route into Cruise', () => {
    expect(getPhaseGroup('Cruise')).toBe('Cruise');
    expect(getPhaseGroup('En Route')).toBe('Cruise');
  });

  it('passes Ground, Descent and Approach through unchanged', () => {
    expect(getPhaseGroup('Ground')).toBe('Ground');
    expect(getPhaseGroup('Descent')).toBe('Descent');
    expect(getPhaseGroup('Approach')).toBe('Approach');
  });

  it('defaults unknown phases to Cruise (edge case)', () => {
    expect(getPhaseGroup('Holding')).toBe('Cruise');
    expect(getPhaseGroup('')).toBe('Cruise');
    expect(getPhaseGroup(undefined)).toBe('Cruise');
  });
});

describe('decodeSquawk', () => {
  it('decodes the three emergency codes with the alert class', () => {
    expect(decodeSquawk('7500')).toEqual({ text: '⚠️ HIJACK', cls: 'squawk-alert' });
    expect(decodeSquawk('7600')).toEqual({ text: '⚠️ RADIO FAILURE', cls: 'squawk-alert' });
    expect(decodeSquawk('7700')).toEqual({ text: '⚠️ EMERGENCY', cls: 'squawk-alert' });
  });

  it('decodes 1200 as a plain VFR tag with no alert class', () => {
    expect(decodeSquawk('1200')).toEqual({ text: 'VFR', cls: '' });
  });

  it('accepts numeric squawks as well as strings', () => {
    expect(decodeSquawk(7700)).toEqual({ text: '⚠️ EMERGENCY', cls: 'squawk-alert' });
    expect(decodeSquawk(1200)).toEqual({ text: 'VFR', cls: '' });
  });

  it('returns null for ordinary and missing codes (edge case)', () => {
    expect(decodeSquawk('2451')).toBeNull();
    expect(decodeSquawk('')).toBeNull();
    expect(decodeSquawk(null)).toBeNull();
    expect(decodeSquawk(undefined)).toBeNull();
    expect(decodeSquawk(0)).toBeNull();
  });
});
