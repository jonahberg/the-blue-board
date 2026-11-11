// @vitest-environment jsdom
/**
 * "Cover a day" in the About dialog (`CoverADay.tsx`) and the ⓘ menu's meter line
 * (`SupportMeter.tsx`), against a stubbed /api/support-status:
 *   - configured: a month calendar (covered filled, open dashed, today ringed, each cell with its
 *     own sentence), the month in a sentence, the line of truth, the rule, and a button naming
 *     the day $17 would cover, to the fixed $17 link;
 *   - unknown: the plain ask and "Help cover a day" (the any-amount link) — no calendar, no claim
 *     about today;
 *   - the amount ladder under the button, and the line that a name can be added at checkout;
 *   - the whole month covered: says so;
 *   - nothing fetched until the surface is opened.
 */

import { act, cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/app/data/api', () => ({ fetchSupportStats: () => Promise.reject(new Error('offline')) }));

import { CoverADay } from '../src/app/features/CoverADay';
import { SupportMeter } from '../src/app/features/SupportMeter';
import { resetSupportStatus } from '../src/app/state/support-status';
import { supportStatusFromRows } from '../src/lib/cover-a-day.js';
import { STRIPE_MONTHLY_URL, supportAmountUrl, supportUrl } from '../src/lib/support-link.js';

const NOW = Date.parse('2026-11-10T18:00:00Z');
const pay = (dollars: number, extra: Record<string, unknown> = {}) => ({
  id: Math.random(),
  amount_cents: dollars * 100,
  currency: 'usd',
  paid_at: '2026-11-02T15:00:00Z',
  refunded: false,
  amount_refunded_cents: 0,
  display_name: null,
  hidden: false,
  ...extra,
});

let statusBody: unknown = { configured: false };
const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => statusBody }));

async function flush() {
  for (let i = 0; i < 6; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockClear();
  resetSupportStatus();
  statusBody = { configured: false };
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  resetSupportStatus();
});

const button = () => document.querySelector<HTMLAnchorElement>('a[data-support="about"]')!;
const ladderTexts = () => [...document.querySelectorAll('[data-support-ladder] a')].map((a) => a.textContent);

