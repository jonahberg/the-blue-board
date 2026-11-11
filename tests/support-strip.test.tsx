// @vitest-environment jsdom
/**
 * The deep-use support ask as a STRIP (Nov 2026; it replaced the Oct 2026 donation modal), with
 * the real store, trigger, latch, email strip and UI provider, and a stubbed /api/support-status:
 *   1. same moment, same latch, same quiet periods and key, same `donate_prompt` events and
 *      `deep-use-prompt` label as the modal had;
 *   2. its words are true or absent: not covered / covered / unknown, and no strip at all when
 *      every day of the month is covered;
 *   3. the personal count: counted from flight-panel opens, deduped per page load, shown only
 *      from five up, never sent to analytics;
 *   4. quiet: inline, no live region, a plain "Dismiss", buttons outside the click counter.
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const track = vi.hoisted(() => vi.fn());
vi.mock('../src/lib/track.js', () => ({ track }));

import SupportStrip from '../src/app/features/SupportStrip';
import WaitlistStrip from '../src/app/features/WaitlistStrip';
import { T2_SETTLE_MS, resetDeepUseAsk } from '../src/app/state/deep-use';
import { resetEngagement } from '../src/app/state/engagement';
import { STORAGE_KEYS } from '../src/app/state/storage';
import { resetSupportStatus } from '../src/app/state/support-status';
import { UiProvider, useUi } from '../src/app/state/ui';
import type { Selection } from '../src/app/state/ui';
import { supportStatusFromRows } from '../src/lib/cover-a-day.js';
import {
  DONATE_LATER_COOLDOWN_MS,
  DONATE_PROMPT_STORAGE_KEY,
  DONATE_TAPPED_COOLDOWN_MS,
  donatePromptRecord,
  parseDonatePromptRecord,
} from '../src/lib/donate-prompt.js';
import { EMAIL_PROMPT_STORAGE_KEY, emailPromptRecord } from '../src/lib/email-prompt.js';
import { TRIGGER_TIME_MS } from '../src/lib/engagement.js';
import { supportAmountUrl, supportUrl } from '../src/lib/support-link.js';
import { FLIGHT_COUNT_STORAGE_KEY, localMonthKey } from '../src/lib/usage-count.js';

const DAY = 24 * 60 * 60 * 1000;
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
let statusOk = true;
const fetchMock = vi.fn(async (_url: string) => ({ ok: statusOk, status: statusOk ? 200 : 500, json: async () => statusBody }));
const statusFetches = () => fetchMock.mock.calls.filter(([url]) => url === '/api/support-status').length;

let selectFlight: (s: Selection) => void = () => {};
function SelectProbe() {
  const { select } = useUi();
  useEffect(() => {
    selectFlight = select;
  }, [select]);
  return null;
}

function tree() {
  return (
    <UiProvider>
      <button type="button" id="content">
        a flight row
      </button>
      <SelectProbe />
      <div data-testid="slot">
        <SupportStrip />
        <WaitlistStrip />
      </div>
    </UiProvider>
  );
}

async function flush() {
  for (let i = 0; i < 6; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

/** T1, then let the status request resolve. */
async function reachDeepUse() {
  act(() => vi.advanceTimersByTime(TRIGGER_TIME_MS as number));
  await flush();
}

/** The strip's button. Its words name the day it would cover, so find it by its placement. */
const ask = () => document.querySelector<HTMLAnchorElement>('a[data-support="deep-use-prompt"]');
const emailStrip = () => screen.queryByRole('button', { name: 'Get updates' });
const stripText = () => ask()?.closest('[data-no-engagement]')?.querySelector('p')?.textContent ?? '';
/** What a phone shows: the paragraph without its sm-only part. */
const phoneText = () =>
  [...(ask()?.closest('[data-no-engagement]')?.querySelector('p')?.children ?? [])]
    .filter((el) => !el.classList.contains('hidden'))
    .map((el) => el.textContent)
    .join('');
/** What a wide screen shows: the paragraph without its phone-only part. */
const wideText = () =>
  [...(ask()?.closest('[data-no-engagement]')?.querySelector('p')?.children ?? [])]
    .filter((el) => !el.classList.contains('sm:hidden'))
    .map((el) => el.textContent)
    .join('');
