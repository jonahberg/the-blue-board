// The hub strip's network chip beside the brief (src/lib/network-chip.js). Nov 2026: a desktop
// read DISRUPTED three times in 60 px; the chip repeated the brief row directly above it.
import { describe, expect, it } from 'vitest';

import { networkChipRepeatsBrief } from '../src/lib/network-chip.js';

describe('networkChipRepeatsBrief', () => {
  it('is true only when a current brief carries the tone of the chip’s level', () => {
    expect(networkChipRepeatsBrief({ briefTone: 'disrupted', networkLevel: 'significant' })).toBe(true);
    expect(networkChipRepeatsBrief({ briefTone: 'watch', networkLevel: 'minor' })).toBe(true);
    expect(networkChipRepeatsBrief({ briefTone: 'calm', networkLevel: 'normal' })).toBe(true);
  });

  it('keeps the chip when the two disagree (the brief is a snapshot, the chip is live)', () => {
    expect(networkChipRepeatsBrief({ briefTone: 'watch', networkLevel: 'significant' })).toBe(false);
    expect(networkChipRepeatsBrief({ briefTone: 'disrupted', networkLevel: 'minor' })).toBe(false);
    expect(networkChipRepeatsBrief({ briefTone: 'calm', networkLevel: 'minor' })).toBe(false);
  });

  it('keeps the chip with no brief in the row, no reading, or an unknown FAA picture', () => {
    expect(networkChipRepeatsBrief({ briefTone: null, networkLevel: 'significant' })).toBe(false);
    expect(networkChipRepeatsBrief({ briefTone: 'calm', networkLevel: null })).toBe(false);
    expect(networkChipRepeatsBrief({ briefTone: 'calm', networkLevel: 'normal', unknown: true })).toBe(false);
    expect(networkChipRepeatsBrief()).toBe(false);
  });
});
