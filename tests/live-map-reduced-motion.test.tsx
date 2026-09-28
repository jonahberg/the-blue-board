// @vitest-environment jsdom
/**
 * Leaflet's flyTo animates in JavaScript, so the global CSS reduced-motion rule never reached
 * the map's 0.8–1.2 s zoom-and-pan sweeps (audit F52). With the preference set, map moves jump.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { flyOrJump, prefersReducedMotion } from '../src/app/map/LiveMap';

function fakeMap() {
  return { flyTo: vi.fn(), setView: vi.fn() };
}

function stubMatchMedia(reduce: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: reduce && query === '(prefers-reduced-motion: reduce)',
    media: query,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
}

afterEach(() => {
  // @ts-expect-error — jsdom has no matchMedia by default; restore that.
  delete window.matchMedia;
});

describe('flyOrJump', () => {
  it('animates by default', () => {
    stubMatchMedia(false);
    const map = fakeMap();
    flyOrJump(map as never, [41.97, -87.9], 6, 0.8);
    expect(map.flyTo).toHaveBeenCalledWith([41.97, -87.9], 6, { duration: 0.8 });
    expect(map.setView).not.toHaveBeenCalled();
  });

  it('jumps without animation under prefers-reduced-motion', () => {
    stubMatchMedia(true);
    expect(prefersReducedMotion()).toBe(true);
    const map = fakeMap();
    flyOrJump(map as never, [39, -97], 4, 1.2);
    expect(map.setView).toHaveBeenCalledWith([39, -97], 4, { animate: false });
    expect(map.flyTo).not.toHaveBeenCalled();
  });

  it('treats a missing matchMedia as no preference', () => {
    expect(prefersReducedMotion()).toBe(false);
  });

  it('is the only way LiveMap moves the map', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(resolve(__dirname, '../src/app/map/LiveMap.tsx'), 'utf8');
    expect(src.match(/\.flyTo\(/g)).toHaveLength(1); // the one inside flyOrJump
  });
});
