import { describe, it, expect } from 'vitest';
import { starlinkLabel, starlinkAsOf, isPlausibleStarlinkCount } from '../src/lib/starlink-facts.js';

describe('starlink-facts helpers', () => {
  it('floors the label to the nearest 25', () => {
    expect(starlinkLabel(513)).toBe('500+');
    expect(starlinkLabel(425)).toBe('425+');
    expect(starlinkLabel(499)).toBe('475+');
    expect(starlinkLabel(1000)).toBe('1000+');
  });

  it('formats the as-of month in UTC', () => {
    expect(starlinkAsOf(new Date('2026-08-11T00:30:00Z'))).toBe('August 2026');
    expect(starlinkAsOf(new Date('2026-12-31T23:59:00Z'))).toBe('December 2026');
  });

  it('accepts only integers between the committed floor and the fleet ceiling', () => {
    expect(isPlausibleStarlinkCount(513, 428)).toBe(true);
    expect(isPlausibleStarlinkCount(428, 428)).toBe(true);
    expect(isPlausibleStarlinkCount(427, 428)).toBe(false); // never go backwards
    expect(isPlausibleStarlinkCount(2501, 428)).toBe(false); // > entire fleet
    expect(isPlausibleStarlinkCount(0, 428)).toBe(false);
    expect(isPlausibleStarlinkCount(undefined, 428)).toBe(false);
    expect(isPlausibleStarlinkCount(513.5, 428)).toBe(false);
  });
});
