import { describe, it, expect } from 'vitest';
import { formatDataAge, dataAgeSeverity } from '../src/lib/data-age.js';

describe('formatDataAge', () => {
  it('reports very recent ages as "just now"', () => {
    expect(formatDataAge(0)).toBe('just now');
    expect(formatDataAge(45)).toBe('just now');
    expect(formatDataAge(89)).toBe('just now');
  });

  it('reports minute-scale ages in minutes', () => {
    expect(formatDataAge(300)).toBe('5m');
    expect(formatDataAge(1775 * 60)).not.toMatch(/^\d{3,}m$/); // never "1775m"
  });

  it('reports hour-scale ages in hours, not a wall of minutes', () => {
    expect(formatDataAge(7200)).toBe('2h');
    expect(formatDataAge(106495)).toBe('30h'); // the live frozen-board age
  });

  it('reports multi-day ages in days', () => {
    expect(formatDataAge(86400 * 3)).toBe('3d');
  });
});

describe('dataAgeSeverity', () => {
  it('treats sub-hour data as recent', () => {
    expect(dataAgeSeverity(300)).toBe('recent');
    expect(dataAgeSeverity(3599)).toBe('recent');
  });

  it('treats 1-6h data as aging', () => {
    expect(dataAgeSeverity(3600)).toBe('aging');
    expect(dataAgeSeverity(21599)).toBe('aging');
  });

  it('treats 6h+ data as stale', () => {
    expect(dataAgeSeverity(21600)).toBe('stale');
    expect(dataAgeSeverity(106495)).toBe('stale');
  });
});