const donateEvents = () => track.mock.calls.filter(([name]) => name === 'donate_prompt').map(([, data]) => data.action);
const stored = () => parseDonatePromptRecord(localStorage.getItem(DONATE_PROMPT_STORAGE_KEY));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.stubGlobal('fetch', fetchMock);
  localStorage.clear();
  resetDeepUseAsk(() => 0);
  resetEngagement();
  resetSupportStatus();
  track.mockClear();
  fetchMock.mockClear();
  statusBody = { configured: false };
  statusOk = true;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  resetDeepUseAsk();
  resetEngagement();
  resetSupportStatus();
  localStorage.clear();
});

describe('SupportStrip — the moment and the manners it kept', () => {
  it('appears for a heavy user on the deep-use trigger, instead of the email strip, with the old label and event', async () => {
    render(tree());
    act(() => vi.advanceTimersByTime((TRIGGER_TIME_MS as number) - 1000));
    await flush();
    expect(ask()).toBeNull();
    // Nothing is fetched on page load: only once the ask is due.
    expect(statusFetches()).toBe(0);
    await reachDeepUse();
    expect(statusFetches()).toBe(1);
    const link = ask()!;
    expect(link).not.toBeNull();
    expect(link.getAttribute('href')).toBe(supportUrl('deep-use-prompt'));
    expect(link.getAttribute('data-support')).toBe('deep-use-prompt');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(emailStrip()).toBeNull();
    expect(donateEvents()).toEqual(['shown']);
    // It is not a dialog and adds no live region.
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.querySelector('[aria-live], [role="status"], [role="alert"]')).toBeNull();
  });

  it('T2 counts too: twenty taps and a settle', async () => {
    render(tree());
    const row = document.getElementById('content')!;
    for (let i = 0; i < 20; i += 1) act(() => row.click());
    act(() => vi.advanceTimersByTime(T2_SETTLE_MS));
    await flush();
    expect(ask()).not.toBeNull();
  });

  it('a dismiss is a plain "Dismiss": it stores `later` (30 days), reports later, and nothing follows this visit', async () => {
    render(tree());
    await reachDeepUse();
    const dismiss = screen.getByRole('button', { name: 'Dismiss' });
    fireEvent.click(dismiss);
    expect(ask()).toBeNull();
    expect(stored()?.outcome).toBe('later');
    expect(DONATE_LATER_COOLDOWN_MS).toBe(30 * DAY);
    expect(donateEvents()).toEqual(['shown', 'later']);
    act(() => vi.advanceTimersByTime(TRIGGER_TIME_MS as number));
    await flush();
    expect(ask()).toBeNull();
    expect(emailStrip()).toBeNull();
  });

  it('the button stores `donate` (90 days) and reports donate', async () => {
    render(tree());
    await reachDeepUse();
    fireEvent.click(ask()!);
    expect(ask()).toBeNull();
    expect(stored()?.outcome).toBe('donate');
    expect(DONATE_TAPPED_COOLDOWN_MS).toBe(90 * DAY);
    expect(donateEvents()).toEqual(['shown', 'donate']);
  });

  it('honours the modal\'s quiet periods already stored under bb_donate_prompt', async () => {
    expect(STORAGE_KEYS.donatePrompt).toBe(DONATE_PROMPT_STORAGE_KEY);
    localStorage.setItem(DONATE_PROMPT_STORAGE_KEY, donatePromptRecord('donate', Date.now() - 60 * DAY));
    localStorage.setItem(EMAIL_PROMPT_STORAGE_KEY, emailPromptRecord(Date.now() - 3 * DAY));
    render(tree());
    await reachDeepUse();
    expect(ask()).toBeNull();
    expect(emailStrip()).not.toBeNull();
    expect(donateEvents()).toEqual([]);
  });

  it('keeps its buttons out of the click counter that summons the asks', async () => {
    render(tree());
    await reachDeepUse();
    expect(ask()!.closest('[data-no-engagement]')).not.toBeNull();
  });
});

