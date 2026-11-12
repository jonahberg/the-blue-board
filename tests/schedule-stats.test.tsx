// @vitest-environment jsdom
/**
 * The schedule board's stat strip, rendered (Nov 2026).
 *
 * ORD departures on Nov 10 2026, 16:54 CST, read "14 CANCELED" and "89 UNCATEGORIZED" on a
 * 91%-on-time day. All 14 were the provider's unconfirmed "Likely Canceled", and every
 * "uncategorized" row printed "Departed" on the board beneath it (live-feed-confirmed, no
 * provider time). The counts below are that board's, through the fixed `board-stats.js`.
 */

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { TooltipProvider } from '@/components/ui/tooltip';
import { ScheduleStats } from '@/app/views/schedule/ScheduleStats';
import type { BoardModel } from '@/app/views/schedule/useBoardModel';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

beforeAll(() => {
  // Radix positions popovers and tooltips with floating-ui, which needs a ResizeObserver.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

/** A touch screen, as `(pointer: coarse)` sees it. */
function touchScreen() {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: /pointer:\s*coarse/.test(query),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
}

/** Tap a term and return the explanation it opened (a popover on touch). */
async function explanationOf(name: string | RegExp): Promise<string> {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name }));
  });
  return screen.getByRole('dialog').textContent ?? '';
}

const ORD_DEP: BoardModel['stats'] = {
  total: 633,
  onTime: 150,
  late: 15,
  untimed: 88,
  inAir: 0,
  upcoming: 191,
  canceled: 14,
  canceledUncertain: 14,
  canceledConfirmed: 0,
  presumed: 175,
  operated: 165,
  otp: 91,
  uncategorized: 0,
};

const ORD_ARR: BoardModel['stats'] = {
  total: 621,
  onTime: 113,
  late: 3,
  untimed: 0,
  inAir: 73,
  upcoming: 128,
  canceled: 19,
  canceledUncertain: 19,
  canceledConfirmed: 0,
  presumed: 285,
  operated: 116,
  otp: 97,
  uncategorized: 0,
};

function renderStrip(stats: BoardModel['stats'], dir: 'departures' | 'arrivals', compact = false) {
  return render(
    <TooltipProvider>
      <ScheduleStats stats={stats} dir={dir} dayLabel="Tue, Nov 10" hub="ORD" hubDisruptionMinutes={0} compact={compact} />
    </TooltipProvider>,
  );
}

/** The card (desktop) or grid cell (phone) whose label is exactly `label`. */
function cardFor(label: string): HTMLElement {
  const labelEl = screen.getAllByText(label)[0];
  return (labelEl.closest('[data-slot="card"]') ?? labelEl.parentElement) as HTMLElement;
}

