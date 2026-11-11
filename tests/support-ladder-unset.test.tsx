// @vitest-environment jsdom
/**
 * With no fixed-amount link set (SUPPORT_AMOUNT_LINKS all null), every surface still works:
 * the About section has no ladder, and a button that names a day falls back to the any-amount
 * link. This is the branch's state before the owner's links existed, and stays the safe path if
 * one is ever removed.
 */

import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/support-link.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/lib/support-link.js')>();
  const NONE = Object.freeze({ 5: null, 10: null, 17: null, 100: null });
  return {
    ...real,
    SUPPORT_AMOUNT_LINKS: NONE,
    supportAmountUrl: (amount: number, placement: string, opts: { medium?: 'site' | 'email' | 'github'; links?: Record<number, string | null> } = {}) =>
      real.supportAmountUrl(amount, placement, { ...opts, links: opts.links ?? NONE }),
  };
});

import { CoverADay } from '../src/app/features/CoverADay';
import { resetSupportStatus } from '../src/app/state/support-status';
import { coverButtonHref, parseSupportStatus, supportLadder, supportStatusFromRows } from '../src/lib/cover-a-day.js';
import { supportUrl } from '../src/lib/support-link.js';

const NOW = Date.parse('2026-11-10T18:00:00Z');
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
  resetSupportStatus();
  statusBody = { configured: false };
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  resetSupportStatus();
});

describe('no fixed-amount links set', () => {
  it('the lib offers no ladder, and a day button goes to the any-amount link', () => {
    expect(supportLadder('about')).toBeNull();
    const open = parseSupportStatus(supportStatusFromRows([], NOW), NOW);
    expect(open.configured).toBe(true);
    expect(coverButtonHref(open, 'about')).toBe(supportUrl('about'));
  });

  it('About: no ladder; the day button still names the day, on the any-amount link', async () => {
    statusBody = supportStatusFromRows([], NOW);
    render(<CoverADay active />);
    await flush();
    expect(document.querySelector('[data-support-ladder]')).toBeNull();
    const button = document.querySelector<HTMLAnchorElement>('a[data-support="about"]')!;
    expect(button.textContent).toBe('Cover today · $17');
    expect(button.getAttribute('href')).toBe(supportUrl('about'));
    expect(screen.getByText('You can add a name at checkout to show on the day you cover.')).toBeTruthy();
  });

  it('About, status unknown: just "Help cover a day"', async () => {
    render(<CoverADay active />);
    await flush();
    expect(document.querySelector('[data-support-ladder]')).toBeNull();
    expect([...document.querySelectorAll('a[data-support]')].map((a) => [a.textContent, a.getAttribute('data-support')])).toEqual([
      ['Help cover a day', 'about'],
    ]);
  });
});