describe('SupportStrip — the words are true or absent', () => {
  it('unknown status (no webhook yet, or the request fails): the core line, "Help cover a day", no coverage claim', async () => {
    statusOk = false;
    render(tree());
    await reachDeepUse();
    expect(wideText()).toBe('The Blue Board is free because flyers cover it, one day at a time. $17 covers a full day; any amount helps.');
    expect(phoneText()).toBe('Free because flyers cover it, a day at a time.');
    expect(stripText()).not.toMatch(/covered/);
    expect(ask()!.textContent).toBe('Help cover a day');
    expect(ask()!.getAttribute('href')).toBe(supportUrl('deep-use-prompt'));
  });

  it('today not covered (an earlier day covered is not today): "Cover today"', async () => {
    statusBody = supportStatusFromRows([pay(17)], NOW);
    render(tree());
    await reachDeepUse();
    expect(wideText()).toBe('The Blue Board is free because flyers cover it, one day at a time. No one has covered today yet.');
    expect(phoneText()).toBe('No one has covered today yet.');
    expect(ask()!.textContent).toBe('Cover today · $17');
    expect(ask()!.getAttribute('href')).toBe(supportAmountUrl(17, 'deep-use-prompt'));
    expect(ask()!.getAttribute('data-support')).toBe('deep-use-prompt');
  });

  it('today covered: a thank-you and "Cover tomorrow"', async () => {
    statusBody = supportStatusFromRows([pay(17, { display_name: 'Dana R.', paid_at: '2026-11-10T15:00:00Z' })], NOW);
    render(tree());
    await reachDeepUse();
    expect(wideText()).toBe('Today is covered, thanks to Dana R. Tomorrow is still open.');
    expect(phoneText()).toBe('Today is covered. Tomorrow is still open.');
    expect(ask()!.textContent).toBe('Cover tomorrow · $17');
    expect(ask()!.getAttribute('href')).toBe(supportAmountUrl(17, 'deep-use-prompt'));
  });

  it('today and tomorrow covered: names the next open day, "Cover Nov 13"', async () => {
    statusBody = supportStatusFromRows([pay(17 * 3, { paid_at: '2026-11-10T15:00:00Z' })], NOW);
    render(tree());
    await reachDeepUse();
    expect(wideText()).toBe('Today is covered, thanks to a supporter. The next open day is Nov 13.');
    expect(phoneText()).toBe('Covered through Nov 12.');
    expect(ask()!.textContent).toBe('Cover Nov 13 · $17');
    expect(ask()!.getAttribute('href')).toBe(supportAmountUrl(17, 'deep-use-prompt'));
  });

  it('today and the next 14 days covered: no strip, and no `shown`', async () => {
    statusBody = supportStatusFromRows([pay(17 * 15, { paid_at: '2026-11-10T15:00:00Z' })], NOW);
    render(tree());
    await reachDeepUse();
    expect(ask()).toBeNull();
    expect(donateEvents()).toEqual([]);
  });

  it('a cached answer for another Central date is not believed', async () => {
    statusBody = supportStatusFromRows([pay(17 * 10)], NOW - DAY);
    render(tree());
    await reachDeepUse();
    expect(stripText()).toContain('$17 covers a full day; any amount helps.');
    expect(stripText()).not.toMatch(/covered/);
  });
});

describe('SupportStrip — the personal count', () => {
  const flight = (n: number): Selection => ({ kind: 'ident', ident: `UA${n}` });

  it('counts each new flight opened, once per page load, and leads with it from five up', async () => {
    render(tree());
    for (const n of [1, 2, 3, 4]) act(() => selectFlight(flight(n)));
    act(() => selectFlight(flight(4)));
    act(() => selectFlight(null));
    act(() => selectFlight(flight(4)));
    expect(localStorage.getItem(FLIGHT_COUNT_STORAGE_KEY)).toBe(`${localMonthKey(new Date())}:4`);
    await reachDeepUse();
    expect(stripText()).not.toMatch(/looked up/);
  });

  it('shows "You\'ve looked up N flights here this month." once it is at least five; on a phone, alone', async () => {
    localStorage.setItem(FLIGHT_COUNT_STORAGE_KEY, `${localMonthKey(new Date())}:22`);
    render(tree());
    act(() => selectFlight({ kind: 'ident', ident: 'UA9' }));
    await reachDeepUse();
    expect(stripText()).toMatch(/^You've looked up 23 flights here this month\. /);
    // Phone: the count sentence and the button only, so the strip stays two lines.
    expect(phoneText()).toBe("You've looked up 23 flights here this month.");
  });

  it('never sends the count anywhere', async () => {
    localStorage.setItem(FLIGHT_COUNT_STORAGE_KEY, `${localMonthKey(new Date())}:23`);
    render(tree());
    await reachDeepUse();
    fireEvent.click(ask()!);
    expect(JSON.stringify(track.mock.calls)).not.toMatch(/23|flights|count/);
    expect(JSON.stringify(fetchMock.mock.calls)).not.toMatch(/23|flights/);
  });

  it('ignores last month\'s count', async () => {
    localStorage.setItem(FLIGHT_COUNT_STORAGE_KEY, '2026-10:40');
    render(tree());
    await reachDeepUse();
    expect(stripText()).not.toMatch(/looked up/);
  });
});
