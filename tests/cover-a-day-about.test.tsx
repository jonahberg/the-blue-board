// @vitest-environment jsdom
/**
 * "Cover a day" in the About dialog (`CoverADay.tsx`) and the ⓘ menu's meter line
 * (`SupportMeter.tsx`), against a stubbed /api/support-status:
 *   - configured: a month calendar (covered filled, open dashed, today ringed, each cell with its
 *     own sentence), the line of truth, the order-from-the-1st note, and "Cover a day · $17";
 *   - unknown: the plain ask only — no calendar, no claim about today;
 *   - the whole month covered: says so and does not ask to "cover a day";
 *   - nothing fetched until the surface is opened.
 */

import { act, cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/app/data/api', () => ({ fetchSupportStats: () => Promise.reject(new Error('offline')) }));

import { CoverADay } from '../src/app/features/CoverADay';
import { SupportMeter } from '../src/app/features/SupportMeter';
import { resetSupportStatus } from '../src/app/state/support-status';
import { supportStatusFromRows } from '../src/lib/cover-a-day.js';
import { STRIPE_MONTHLY_URL, supportUrl } from '../src/lib/support-link.js';

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

const button = () => screen.getByRole('link', { name: /Cover a day · \$17|Support The Blue Board/ });

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
    expect(screen.queryByText(/Today is|Today isn't/)).toBeNull();
    expect(button().textContent).toBe('Cover a day · $17');
    expect(button().getAttribute('href')).toBe(supportUrl('about'));
    expect(button().getAttribute('data-support')).toBe('about');
  });

  it('not covered: the calendar with three covered days, today ringed and open, and the line', async () => {
    statusBody = supportStatusFromRows([pay(51, { display_name: 'Dana R.' })], NOW);
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
    expect(screen.getByText('3 of 30 days covered')).toBeTruthy();
    expect(screen.getByText("Today isn't covered yet.")).toBeTruthy();
    expect(screen.getByText('Each $17 covers one day. Donations fill the month in order from the 1st.')).toBeTruthy();
    expect(button().textContent).toBe('Cover a day · $17');
    // Who covered which day, for touch screens.
    expect(screen.getByText('Who covered which day')).toBeTruthy();
    expect(screen.getByText('Nov 1–3')).toBeTruthy();
  });

  it('covered: names today\'s supporter', async () => {
    statusBody = supportStatusFromRows([pay(170, { display_name: 'Dana R.' })], NOW);
    render(<CoverADay active />);
    await flush();
    expect(screen.getByText('Today is covered by Dana R.')).toBeTruthy();
  });

  it('the whole month covered: says so, and the button no longer promises a day', async () => {
    statusBody = supportStatusFromRows([pay(17 * 30)], NOW);
    render(<CoverADay active />);
    await flush();
    expect(screen.getByText('Every day in November is covered. Thank you.')).toBeTruthy();
    expect(button().textContent).toBe('Support The Blue Board');
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
    expect(screen.getByText("Today isn't covered yet.")).toBeTruthy();
    expect(screen.getByText('$17 keeps the site running for a day.')).toBeTruthy();
  });
});
