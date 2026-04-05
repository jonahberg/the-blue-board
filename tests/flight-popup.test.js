import { describe, expect, it } from 'vitest';

import { getFlightPopupMetrics } from '../src/lib/flight-popup.js';

describe('getFlightPopupMetrics', () => {
  it('shows cruise speed in knots without inventing a Mach number', () => {
    const metrics = getFlightPopupMetrics({
      alt: 35000 / 3.28084,
      spd: 450 / 1.944,
    });

    expect(metrics.altFt).toBe(35000);
    expect(metrics.speedText).toBe('450 kts');
    expect(metrics.speedText).not.toContain('M');
  });

  it('falls back to N/A when speed is missing', () => {
    expect(getFlightPopupMetrics({ alt: 12000 / 3.28084, spd: 0 }).speedText).toBe('N/A');
  });

  it('returns null altitude when alt is zero or missing', () => {
    expect(getFlightPopupMetrics({ alt: 0, spd: 0 }).altFt).toBeNull();
    expect(getFlightPopupMetrics({ spd: 0 }).altFt).toBeNull();
  });

  it('caps altPct at 100 for very high altitude', () => {
    // 50,000ft → above 41,000ft ceiling reference
    const metrics = getFlightPopupMetrics({ alt: 50000 / 3.28084, spd: 0 });
    expect(metrics.altPct).toBe(100);
  });

  it('computes altPct proportional to 41,000ft ceiling', () => {
    const metrics = getFlightPopupMetrics({ alt: 20500 / 3.28084, spd: 100 / 1.944 });
    expect(metrics.altPct).toBeCloseTo(50, 0);
  });
});
