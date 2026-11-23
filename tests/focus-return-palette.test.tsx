// @vitest-environment jsdom
/**
 * ⌘K, then a flight, then close the flight sheet: where does focus go?
 *
 * The flight sheet remembers what was focused when it opened, and gives focus back to it on
 * close (src/lib/focus-return.js). Opened from the search palette, that is the palette's own
 * input, and the palette has closed and unmounted by the time the sheet does, so the element
 * the sheet remembered is no longer in the document. Until Nov 2026 the sheet gave up on it
 * and focus fell to <body>: a keyboard user went back to the top of the page. Now it goes to
 * the "Find a flight" button that opened the palette.
 *
 * Real header, palette, flight sheet, UiProvider, PrefsProvider, ScheduleProvider and
 * FollowProvider; the feed, fleet and watch stores are stubbed (the real ones poll), as are the
 * flight-times API and the network. jsdom runs no exit animation, so the test plays the
 * palette's (see `getComputedStyleWithDialogExit`): without it the palette would be gone before
 * the sheet opened, and the sheet would record <body>, which is a different case.
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Flight } from '../src/app/data/types';

const AIRBORNE: Flight = {
  fr24id: '3c9a77d0', icao24: 'a0b7c4', lat: 40.91, lon: -104.62, hdg: 262, alt: 11278, spd: 240, vr: 0,
  squawk: null, acType: 'B39M', reg: 'N37502', origin: 'ORD', dest: 'SFO', flightIATA: 'UA2106',
  onGround: false, callsign: 'UAL2106', airline: 'UAL',
};

vi.mock('../src/app/state/feed', () => ({
  useFeed: () => ({
    flights: [AIRBORNE],
    lastGoodTs: null,
    freshness: 'live',
    countdown: 30,
    retrying: false,
    refreshing: false,
    failed: false,
    error: null,
    refresh: () => {},
    lookupReg: () => null,
  }),
}));
vi.mock('../src/app/state/watch', () => ({
  useWatch: () => ({ watched: [], isWatched: () => false, toggle: () => true }),
}));
vi.mock('../src/app/state/watch-alerts', () => ({ useWatchAlerts: () => ({ observe: () => {} }) }));
vi.mock('../src/app/state/fleet', () => ({
  useFleet: () => ({
    fleetDb: [],
    fleetByReg: {},
    expressByReg: {},
    starlink: { tails: new Set<string>(), aircraft: [] },
    special: new Map(),
    loading: false,
    loadFailed: false,
    retry: () => {},
  }),
}));
vi.mock('../src/app/data/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/app/data/api')>()),
  fetchFlightTimes: () => new Promise(() => {}),
}));

import { TooltipProvider } from '@/components/ui/tooltip';
import { SearchPalette } from '../src/app/features/SearchPalette';
import { FlightSheet } from '../src/app/features/FlightSheet';
import { Header } from '../src/app/shell/Header';
import { FollowProvider } from '../src/app/state/follow-link';
import { PrefsProvider } from '../src/app/state/prefs';
import { ScheduleProvider } from '../src/app/state/schedule';
import { UiProvider } from '../src/app/state/ui';

function mount() {
  render(
    <UiProvider>
      <PrefsProvider>
        <ScheduleProvider>
          <FollowProvider>
            <TooltipProvider>
              <Header onOpenWatch={() => {}} watchOpen={false} onOpenHelp={() => {}} />
              <SearchPalette />
              <FlightSheet />
            </TooltipProvider>
          </FollowProvider>
        </ScheduleProvider>
      </PrefsProvider>
    </UiProvider>,
  );
}

/** Past the palette's 150 ms debounce, and long enough for an overlay to unmount and hand focus back. */
async function settle() {
  await act(() => new Promise<void>((resolve) => setTimeout(resolve, 200)));
}

/**
 * The palette's exit animation, which jsdom does not run.
 *
 * In a browser the palette plays `data-closed:animate-out` before Radix's Presence removes it, so
 * when a result opens the flight sheet in the same keystroke the palette's input is still in the
 * document and still focused. That input is what the sheet records as its opener, and it is gone
 * by the time the sheet closes. jsdom reports no animation, so Presence removes the palette at once
 * and the sheet records <body> instead: the deep-link case, not this one. This reports an animation
 * name for a dialog while it is closing, as the CSS does, and `endPaletteExit()` ends it.
 */
const realGetComputedStyle = window.getComputedStyle.bind(window);
function getComputedStyleWithDialogExit(el: Element, pseudo?: string | null): CSSStyleDeclaration {
  const styles = realGetComputedStyle(el, pseudo);
  if (el.getAttribute('data-slot') !== 'dialog-content') return styles;
  return new Proxy(styles, {
    get(target, prop) {
      if (prop === 'animationName') return el.getAttribute('data-state') === 'closed' ? 'exit' : 'enter';
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

async function endPaletteExit() {
  const palette = document.querySelector('[data-slot="dialog-content"]');
  expect(palette, 'the palette left before its exit animation ended').not.toBeNull();
  await act(async () => {
    palette!.dispatchEvent(Object.assign(new Event('animationend'), { animationName: 'exit' }));
  });
}

beforeAll(() => {
  // cmdk scrolls the selected row into view; jsdom has no layout.
  Element.prototype.scrollIntoView = vi.fn();
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

beforeEach(() => {
  window.history.replaceState(null, '', '/');
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('no network in this test'))));
  vi.stubGlobal('getComputedStyle', getComputedStyleWithDialogExit);
  // A desktop: the flight sheet is a right-hand panel.
  vi.stubGlobal('matchMedia', (query: string) => {
    const min = Number(/min-width:\s*(\d+)px/.exec(query)?.[1] ?? 0);
    return {
      matches: 1280 >= min, media: query, onchange: null,
      addEventListener: () => {}, removeEventListener: () => {},
      addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
    };
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

describe('⌘K → a flight → close the flight sheet', () => {
  it('returns focus to the "Find a flight" button, not <body>', async () => {
    mount();
    const trigger = screen.getByRole('button', { name: 'Find a flight' });
    trigger.focus();
    await act(async () => fireEvent.click(trigger));
    const input = screen.getByRole('combobox');
    expect(document.activeElement).toBe(input);

    fireEvent.change(input, { target: { value: 'UA2106' } });
    await settle();
    // Enter takes the first result, as a keyboard user would. The palette closes and the flight
    // sheet opens in the same commit; the palette is still on screen, playing its exit.
    await act(async () => fireEvent.keyDown(input, { key: 'Enter' }));
    const sheet = document.querySelector<HTMLElement>('[data-slot="sheet-content"]');
    expect(sheet, 'the flight sheet did not open').not.toBeNull();
    expect(document.querySelector('[data-slot="dialog-content"]')?.getAttribute('data-state')).toBe('closed');

    await endPaletteExit();
    await settle();
    expect(screen.queryByRole('combobox')).toBeNull();
    // The palette's own close leaves focus where the sheet put it.
    expect(sheet!.contains(document.activeElement)).toBe(true);

    await act(async () => fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' }));
    await settle();

    expect(document.querySelector('[data-slot="sheet-content"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
