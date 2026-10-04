// @vitest-environment jsdom
/**
 * The map layer row is a scrollbar-less horizontal scroller on phones. At 390 px it measured
 * clientWidth 291 against scrollWidth 533, with Radar, Pacific and Refresh entirely off-screen
 * and no cue that they existed (audit F28). While more lies to the right the row now carries
 * `data-overflow="right"` and a trailing fade mask.
 */

import { act, cleanup, fireEvent, render } from '@testing-library/react';
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
