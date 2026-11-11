// @vitest-environment jsdom
/**
 * The map layer row is a scrollbar-less horizontal scroller on phones. At 390 px it measured
 * clientWidth 291 against scrollWidth 533, with Radar, Pacific and Refresh entirely off-screen
 * and no cue that they existed (audit F28). While more lies to the right the row now carries
 * `data-overflow="right"` and a trailing fade mask.
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { TooltipProvider } from '@/components/ui/tooltip';
import { MapControls, hasMoreRight } from '../src/app/views/live/MapControls';

function mount() {
  return render(
    <TooltipProvider>
      <MapControls
        className="flex overflow-x-auto"
        active={['hubs']}
        onChange={() => {}}
        region="us"
        onRegion={() => {}}
        starlinkAvailable
        refreshing={false}
        onRefresh={() => {}}
      />
    </TooltipProvider>,
  );
}

/** jsdom has no layout: give the scroller the box the audit measured at 390 px. */
function size(el: HTMLElement, { clientWidth, scrollWidth }: { clientWidth: number; scrollWidth: number }) {
  Object.defineProperty(el, 'clientWidth', { configurable: true, value: clientWidth });
  Object.defineProperty(el, 'scrollWidth', { configurable: true, value: scrollWidth });
}

afterEach(cleanup);

describe('hasMoreRight', () => {
  it('is true while content extends past the right edge, false at the end', () => {
    expect(hasMoreRight({ scrollLeft: 0, clientWidth: 291, scrollWidth: 533 })).toBe(true);
    expect(hasMoreRight({ scrollLeft: 242, clientWidth: 291, scrollWidth: 533 })).toBe(false);
    expect(hasMoreRight({ scrollLeft: 241.5, clientWidth: 291, scrollWidth: 533 })).toBe(false);
    expect(hasMoreRight({ scrollLeft: 0, clientWidth: 700, scrollWidth: 700 })).toBe(false);
  });
});

describe('MapControls overflow cue', () => {
  it('fades the trailing edge while chips are hidden and clears it once scrolled to the end', () => {
    const { container } = mount();
    const row = container.firstElementChild as HTMLElement;
    size(row, { clientWidth: 291, scrollWidth: 533 });
    act(() => {
      fireEvent.scroll(row);
    });
    expect(row.dataset.overflow).toBe('right');
    expect(row.className).toMatch(/data-\[overflow=right\]:\[mask-image:linear-gradient/);

    row.scrollLeft = 242;
    act(() => {
      fireEvent.scroll(row);
    });
    expect(row.dataset.overflow).toBeUndefined();
  });

  it('shows no cue when every chip fits (tablet and desktop)', () => {
    const { container } = mount();
    const row = container.firstElementChild as HTMLElement;
    size(row, { clientWidth: 700, scrollWidth: 533 });
    act(() => {
      fireEvent.scroll(row);
    });
    expect(row.dataset.overflow).toBeUndefined();
  });
});

describe('MapControls on a phone (Nov 2026)', () => {
  it('keeps every toggle\'s name for assistive tech while the words are visually hidden below sm', () => {
    mount();
    for (const name of ['Hubs', 'Long-haul', 'Starlink', 'Radar']) {
      const toggle = screen.getByRole('button', { name });
      const label = [...toggle.querySelectorAll('span')].find((el) => el.textContent === name);
      // sr-only, not hidden: `hidden` would drop the accessible name with the word. A phone on
      // its side (past `sm` at 844 × 390) takes the same icon form (`landscape-phone`, Nov 2026).
      expect(label?.className).toBe('max-sm:sr-only landscape-phone:sr-only');
      expect(toggle.className.split(/\s+/)).toEqual(
        expect.arrayContaining(['max-sm:w-9', 'landscape-phone:w-9', 'landscape-phone:px-0']),
      );
      expect(toggle.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
      expect(toggle.className.split(/\s+/)).toEqual(
        expect.arrayContaining(['relative', 'h-9', 'min-w-9', 'after:absolute', 'after:-inset-[5px]']),
      );
    }
  });

  it('draws Refresh with a lucide icon, not the ↻ / ⏳ glyphs', () => {
    mount();
    const refresh = screen.getByRole('button', { name: 'Refresh' });
    expect(refresh.textContent).not.toMatch(/[↻⏳]/);
    expect(refresh.querySelector('svg')?.getAttribute('class')).toContain('lucide-refresh-cw');
  });
});
