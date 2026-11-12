import { describe, expect, it } from 'vitest';

import { modalityOf, openFocusOptions } from '../src/lib/input-modality.js';

describe('input modality', () => {
  it('reads a key as keyboard and a press as pointer', () => {
    expect(modalityOf('keydown')).toBe('keyboard');
    for (const type of ['pointerdown', 'mousedown', 'touchstart']) expect(modalityOf(type)).toBe('pointer');
    expect(modalityOf('focus')).toBeNull();
  });

  it('asks for no focus ring after a pointer, and leaves a key to the browser', () => {
    expect(openFocusOptions('pointer')).toEqual({ preventScroll: true, focusVisible: false });
    expect(openFocusOptions('keyboard')).toEqual({ preventScroll: true });
    expect(openFocusOptions(null)).toEqual({ preventScroll: true });
    expect(openFocusOptions(undefined)).not.toHaveProperty('focusVisible');
  });
});
