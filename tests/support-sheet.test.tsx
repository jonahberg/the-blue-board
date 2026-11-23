// @vitest-environment jsdom
/**
 * The phone's "Cover a day" sheet (Nov 22 2026). The header's support icon went straight to the
 * any-amount Stripe page: 11 taps from Nov 12 to Nov 22, no payment. It now opens a sheet with the
 * amounts first, in the site's existing words, with the real header, More sheet, About dialog and
 * UI store, and a stubbed /api/support-status:
 *   1. a tap opens it (a button, not a link): `support_open` once, never a `mobile-header` click;
 *   2. its words are true or absent: unknown / today open / today covered / the strip's quiet case;
 *   3. every link is labelled by amount (`mobile-header-5` … `mobile-header-other`), one $17 link;
 *   4. 44 px targets; Escape closes it and focus goes back to the icon; About is one tap away;
 *   5. the More sheet's "Help cover a day" opens the same sheet, labelled `mobile-more`.
 * No Stripe URL is typed here: every expected href comes from the helpers that build them.
 */

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { TooltipProvider } from '@/components/ui/tooltip';

const track = vi.hoisted(() => vi.fn());
vi.mock('../src/lib/track.js', () => ({ track }));
vi.mock('../src/app/state/feed', () => ({
  useFeed: () => ({ flights: [], freshness: 'live', countdown: 30 }),
}));
vi.mock('../src/app/state/watch', () => ({
  useWatch: () => ({ watched: [] }),
}));

const { Header } = await import('../src/app/shell/Header');
const { MobileNav } = await import('../src/app/shell/MobileNav');
const { default: SupportSheet } = await import('../src/app/features/SupportSheet');
const { default: DisclaimerDialog } = await import('../src/app/features/DisclaimerDialog');
const { UiProvider } = await import('../src/app/state/ui');
const { PrefsProvider } = await import('../src/app/state/prefs');
const { resetSupportSheet } = await import('../src/app/state/support-sheet');
const { resetSupportStatus } = await import('../src/app/state/support-status');
const { supportStatusFromRows } = await import('../src/lib/cover-a-day.js');
const { supportAmountUrl, supportUrl } = await import('../src/lib/support-link.js');
const { SUPPORT_CLICK_EVENT, installSupportClickTracking } = await import('../src/lib/support-tracking.js');

// Nov 10 2026, noon Central.
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
const fetchMock = vi.fn(async (_url: string) => ({ ok: true, status: 200, json: async () => statusBody }));
const statusFetches = () => fetchMock.mock.calls.filter(([url]) => url === '/api/support-status').length;

const clicks = vi.fn();
beforeAll(() => {
  installSupportClickTracking(document, clicks);
});

