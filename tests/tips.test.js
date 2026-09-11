import { describe, it, expect } from 'vitest';
import { TIPS, pickTip, TIP_ROTATE_MS, TIP_DISMISS_DAYS } from '../src/lib/tips.js';

describe('TIPS', () => {
  it('covers the five tabs that have tips', () => {
    expect(Object.keys(TIPS)).toEqual(['tab-live', 'tab-schedule', 'tab-myflight', 'tab-weather', 'tab-fleet']);
  });

  it('keeps the per-tab counts from the live strip', () => {
    expect(TIPS['tab-live']).toHaveLength(3);
    expect(TIPS['tab-schedule']).toHaveLength(2);
    expect(TIPS['tab-myflight']).toHaveLength(2);
    expect(TIPS['tab-weather']).toHaveLength(1);
    expect(TIPS['tab-fleet']).toHaveLength(1);
  });

  it('keeps the copy byte-for-byte, apostrophes and all', () => {
    expect(TIPS['tab-live'][1]).toBe("Click a hub name in the sidebar to filter the map to just that hub's flights");
    expect(TIPS['tab-schedule'][0]).toBe('Use "Filter: Fleet, Aircraft, Starlink…" to narrow by family, equipment, or WiFi');
    expect(TIPS['tab-myflight'][1]).toBe('The "Where\'s My Plane?" section shows the inbound aircraft for your watched flight');
    expect(TIPS['tab-weather'][0]).toBe('Load schedule data in the Schedule tab to unlock the IROPS disruption monitor');
  });

  it('has no tips for tabs the strip does not cover (edge case — pickTip falls back)', () => {
    expect(TIPS['tab-starlink']).toBeUndefined();
    expect(TIPS['tab-analytics']).toBeUndefined();
    expect(TIPS['tab-sources']).toBeUndefined();
  });
});

describe('pickTip', () => {
  it('picks from the requested tab pool', () => {
    expect(pickTip('tab-schedule', () => 0)).toBe(TIPS['tab-schedule'][0]);
    expect(pickTip('tab-schedule', () => 0.99)).toBe(TIPS['tab-schedule'][1]);
  });

  it('indexes the pool by flooring rng() × length', () => {
    expect(pickTip('tab-live', () => 0)).toBe(TIPS['tab-live'][0]);
    expect(pickTip('tab-live', () => 0.5)).toBe(TIPS['tab-live'][1]);
    expect(pickTip('tab-live', () => 0.9)).toBe(TIPS['tab-live'][2]);
  });

  it('falls back to the Live pool for a tab with no tips', () => {
    expect(pickTip('tab-starlink', () => 0)).toBe(TIPS['tab-live'][0]);
    expect(pickTip('tab-sources', () => 0.9)).toBe(TIPS['tab-live'][2]);
  });

  it('falls back to the Live pool for missing input too (edge case)', () => {
    expect(pickTip(undefined, () => 0)).toBe(TIPS['tab-live'][0]);
    expect(pickTip('', () => 0)).toBe(TIPS['tab-live'][0]);
  });

  it('defaults to Math.random and always returns a real tip', () => {
    for (let i = 0; i < 25; i++) {
      expect(TIPS['tab-live']).toContain(pickTip('tab-live'));
    }
  });

  it('never falls off the end of a single-entry pool (edge case)', () => {
    expect(pickTip('tab-weather', () => 0.9999999)).toBe(TIPS['tab-weather'][0]);
  });
});

describe('timing constants', () => {
  it('rotates every 45 seconds', () => {
    expect(TIP_ROTATE_MS).toBe(45000);
  });

  it('suppresses a dismissed strip for 7 days', () => {
    expect(TIP_DISMISS_DAYS).toBe(7);
  });

  it('is 7 days in ms when multiplied out (edge case — the caller does × 86400000)', () => {
    expect(TIP_DISMISS_DAYS * 86400000).toBe(604800000);
  });
});
