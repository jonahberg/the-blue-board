import { afterEach, describe, expect, it, vi } from 'vitest';
import { prefersReducedMotion, scrollBehavior } from '../src/lib/motion.js';

afterEach(() => vi.unstubAllGlobals());

describe('scripted scrolls honour prefers-reduced-motion (audit F52)', () => {
  it('jumps instead of smooth-scrolling when the visitor asks for reduced motion', () => {
    expect(scrollBehavior(true)).toBe('auto');
    expect(scrollBehavior(false)).toBe('smooth');
  });

  it('reads the media query by default', () => {
    vi.stubGlobal('window', { matchMedia: (q) => ({ matches: q === '(prefers-reduced-motion: reduce)' }) });
    expect(prefersReducedMotion()).toBe(true);
    expect(scrollBehavior()).toBe('auto');
  });

  it('assumes motion is fine where matchMedia is unavailable (SSR, old engines)', () => {
    vi.stubGlobal('window', {});
    expect(prefersReducedMotion()).toBe(false);
    expect(scrollBehavior()).toBe('smooth');
  });
});