describe('ScheduleStats — desktop', () => {
  it('headlines confirmed cancellations and carries the unconfirmed ones as a quieter figure', () => {
    renderStrip(ORD_DEP, 'departures');
    const canceled = cardFor('Canceled');
    expect(within(canceled).getByText('0')).toBeTruthy();
    // On the label's line, so the card row keeps its height.
    expect(within(canceled).getByText(/\+14 unconfirmed/)).toBeTruthy();
    // A calm zero is not painted as an alarm.
    expect(within(canceled).getByText('0').className).toMatch(/\btext-muted-foreground\b/);
    // The explanation that bridges to the rows' wording is the label's own (a title= never shows
    // on a touch screen): a dotted term, here on a touch screen, opened by a tap.
    expect(canceled.getAttribute('title')).toBeNull();
  });

  it('on a touch screen a tap on a card label opens its explanation (title= never showed there)', async () => {
    touchScreen();
    renderStrip(ORD_DEP, 'departures');
    expect(await explanationOf('Canceled')).toContain('“Likely Canceled”');
    cleanup();
    renderStrip(ORD_DEP, 'departures');
    expect(await explanationOf('Departed · not timed')).toMatch(/not scored on time or late/);
    cleanup();
    renderStrip(ORD_DEP, 'departures');
    // The on-time rule, in full, behind the On-Time term.
    expect(await explanationOf('On-Time')).toMatch(/within 30 min of schedule/);
    cleanup();
    renderStrip(ORD_DEP, 'departures');
    // The presumed chip is itself the term.
    expect(await explanationOf(/175 presumed departed/)).toMatch(/scheduled time passed without a live update/);
  });

  it('calls a departed-but-untimed row what the board calls it, and shows no Uncategorized card', () => {
    renderStrip(ORD_DEP, 'departures');
    const untimed = cardFor('Departed · not timed');
    expect(within(untimed).getByText('88')).toBeTruthy();
    expect(untimed.getAttribute('title')).toBeNull();
    expect(screen.queryByText('Uncategorized')).toBeNull();
  });

  it('an arrivals board shows the flights in the air on their own card', () => {
    renderStrip(ORD_ARR, 'arrivals');
    expect(within(cardFor('In the air')).getByText('73')).toBeTruthy();
    expect(screen.queryByText('Landed · not timed')).toBeNull();
    expect(screen.queryByText('Uncategorized')).toBeNull();
  });

  it('every row is on a card: the visible counts reconcile with the total', () => {
    const { container } = renderStrip(ORD_DEP, 'departures');
    const presumed = ORD_DEP.presumed; // in the chip under the cards
    expect(container.textContent).toContain(`${presumed} presumed departed`);
    const s = ORD_DEP;
    expect(s.onTime + s.late + s.untimed + s.canceled + s.inAir + s.upcoming + s.presumed + s.uncategorized).toBe(s.total);
  });
});

describe('ScheduleStats — phone grid', () => {
  it('stays two full rows of four on a departures board', () => {
    const { container } = renderStrip(ORD_DEP, 'departures', true);
    const grid = container.querySelector('dl')!;
    // total + on-time (2 wide) + on time, late, not timed, canceled, upcoming = 8 slots.
    expect(grid.children).toHaveLength(7);
    expect(within(grid).getByText('Not timed')).toBeTruthy();
    expect(within(grid).getByText('+14 unconfirmed')).toBeTruthy();
    expect(grid.querySelectorAll('[aria-hidden="true"].bg-card')).toHaveLength(0);
  });

  it('pads the last row instead of leaving a hole when a rare extra cell appears', () => {
    const { container } = renderStrip({ ...ORD_DEP, uncategorized: 2, total: ORD_DEP.total + 2 }, 'departures', true);
    const grid = container.querySelector('dl')!;
    expect(within(grid).getByText('Uncategorized')).toBeTruthy();
    // 9 slots → padded to 12.
    expect(grid.querySelectorAll('[aria-hidden="true"].bg-card')).toHaveLength(3);
  });
});

describe('ScheduleStats — the phone\'s door to the hub guide', () => {
  // On a phone the toolbar's two rows are full (hub, find and three 44 px buttons), so the
  // Schedule header's hub-guide link rides the meta line under the strip. On desktop it sits in
  // the toolbar beside the hub selector (ScheduleControls), so the strip carries none.
  it('the phone strip carries one quiet "ORD hub guide" link to the hub page', () => {
    renderStrip(ORD_DEP, 'departures', true);
    const links = screen.getAllByRole('link', { name: /hub guide/ });
    expect(links).toHaveLength(1);
    expect(links[0].textContent).toBe('ORD hub guide');
    expect(links[0].getAttribute('href')).toBe('/hubs/ord');
    const classes = links[0].className.split(/\s+/);
    expect(classes).not.toContain('text-primary');
    // The running line keeps its height: the 44 px hit area is an after: box.
    expect(classes).toEqual(expect.arrayContaining(['relative', 'after:h-11']));
  });

  it('the desktop strip carries none', () => {
    renderStrip(ORD_DEP, 'departures');
    expect(screen.queryByRole('link', { name: /hub guide/ })).toBeNull();
  });
});
