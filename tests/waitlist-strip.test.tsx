// @vitest-environment jsdom
/**
 * The passive waitlist ask is a STRIP, not a popup (Oct 2026).
 *
 * T1 (five minutes of use) and T2 (the click threshold) used to open the "Stay in the loop"
 * modal over the board uninvited (phone QA, Oct 3 2026). They now reveal a slim strip in the
 * engagement slot; the dialog opens only when someone asks — the strip's button or
 * `?waitlist=1`. Pinned here with the real store, the real gate and the real Radix dialog:
 *   1. navigation clicks (tabs, nav, dialogs) do not advance the T2 counter;
 *   2. T1 and T2 reveal the strip and open NO dialog;
 *   3. the strip's button opens the dialog (email focused — they asked) and the signup is
 *      sent with `source: 'dashboard'`, while `?waitlist=1` keeps `popup`;
 *   4. dismissing or submitting keeps the strip away for 30 days, reusing the dialog's keys.
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const postWaitlist = vi.hoisted(() => vi.fn(async () => ({ success: true })));
vi.mock('../src/app/data/api', () => ({ postWaitlist }));
vi.mock('../src/lib/track.js', () => ({ track: vi.fn() }));

import { TRIGGER_TIME_MS } from '../src/lib/engagement.js';
import { WAITLIST_STRIP_COOLDOWN_MS, shouldShowWaitlistStrip } from '../src/lib/waitlist-gate.js';
import WaitlistDialog from '../src/app/features/WaitlistDialog';
import WaitlistStrip, { T2_SETTLE_MS } from '../src/app/features/WaitlistStrip';
import { countsAsEngagement, resetEngagement, useEngagement } from '../src/app/state/engagement';
import { UiProvider, useUi } from '../src/app/state/ui';
import type { UiValue } from '../src/app/state/ui';

const DAY = 24 * 60 * 60 * 1000;

let ui: UiValue | null = null;
let clicks = 0;
function Probe() {
  ui = useUi();
  clicks = useEngagement().clicks;
  return null;
}

function mount() {
  return render(
    <UiProvider>
      <nav aria-label="Dashboard navigation">
        <button type="button" role="tab" id="tab">
          Schedule
        </button>
      </nav>
      <button type="button" id="content">
        a flight row
      </button>
      <Probe />
      <WaitlistStrip />
      <WaitlistDialog />
    </UiProvider>,
  );
}

function click(id: string, times = 1) {
  const el = document.getElementById(id)!;
  for (let i = 0; i < times; i += 1) act(() => el.click());
}

const dialogOpen = () => document.querySelector('[role="dialog"]') !== null;
const strip = () => screen.queryByRole('button', { name: 'Get updates' });

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  resetEngagement();
  postWaitlist.mockClear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  resetEngagement();
  localStorage.clear();
  ui = null;
});

describe('countsAsEngagement', () => {
  it('rejects tab, nav and dialog clicks and accepts content clicks', () => {
    document.body.innerHTML = `
      <nav><a id="n">x</a></nav><div role="tablist"><button role="tab" id="t">t</button></div>
      <div role="dialog"><button id="d">ok</button></div><div data-no-engagement><i id="o"></i></div>
      <main><button id="c">row</button></main>`;
    for (const id of ['n', 't', 'd', 'o']) expect(countsAsEngagement(document.getElementById(id))).toBe(false);
    expect(countsAsEngagement(document.getElementById('c'))).toBe(true);
    expect(countsAsEngagement(null)).toBe(true);
    document.body.innerHTML = '';
  });
});

describe('shouldShowWaitlistStrip', () => {
  const store = (entries: Record<string, string>) => ({ getItem: (key: string) => entries[key] ?? null });
  const now = 1_800_000_000_000;

  it('stays down until T1 or T2 has fired', () => {
    expect(shouldShowWaitlistStrip(store({}), { triggered: false, now })).toBe(false);
    expect(shouldShowWaitlistStrip(store({}), { triggered: true, now })).toBe(true);
  });

  it('honours a dismissal of either surface for 30 days, not the modal’s 7', () => {
    const at = (daysAgo: number) => store({ bb_waitlist_dismissed: String(now - daysAgo * DAY) });
    expect(WAITLIST_STRIP_COOLDOWN_MS).toBe(30 * DAY);
    expect(shouldShowWaitlistStrip(at(8), { triggered: true, now })).toBe(false);
    expect(shouldShowWaitlistStrip(at(29), { triggered: true, now })).toBe(false);
    expect(shouldShowWaitlistStrip(at(31), { triggered: true, now })).toBe(true);
  });

  it('never shows to someone who has signed up, from storage or from this session', () => {
    expect(shouldShowWaitlistStrip(store({ bb_waitlist_submitted: 'true' }), { triggered: true, now })).toBe(false);
    expect(shouldShowWaitlistStrip(store({}), { triggered: true, submitted: true, now })).toBe(false);
  });

  it('fails closed without a working store (nowhere to remember a no)', () => {
    expect(shouldShowWaitlistStrip(null, { triggered: true, now })).toBe(false);
    const throwing = { getItem: () => { throw new Error('denied'); } };
    expect(shouldShowWaitlistStrip(throwing, { triggered: true, now })).toBe(false);
  });
});

describe('WaitlistStrip passive triggers', () => {
  it('T2: tab switches do not count towards the threshold', () => {
    mount();
    click('tab', 25);
    expect(clicks).toBe(0);
    act(() => vi.advanceTimersByTime(T2_SETTLE_MS * 2));
    expect(strip()).toBeNull();
    expect(dialogOpen()).toBe(false);
  });

  it('T2: waits for the clicking to pause, then shows the strip — never the modal', () => {
    mount();
    // A first-time visitor's threshold is 20 (bb-visited unset).
    click('content', 20);
    expect(clicks).toBe(20);
    act(() => vi.advanceTimersByTime(T2_SETTLE_MS - 100));
    click('content');
    act(() => vi.advanceTimersByTime(T2_SETTLE_MS - 100));
    expect(strip()).toBeNull();
    act(() => vi.advanceTimersByTime(200));
    expect(strip()).not.toBeNull();
    expect(dialogOpen()).toBe(false);
    // The strip's own controls never feed the counter that summoned it.
    const before = clicks;
    act(() => strip()!.closest('[data-no-engagement]')!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(clicks).toBe(before);
  });

  it('T1: five minutes in, the strip appears and nothing modal opens', () => {
    mount();
    act(() => vi.advanceTimersByTime((TRIGGER_TIME_MS as number) - 1000));
    expect(strip()).toBeNull();
    act(() => vi.advanceTimersByTime(1000));
    expect(strip()).not.toBeNull();
    expect(screen.getByText('Stay in the loop')).toBeTruthy();
    expect(dialogOpen()).toBe(false);
  });

  it('"Get updates" opens the dialog with the email focused, and the signup says it came from the strip', async () => {
    mount();
    act(() => vi.advanceTimersByTime(TRIGGER_TIME_MS as number));
    act(() => fireEvent.click(strip()!));
    act(() => vi.advanceTimersByTime(0));
    expect(dialogOpen()).toBe(true);
    const email = document.getElementById('waitlist-email') as HTMLInputElement;
    expect(document.activeElement).toBe(email);
    fireEvent.change(email, { target: { value: 'flyer@example.com' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Stay in the Loop' }));
    });
    expect(postWaitlist).toHaveBeenCalledWith(expect.objectContaining({ source: 'dashboard' }));
    expect(localStorage.getItem('bb_waitlist_submitted')).toBe('true');
    // Signed up: the strip is gone for good.
    expect(strip()).toBeNull();
  });

  it('dismissing the strip writes the shared dismissal key and keeps it away', () => {
    mount();
    act(() => vi.advanceTimersByTime(TRIGGER_TIME_MS as number));
    const before = Date.now();
    act(() => fireEvent.click(screen.getByRole('button', { name: 'Dismiss the updates sign-up' })));
    expect(strip()).toBeNull();
    expect(Number(localStorage.getItem('bb_waitlist_dismissed'))).toBeGreaterThanOrEqual(before);
    cleanup();
    resetEngagement();
    mount();
    act(() => vi.advanceTimersByTime(TRIGGER_TIME_MS as number));
    expect(strip()).toBeNull();
  });

  it('closing the dialog opened from the strip takes the strip away too', () => {
    mount();
    act(() => vi.advanceTimersByTime(TRIGGER_TIME_MS as number));
    act(() => fireEvent.click(strip()!));
    act(() => vi.advanceTimersByTime(0));
    act(() => fireEvent.keyDown(document.activeElement!, { key: 'Escape' }));
    expect(dialogOpen()).toBe(false);
    expect(strip()).toBeNull();
  });
});

describe('the explicit ?waitlist=1 path still opens the dialog', () => {
  it('keeps autofocus on the email field and the historical popup source', async () => {
    mount();
    act(() => ui!.setWaitlistOpen(true));
    act(() => vi.advanceTimersByTime(0));
    expect(dialogOpen()).toBe(true);
    expect(document.activeElement?.id).toBe('waitlist-email');
    fireEvent.change(document.activeElement!, { target: { value: 'flyer@example.com' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Stay in the Loop' }));
    });
    expect(postWaitlist).toHaveBeenCalledWith(expect.objectContaining({ source: 'popup' }));
  });
});
