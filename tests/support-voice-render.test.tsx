// @vitest-environment jsdom
/**
 * The dashboard's other donation surfaces, rendered, in the one "cover a day" voice (Nov 11 2026;
 * the strip and the About section have their own files):
 *   - the landed toast: the core line, and a button that names the day when the shared support
 *     status says which (to the fixed $17 link), "Help cover a day" otherwise (the any-amount link);
 *     the status is read only once the toast shows;
 *   - the ⓘ menu: "Help cover a day", and a trigger whose name no longer says "Donate";
 *   - the Supporters Wall caption: the wall is from before days were counted; no promise of a place
 *     on it.
 * Every `data-support` label and href is checked against the helpers that build them.
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import BmacToast from '../src/app/features/BmacToast';
import DisclaimerDialog from '../src/app/features/DisclaimerDialog';
import { LegalMenu } from '../src/app/features/LegalPopover';
import { resetSupportStatus } from '../src/app/state/support-status';
import { UiProvider, useUi } from '../src/app/state/ui';
import { supportStatusFromRows } from '../src/lib/cover-a-day.js';
import { supportAmountUrl, supportUrl } from '../src/lib/support-link.js';

const NOW = Date.parse('2026-11-10T18:00:00Z');
const BANNED = /\bdonat(?:e|es|ed|ion|ions|ing)\b|support the project|server costs?|\bconsider\b|chip in|coffee/i;

let statusBody: unknown = { configured: false };
const fetchMock = vi.fn(async (_url: string) => ({ ok: true, status: 200, json: async () => statusBody }));
const statusFetches = () => fetchMock.mock.calls.filter(([url]) => url === '/api/support-status').length;

async function flush() {
  for (let i = 0; i < 6; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

let ui: ReturnType<typeof useUi> | null = null;
function Probe() {
  const value = useUi();
  useEffect(() => {
    ui = value;
  });
  return null;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockClear();
  localStorage.clear();
  resetSupportStatus();
  statusBody = { configured: false };
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  resetSupportStatus();
  localStorage.clear();
  ui = null;
});

async function landed() {
  render(
    <UiProvider>
      <Probe />
      <BmacToast />
    </UiProvider>,
  );
  act(() => ui!.showBmacToast('UA1'));
  expect(statusFetches()).toBe(0);
  act(() => vi.advanceTimersByTime(3000));
  await flush();
}

const toastLink = () => document.querySelector<HTMLAnchorElement>('a[data-support="landed-toast"]')!;

describe('the landed toast', () => {
  it('status unknown: the core line and "Help cover a day" on the any-amount link', async () => {
    await landed();
    expect(screen.getByRole('status').querySelector('p')!.textContent).toBe(
      'Glad you landed ✈️ The Blue Board is free because flyers cover it, one day at a time.',
    );
    expect(toastLink().textContent).toBe('Help cover a day');
    expect(toastLink().getAttribute('href')).toBe(supportUrl('landed-toast'));
    // Read once the toast showed, never before.
    expect(statusFetches()).toBe(1);
  });

  it('today open: "Cover today · $17" on the $17 link', async () => {
    statusBody = supportStatusFromRows([], NOW);
    await landed();
    expect(toastLink().textContent).toBe('Cover today · $17');
    expect(toastLink().getAttribute('href')).toBe(supportAmountUrl(17, 'landed-toast'));
  });

  it('today covered: "Cover tomorrow · $17", and the sentence still makes no claim about today', async () => {
    statusBody = supportStatusFromRows(
      [{ id: 1, amount_cents: 1700, currency: 'usd', paid_at: '2026-11-10T15:00:00Z', refunded: false, amount_refunded_cents: 0, display_name: 'Dana R.', hidden: false }],
      NOW,
    );
    await landed();
    expect(toastLink().textContent).toBe('Cover tomorrow · $17');
    expect(screen.getByRole('status').textContent).not.toMatch(/Dana|covered by/);
  });
});

describe('the ⓘ menu', () => {
  it('says "Help cover a day", and its trigger is named without "Donate"', async () => {
    render(
      <UiProvider>
        <LegalMenu />
      </UiProvider>,
    );
    const trigger = screen.getByRole('button', { name: 'About, legal and help cover a day links' });
    expect(trigger.getAttribute('title')).toBe('About · Legal · Help cover a day');
    fireEvent.click(trigger);
    await flush();
    const link = document.querySelector<HTMLAnchorElement>('a[data-support="legal-menu"]')!;
    expect(link.textContent).toBe('Help cover a day');
    expect(link.getAttribute('href')).toBe(supportUrl('legal-menu'));
    expect(link.closest('div')!.textContent).not.toMatch(BANNED);
  });
});

describe('the Supporters Wall', () => {
  it('says the wall is from before days were counted, and offers the day instead of a place on it', async () => {
    render(
      <UiProvider>
        <Probe />
        <DisclaimerDialog />
      </UiProvider>,
    );
    act(() => ui!.setDisclaimerOpen(true));
    await flush();
    const link = document.querySelector<HTMLAnchorElement>('a[data-support="about-wall"]')!;
    expect(link.textContent).toBe('Cover a day and you can put your name on it.');
    expect(link.getAttribute('href')).toBe(supportUrl('about-wall'));
    expect(link.parentElement!.textContent).toBe(
      'These readers backed The Blue Board before days were counted. Cover a day and you can put your name on it.',
    );
    for (const a of document.querySelectorAll('[data-support]')) {
      expect(a.textContent, a.getAttribute('data-support')!).not.toMatch(BANNED);
      expect(a.closest('p, div')!.textContent, a.getAttribute('data-support')!).not.toMatch(BANNED);
    }
  });
});