async function flush() {
  for (let i = 0; i < 6; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function mount() {
  return render(
    <TooltipProvider>
      <PrefsProvider>
        <UiProvider>
          <Header onOpenWatch={() => {}} watchOpen={false} onOpenHelp={() => {}} />
          <MobileNav tab="live" onSelect={() => {}} />
          <SupportSheet />
          <DisclaimerDialog />
        </UiProvider>
      </PrefsProvider>
    </TooltipProvider>,
  );
}

const icon = () => screen.getByRole('button', { name: 'Cover a day of The Blue Board' });
const sheet = () => screen.queryByRole('dialog', { name: 'Cover a day' });
const opens = () => track.mock.calls.filter(([name]) => name === 'support_open').map(([, data]) => data);
/** [words, data-support, href] for every link in the sheet, in order. */
const links = () =>
  within(sheet()!)
    .getAllByRole('link')
    .map((a) => [a.textContent, a.getAttribute('data-support'), a.getAttribute('href')]);

/** Escape, then the zero timeout on which Radix's FocusScope hands focus back. */
async function escape() {
  await act(async () => {
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function openFromHeader() {
  fireEvent.click(icon());
  await flush();
  return sheet()!;
}

beforeEach(() => {
  vi.setSystemTime(NOW);
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockClear();
  track.mockClear();
  clicks.mockClear();
  resetSupportSheet();
  resetSupportStatus();
  statusBody = { configured: false };
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  resetSupportSheet();
  resetSupportStatus();
});

describe('SupportSheet — opened by the phone header\'s icon', () => {
  it('opens on a tap, titled "Cover a day", reports support_open once, and reads the status only then', async () => {
    mount();
    expect(sheet()).toBeNull();
    expect(statusFetches()).toBe(0);
    const dialog = await openFromHeader();
    expect(dialog).not.toBeNull();
    expect(within(dialog).getByText('Cover a day')).toBeTruthy();
    expect(statusFetches()).toBe(1);
    expect(opens()).toEqual([{ from: 'mobile-header' }]);
    // The icon is not a support link, so the delegated listener counted nothing.
    expect(clicks).not.toHaveBeenCalled();
  });

  it('status unknown: the core line, no claim, the full ladder labelled by amount, no About link', async () => {
    statusBody = { configured: false };
    mount();
    const dialog = await openFromHeader();
    expect(dialog.textContent).toContain('The Blue Board is free because flyers cover it, one day at a time.');
    expect(dialog.textContent).not.toMatch(/covered/);
    expect(links()).toEqual([
      ['$5', 'mobile-header-5', supportAmountUrl(5, 'mobile-header-5')],
      ['$10', 'mobile-header-10', supportAmountUrl(10, 'mobile-header-10')],
      ['$17 · one day', 'mobile-header-17', supportAmountUrl(17, 'mobile-header-17')],
      ['$100 · nearly six days', 'mobile-header-100', supportAmountUrl(100, 'mobile-header-100')],
      ['Other amount', 'mobile-header-other', supportUrl('mobile-header-other')],
    ]);
    expect(within(dialog).queryByRole('button', { name: /About/ })).toBeNull();
    for (const a of within(dialog).getAllByRole('link')) {
      expect(a.getAttribute('target')).toBe('_blank');
      expect(a.getAttribute('rel')).toBe('noopener noreferrer');
    }
  });

  it('today open: "No one has covered today yet." and the $17 says "Cover today · $17" on the one $17 link', async () => {
    statusBody = supportStatusFromRows([pay(17)], NOW);
    mount();
    const dialog = await openFromHeader();
    expect(within(dialog).getByText('No one has covered today yet.')).toBeTruthy();
    expect(links()).toEqual([
      ['$5', 'mobile-header-5', supportAmountUrl(5, 'mobile-header-5')],
      ['$10', 'mobile-header-10', supportAmountUrl(10, 'mobile-header-10')],
      ['Cover today · $17', 'mobile-header-17', supportAmountUrl(17, 'mobile-header-17')],
      ['$100 · nearly six days', 'mobile-header-100', supportAmountUrl(100, 'mobile-header-100')],
      ['Other amount', 'mobile-header-other', supportUrl('mobile-header-other')],
    ]);
  });

  it('today covered: the thank-you line and "Cover tomorrow · $17"', async () => {
    statusBody = supportStatusFromRows([pay(17, { display_name: 'Dana R.', paid_at: '2026-11-10T15:00:00Z' })], NOW);
    mount();
    const dialog = await openFromHeader();
    expect(within(dialog).getByText('Today is covered by Dana R.')).toBeTruthy();
    expect(within(dialog).getByRole('link', { name: 'Cover tomorrow · $17' }).getAttribute('data-support')).toBe('mobile-header-17');
  });

  it('still offers every amount when the strip would stay down (today and the next 14 days covered)', async () => {
    statusBody = supportStatusFromRows([pay(17 * 15, { paid_at: '2026-11-10T15:00:00Z' })], NOW);
    mount();
    const dialog = await openFromHeader();
    expect(within(dialog).getByText('Today is covered by a supporter.')).toBeTruthy();
    expect(links().map(([words]) => words)).toEqual(['$5', '$10', 'Cover Nov 25 · $17', '$100 · nearly six days', 'Other amount']);
  });

  it('a tap on an amount is a support_click with its amount\'s label; no link says bare "mobile-header"', async () => {
    mount();
    const dialog = await openFromHeader();
    const labels = within(dialog)
      .getAllByRole('link')
      .map((a) => a.getAttribute('data-support'));
    expect(labels).not.toContain('mobile-header');
    expect(document.querySelector('[data-support="mobile-header"]')).toBeNull();
    const prevent = (e: Event) => e.preventDefault(); // jsdom would otherwise try to navigate
    document.addEventListener('click', prevent);
    fireEvent.click(within(dialog).getByRole('link', { name: '$10' }));
    document.removeEventListener('click', prevent);
    expect(clicks.mock.calls).toEqual([[SUPPORT_CLICK_EVENT, { from: 'mobile-header-10' }]]);
  });

  it('gives every link and the About button a 44 px target', async () => {
    statusBody = supportStatusFromRows([pay(17)], NOW);
    mount();
    const dialog = await openFromHeader();
    const targets = [...within(dialog).getAllByRole('link'), within(dialog).getByRole('button', { name: "See this month's days in About" })];
    for (const el of targets) {
      const classes = el.className.split(/\s+/);
      expect(classes, el.textContent ?? '').toContain('min-h-11');
      expect(classes.some((c) => /^(sm|md|lg):(min-)?h-/.test(c))).toBe(false);
    }
  });

  it('closes on Escape and gives focus back to the icon', async () => {
    mount();
    await openFromHeader();
    // The sheet itself has focus (announced by its title), not the first amount.
    expect(document.activeElement?.getAttribute('role')).toBe('dialog');
    await escape();
    expect(sheet()).toBeNull();
    expect(document.activeElement).toBe(icon());
  });

  it('opens the same placement twice as two opens, one per tap', async () => {
    mount();
    await openFromHeader();
    await escape();
    await openFromHeader();
    expect(opens()).toEqual([{ from: 'mobile-header' }, { from: 'mobile-header' }]);
  });

  it('"See this month\'s days in About" closes the sheet and opens About, where the calendar is', async () => {
    statusBody = supportStatusFromRows([pay(17)], NOW);
    mount();
    const dialog = await openFromHeader();
    fireEvent.click(within(dialog).getByRole('button', { name: "See this month's days in About" }));
    await flush();
    expect(sheet()).toBeNull();
    const about = screen.getByRole('dialog', { name: /About The Blue Board/ });
    expect(within(about).getByRole('heading', { name: 'Cover a day' })).toBeTruthy();
  });
});

describe('SupportSheet — opened by the More sheet\'s "Help cover a day"', () => {
  it('opens the same sheet labelled mobile-more, reports it, and gives focus back to More', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    const more = screen.getByRole('dialog', { name: 'More' });
    fireEvent.click(within(more).getByRole('button', { name: 'Help cover a day' }));
    await flush();
    expect(screen.queryByRole('dialog', { name: 'More' })).toBeNull();
    expect(sheet()).not.toBeNull();
    expect(opens()).toEqual([{ from: 'mobile-more' }]);
    expect(links().map(([, label]) => label)).toEqual([
      'mobile-more-5',
      'mobile-more-10',
      'mobile-more-17',
      'mobile-more-100',
      'mobile-more-other',
    ]);
    await escape();
    expect(sheet()).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'More' }));
  });
});