describe('CoverADay (About)', () => {
  it('fetches nothing until the dialog is open', async () => {
    render(<CoverADay active={false} />);
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('unknown status: the plain ask, no calendar, no claim about today', async () => {
    render(<CoverADay active />);
    await flush();
    expect(screen.getByText('The Blue Board is free, with no ads. It costs about $500 a month to run, about $17 a day.')).toBeTruthy();
    expect(screen.queryByRole('list', { name: /day by day/ })).toBeNull();
    expect(screen.queryByText(/Today is|No one has covered/)).toBeNull();
    expect(button().textContent).toBe('Help cover a day');
    expect(button().getAttribute('href')).toBe(supportUrl('about'));
    // The ladder and the name line show whatever the status.
    expect(ladderTexts()).toEqual(['$5', '$10', '$17 · one day', '$100 · nearly six days', 'Other amount']);
    expect(screen.getByText('You can add a name at checkout to show on the day you cover.')).toBeTruthy();
    expect(button().getAttribute('data-support')).toBe('about');
  });

  it('not covered: the calendar with three covered days, today ringed and open, the line, "Cover today"', async () => {
    statusBody = supportStatusFromRows([pay(51, { display_name: 'Dana R.', paid_at: '2026-11-01T15:00:00Z' })], NOW);
    render(<CoverADay active />);
    await flush();
    const cal = screen.getByRole('list', { name: 'November 2026, day by day' });
    const cells = within(cal).getAllByRole('listitem');
    expect(cells).toHaveLength(30); // Nov 1 2026 is a Sunday: no leading blanks
    expect(cells[0].textContent).toContain('November 1: covered by Dana R.');
    expect(cells[0].className).toContain('bg-primary-fill');
    expect(cells[3].className).toContain('border-dashed');
    expect(cells[9].textContent).toContain('November 10, today: open');
    expect(cells[9].className).toContain('ring-2');
    expect(screen.getByText('3 of 30 days in November are covered.')).toBeTruthy();
    expect(screen.getByText('No one has covered today yet.')).toBeTruthy();
    expect(screen.getByText('Each $17 covers the day it is given, or the next open day after it. Smaller amounts add up toward a day.')).toBeTruthy();
    expect(button().textContent).toBe('Cover today · $17');
    expect(button().getAttribute('href')).toBe(supportAmountUrl(17, 'about'));
    expect(button().getAttribute('data-support')).toBe('about');
    // Who covered which day, for touch screens.
    expect(screen.getByText('Who covered which day')).toBeTruthy();
    expect(screen.getByText('Nov 1–3')).toBeTruthy();
  });

  it('covered: names today\'s supporter and offers tomorrow', async () => {
    statusBody = supportStatusFromRows([pay(17, { display_name: 'Dana R.', paid_at: '2026-11-10T15:00:00Z' })], NOW);
    render(<CoverADay active />);
    await flush();
    expect(screen.getByText('Today is covered by Dana R.')).toBeTruthy();
    expect(screen.getByText('1 of 30 days in November is covered.')).toBeTruthy();
    expect(button().textContent).toBe('Cover tomorrow · $17');
    expect(button().getAttribute('href')).toBe(supportAmountUrl(17, 'about'));
  });

  it('today and tomorrow covered: offers the next open day', async () => {
    statusBody = supportStatusFromRows([pay(34, { paid_at: '2026-11-10T15:00:00Z' })], NOW);
    render(<CoverADay active />);
    await flush();
    expect(button().textContent).toBe('Cover Nov 12 · $17');
  });

  it('the whole month covered: says so (the next open day is in December)', async () => {
    statusBody = supportStatusFromRows([pay(17 * 30, { paid_at: '2026-11-01T15:00:00Z' })], NOW);
    render(<CoverADay active />);
    await flush();
    expect(screen.getByText('Every day in November is covered. Thank you.')).toBeTruthy();
    expect(button().textContent).toBe('Cover Dec 1 · $17');
  });

  it('the month with nobody yet is an opening, not a score', async () => {
    statusBody = supportStatusFromRows([], NOW);
    render(<CoverADay active />);
    await flush();
    expect(screen.getByText('No one has covered a day in November yet. Be the first.')).toBeTruthy();
    expect(screen.queryByText(/0 of 30/)).toBeNull();
  });

  it('the ladder: one button per amount with a link, each with its own label, then Other amount', async () => {
    render(<CoverADay active />);
    await flush();
    const links = [...document.querySelectorAll<HTMLAnchorElement>('[data-support-ladder] a')];
    expect(links.map((a) => a.getAttribute('data-support'))).toEqual(['about-5', 'about-10', 'about-17', 'about-100', 'about-other']);
    for (const [i, amount] of [5, 10, 17, 100].entries()) {
      expect(links[i].getAttribute('href')).toBe(supportAmountUrl(amount, `about-${amount}`));
    }
    expect(links[4].getAttribute('href')).toBe(supportUrl('about-other'));
    for (const a of links) {
      expect(a.getAttribute('target')).toBe('_blank');
      expect(a.getAttribute('rel')).toBe('noopener noreferrer');
      expect(a.className).toContain('min-h-11');
    }
  });

  it('offers no monthly option while STRIPE_MONTHLY_URL is empty', async () => {
    expect(STRIPE_MONTHLY_URL).toBe('');
    render(<CoverADay active />);
    await flush();
    expect(screen.queryByText('Cover a day every month')).toBeNull();
  });
});

describe('SupportMeter (ⓘ menu)', () => {
  it('adds the line of truth when the status is known, and renders nothing when neither source answers', async () => {
    const { container, unmount } = render(<SupportMeter active />);
    await flush();
    expect(container.innerHTML).toBe('');
    unmount();

    resetSupportStatus();
    statusBody = supportStatusFromRows([], NOW);
    render(<SupportMeter active />);
    await flush();
    expect(screen.getByText('No one has covered today yet.')).toBeTruthy();
    expect(screen.getByText('$17 covers today.', { exact: false })).toBeTruthy();
  });
});
