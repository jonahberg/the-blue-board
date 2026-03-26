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
});
