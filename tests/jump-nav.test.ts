// @vitest-environment jsdom
// The in-page jump row scrolls sideways on a phone (src/scripts/jump-nav.ts): which edges fade,
// and how far a focused pill is scrolled so it clears the fade.
import { describe, expect, it } from 'vitest';

import { overflowEdges, revealOffset } from '../src/scripts/jump-nav';

describe('overflowEdges', () => {
  it('names the edges with pills past them', () => {
    expect(overflowEdges({ scrollLeft: 0, clientWidth: 390, scrollWidth: 390 })).toBeNull();
    expect(overflowEdges({ scrollLeft: 0, clientWidth: 390, scrollWidth: 765 })).toBe('right');
    expect(overflowEdges({ scrollLeft: 120, clientWidth: 390, scrollWidth: 765 })).toBe('both');
    expect(overflowEdges({ scrollLeft: 375, clientWidth: 390, scrollWidth: 765 })).toBe('left');
    // Sub-pixel widths are not an overflow.
    expect(overflowEdges({ scrollLeft: 0.5, clientWidth: 390, scrollWidth: 390.6 })).toBeNull();
  });
});

describe('revealOffset', () => {
  const row = { left: 0, right: 390 };
  it('scrolls a pill under the right fade clear of it', () => {
    expect(revealOffset(row, { left: 303, right: 387 }, 0)).toBe(41);
  });
  it('scrolls back for a pill under the left fade, never past the start', () => {
    expect(revealOffset(row, { left: 10, right: 90 }, 200)).toBe(-34);
    expect(revealOffset(row, { left: 10, right: 90 }, 20)).toBe(-20);
    expect(revealOffset(row, { left: 10, right: 90 }, 0)).toBe(0);
  });
  it('leaves a pill already clear alone', () => {
    expect(revealOffset(row, { left: 100, right: 200 }, 50)).toBe(0);
  });
});
