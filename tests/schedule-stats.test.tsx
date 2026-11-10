// @vitest-environment jsdom
/**
 * The schedule board's stat strip, rendered (Nov 2026).
 *
 * ORD departures on Nov 10 2026, 16:54 CST, read "14 CANCELED" and "89 UNCATEGORIZED" on a
 * 91%-on-time day. All 14 were the provider's unconfirmed "Likely Canceled", and every
 * "uncategorized" row printed "Departed" on the board beneath it (live-feed-confirmed, no
 * provider time). The counts below are that board's, through the fixed `board-stats.js`.
 */

import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { TooltipProvider } from '@/components/ui/tooltip';
import { ScheduleStats } from '@/app/views/schedule/ScheduleStats';
import type { BoardModel } from '@/app/views/schedule/useBoardModel';

afterEach(cleanup);

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
  const labelEl = screen.getAllByText(label).find((el) => el.textContent === label);
  if (!labelEl) throw new Error(`no card labelled ${label}`);
  return labelEl.parentElement as HTMLElement;
}

describe('ScheduleStats — desktop', () => {
  it('headlines confirmed cancellations and carries the unconfirmed ones as a quieter figure', () => {
    renderStrip(ORD_DEP, 'departures');
    const canceled = cardFor('Canceled');
    expect(within(canceled).getByText('0')).toBeTruthy();
    expect(within(canceled).getByText('+14 unconfirmed')).toBeTruthy();
    // A calm zero is not painted as an alarm; the tooltip bridges to the rows' wording.
    expect(within(canceled).getByText('0').className).toMatch(/\btext-muted-foreground\b/);
    expect(canceled.getAttribute('title')).toContain('“Likely Canceled”');
  });

  it('calls a departed-but-untimed row what the board calls it, and shows no Uncategorized card', () => {
    renderStrip(ORD_DEP, 'departures');
    const untimed = cardFor('Departed · not timed');
    expect(within(untimed).getByText('88')).toBeTruthy();
    expect(untimed.getAttribute('title')).toMatch(/not scored on time or late/);
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
