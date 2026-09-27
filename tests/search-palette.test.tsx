// @vitest-environment jsdom
/**
 * ⌘K palette behaviour (F2, F7).
 *
 *  - F2: results are RANKED before the 20-row cap, so an airborne exact match is never sliced
 *    off behind twenty longer idents that happen to come first in feed order.
 *  - F7: the first row of the CURRENT result set is highlighted, so Enter works without an
 *    ArrowDown. Results land 150 ms after the keystroke; cmdk used to keep the previous
 *    query's first row as its value, which matched nothing once those rows unmounted.
 *  - The combobox has an accessible name.
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FeedValue } from '../src/app/state/feed';
import type { ScheduleValue } from '../src/app/state/schedule';
import type { UiValue } from '../src/app/state/ui';
import { SearchPalette } from '../src/app/features/SearchPalette';

const ctl = vi.hoisted(() => ({
  flights: [] as unknown[],
  select: vi.fn(),
  setSearchOpen: vi.fn(),
}));

vi.mock('../src/app/state/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/app/state/ui')>()),
  useUi: () =>
    ({
      searchOpen: true,
      setSearchOpen: ctl.setSearchOpen,
      select: ctl.select,
      openFr24: () => {},
      setTab: () => {},
      focusOn: () => {},
    }) as unknown as UiValue,
}));

vi.mock('../src/app/state/feed', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/app/state/feed')>()),
  useFeed: () => ({ flights: ctl.flights }) as unknown as FeedValue,
}));

vi.mock('../src/app/state/schedule', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/app/state/schedule')>()),
  useSchedule: () => ({ boards: {}, goto: () => {}, preload: () => {} }) as unknown as ScheduleValue,
}));

const flight = (n: number | string, over: Record<string, unknown> = {}) => ({
  fr24id: `fr-${n}`,
  icao24: `a${n}`,
  lat: 40,
  lon: -90,
  hdg: 0,
  alt: 10000,
  spd: 200,
  vr: 0,
  squawk: null,
  acType: 'B789',
  reg: `N${70000 + Number(String(n).replace(/\D/g, '') || 0)}`,
  origin: 'SFO',
  dest: 'EWR',
  flightIATA: `UA${n}`,
  callsign: `UAL${n}`,
  onGround: false,
  airline: 'UAL',
  ...over,
});

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
  vi.useFakeTimers();
  ctl.select.mockReset();
  ctl.setSearchOpen.mockReset();
  ctl.flights = [];
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

async function type(value: string) {
  const input = screen.getByRole('combobox');
  fireEvent.change(input, { target: { value } });
  await act(async () => {
    vi.advanceTimersByTime(200);
  });
}

describe('SearchPalette', () => {
  it('lists an airborne exact match first even when 25 longer idents precede it in the feed', async () => {
    ctl.flights = [...Array.from({ length: 25 }, (_, i) => flight(200 + i)), flight(2)];
    render(<SearchPalette />);
    await type('UA2');
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(20);
    expect(options[0].textContent).toContain('UA2SFO');
  });

  it('pre-selects the first result of the current query so Enter selects it', async () => {
    ctl.flights = [flight(100, { origin: 'ORD' }), flight(24990, { reg: 'N24990', origin: 'IAH' })];
    render(<SearchPalette />);
    await type('ORD');
    // Keystroke by keystroke, as a person types: every change re-runs cmdk's own
    // "select the first item" against the rows still on screen from the previous query.
    for (let i = 1; i <= 'N24990'.length; i++) {
      fireEvent.change(screen.getByRole('combobox'), { target: { value: 'N24990'.slice(0, i) } });
    }
    await act(async () => {
      vi.advanceTimersByTime(200);
    });

    const selected = document.querySelectorAll('[cmdk-item][aria-selected="true"]');
    expect(selected).toHaveLength(1);
    expect(selected[0].textContent).toContain('N24990');

    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
    expect(ctl.select).toHaveBeenCalledTimes(1);
    expect(ctl.select.mock.calls[0][0].flight.reg).toBe('N24990');
  });

  it('gives the combobox an accessible name', () => {
    render(<SearchPalette />);
    const input = screen.getByRole('combobox');
    const labelId = input.getAttribute('aria-labelledby');
    const label = labelId ? document.getElementById(labelId) : null;
    expect(label?.textContent).toBe('Find a flight');
  });
});
