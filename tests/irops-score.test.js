import { describe, it, expect } from 'vitest';
import { iropsScore, iropsScoreCls, iropsScoreLabel, iropsRateFloor } from '../src/lib/irops-score.js';

describe('iropsScore (F017 weighting)', () => {
  it('returns 0 with no flights (never divides by zero)', () => {
    expect(iropsScore({ total: 0 })).toBe(0);
    expect(iropsScore({ cancellations: 3, total: 0 })).toBe(0);
    expect(iropsScore()).toBe(0);
  });

  it('weights a cancellation (x3) above any single delay', () => {
    const cancel = Number(iropsScore({ cancellations: 1, total: 100 }));
    const delay30to60 = Number(iropsScore({ delayed30: 1, delayed60: 0, total: 100 })); // 30-60 bucket, x1
    const delay60plus = Number(iropsScore({ delayed30: 1, delayed60: 1, total: 100 })); // 60m+, x2
    expect(cancel).toBe(3.0);
    expect(delay30to60).toBe(1.0);
    expect(delay60plus).toBe(2.0);
    // The incident-#1 invariant: a 61-min delay must NOT score as much as a cancellation.
    expect(delay60plus).toBeLessThan(cancel);
    expect(delay30to60).toBeLessThan(cancel);
  });

  it('does not double-count a 60m+ delay in the exclusive 30-60 bucket', () => {
    // delayed30 is cumulative (>30m includes >60m); the exclusive bucket must clamp at 0.
    expect(iropsScore({ delayed30: 2, delayed60: 3, total: 100 })).toBe((3 * 2 / 100 * 100).toFixed(1));
  });

  it('weights diversions x2', () => {
    expect(Number(iropsScore({ diversions: 1, total: 100 }))).toBe(2.0);
  });
});

describe('iropsScoreLabel / iropsScoreCls thresholds', () => {
  it('labels at the <5 and <15 boundaries', () => {
    expect(iropsScoreLabel(4.9)).toBe('NORMAL OPERATIONS');
    expect(iropsScoreLabel(5)).toBe('MINOR DISRUPTION');
    expect(iropsScoreLabel(14.9)).toBe('MINOR DISRUPTION');
    expect(iropsScoreLabel(15)).toBe('SIGNIFICANT DISRUPTION');
  });

  it('classes at the <5 and <15 boundaries', () => {
    expect(iropsScoreCls(4.9)).toBe('low');
    expect(iropsScoreCls(5)).toBe('med');
    expect(iropsScoreCls(15)).toBe('high');
  });

  it('coerces the stringified toFixed score correctly', () => {
    const s = iropsScore({ cancellations: 2, total: 100 }); // "6.0" (string)
    expect(typeof s).toBe('string');
    expect(iropsScoreLabel(s)).toBe('MINOR DISRUPTION');
    expect(iropsScoreCls(s)).toBe('med');
  });
});

describe('iropsRateFloor (small-sample guard)', () => {
  it('withholds a rate below the floor (incident #3 phantom-rate case)', () => {
    // 1 cancel on a 4-flight board is not a "25% rate".
    expect(iropsRateFloor(4, 1)).toBe(false);
    expect(iropsRateFloor(9, 2)).toBe(false);
  });

  it('publishes once total >= 10 OR cancellations >= 3', () => {
    expect(iropsRateFloor(10, 0)).toBe(true);
    expect(iropsRateFloor(4, 3)).toBe(true);
  });
});
