// @vitest-environment jsdom
/**
 * The deep-use EMAIL ask (Oct 28 2026), with the real store, the real trigger, the real
 * latch, the real donation prompt, strip and Radix waitlist dialog, and a stubbed `fetch`
 * so the signup's POST body is the one the browser would send:
 *   1. on an email visit the "Stay in the loop" dialog opens by itself after a pause —
 *      and only when `donatePromptMayOpen` allows: never mid-scroll, never over another
 *      dialog, never into a hidden tab;
 *   2. it does not raise the keyboard (focus goes to the dialog, not the email field);
 *   3. a signup is sent with `source: 'deep-use'`; closing without one writes the 30-day
 *      record; `email_prompt` reports shown / submit / later;
 *   4. one ask per visit: whichever ask the latch picked, the others stay down;
 *   5. a visitor who has given an email is never asked, and a broken store asks nothing.
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const track = vi.hoisted(() => vi.fn());
vi.mock('../src/lib/track.js', () => ({ track }));

import DonatePrompt from '../src/app/features/DonatePrompt';
import EmailPrompt from '../src/app/features/EmailPrompt';
import WaitlistDialog from '../src/app/features/WaitlistDialog';
import WaitlistStrip from '../src/app/features/WaitlistStrip';
import { T2_SETTLE_MS, deepUseAskThisVisit, resetDeepUseAsk } from '../src/app/state/deep-use';
import { markWaitlistSubmitted, resetEngagement, useEngagement } from '../src/app/state/engagement';
import { STORAGE_KEYS } from '../src/app/state/storage';
import { UiProvider, useUi } from '../src/app/state/ui';
import { DONATE_PROMPT_STORAGE_KEY, DONATE_QUIET_MS, donatePromptRecord } from '../src/lib/donate-prompt.js';
import { EMAIL_PROMPT_STORAGE_KEY, parseEmailPromptRecord } from '../src/lib/email-prompt.js';
import { TRIGGER_TIME_MS } from '../src/lib/engagement.js';

const DAY = 24 * 60 * 60 * 1000;
const EMAIL = 0.61;
const DONATE = 0.59;

const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
  status: 200,
  json: async () => ({ success: true }),
}));

let source = '';
function Probe() {
  source = useEngagement().waitlistSource;
  return null;
}

function tree(extra: React.ReactNode = null) {
  return (
    <UiProvider>
      <button type="button" id="content">
        a flight row
      </button>
      {extra}
      <Probe />
      <WaitlistStrip />
      <WaitlistDialog />
      <DonatePrompt />
      <EmailPrompt />
    </UiProvider>
  );
}

const mount = (extra: React.ReactNode = null) => render(tree(extra));

const emailDialog = () => screen.queryByRole('dialog', { name: /Stay in the loop/ });
const donateDialog = () => screen.queryByRole('dialog', { name: 'Keep The Blue Board going' });
const strip = () => screen.queryByRole('button', { name: 'Get updates' });
const emailEvents = () => track.mock.calls.filter(([name]) => name === 'email_prompt').map(([, data]) => data.action);

function reachDeepUse() {
  act(() => vi.advanceTimersByTime(TRIGGER_TIME_MS as number));
}

/** The pause the asks wait for, plus one poll and Radix's open. */
function pause() {
  act(() => vi.advanceTimersByTime(DONATE_QUIET_MS + 1000));
  act(() => vi.advanceTimersByTime(0));
}

async function flush() {
  for (let i = 0; i < 6; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function seedDonateQuiet() {
  localStorage.setItem(DONATE_PROMPT_STORAGE_KEY, donatePromptRecord('later', Date.now() - 3 * DAY));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', fetchMock);
  localStorage.clear();
  resetDeepUseAsk(() => EMAIL);
  resetEngagement();
  track.mockClear();
  fetchMock.mockClear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetDeepUseAsk();
  resetEngagement();
  localStorage.clear();
});

describe('EmailPrompt — when it opens', () => {
  it('uses its own storage key', () => {
    expect(STORAGE_KEYS.emailPrompt).toBe(EMAIL_PROMPT_STORAGE_KEY);
  });

  it('on an email visit, opens the waitlist dialog after the trigger and a pause — no donate prompt, no strip', () => {
    mount();
    act(() => vi.advanceTimersByTime((TRIGGER_TIME_MS as number) - 1000));
    expect(emailDialog()).toBeNull();
    reachDeepUse();
    act(() => vi.advanceTimersByTime(DONATE_QUIET_MS - 1000));
    expect(emailDialog()).toBeNull();
    pause();
    expect(emailDialog()).not.toBeNull();
    expect(donateDialog()).toBeNull();
    expect(strip()).toBeNull();
    expect(source).toBe('deep-use');
    expect(emailEvents()).toEqual(['shown']);
  });

  it('keeps the keyboard down: focus goes to the dialog, not the email field', () => {
    mount();
    reachDeepUse();
    pause();
    expect(document.activeElement).toBe(emailDialog());
    expect(document.activeElement?.id).not.toBe('waitlist-email');
  });

  it('T2 counts too: twenty taps, a settle, then the pause', () => {
    mount();
    const row = document.getElementById('content')!;
    for (let i = 0; i < 20; i += 1) act(() => row.click());
    act(() => vi.advanceTimersByTime(T2_SETTLE_MS));
    pause();
    expect(emailDialog()).not.toBeNull();
  });

  it('keeps waiting while the visitor is still scrolling or tapping', () => {
    mount();
    reachDeepUse();
    for (let i = 0; i < 5; i += 1) {
      act(() => vi.advanceTimersByTime(DONATE_QUIET_MS - 1000));
      act(() => {
        window.dispatchEvent(new Event('scroll'));
      });
    }
    expect(emailDialog()).toBeNull();
    pause();
    expect(emailDialog()).not.toBeNull();
  });

  it('never opens over another dialog, and opens once it has gone', () => {
    const view = mount(<div role="dialog" aria-label="Flight UA1" />);
    reachDeepUse();
    pause();
    act(() => vi.advanceTimersByTime(60_000));
    expect(emailDialog()).toBeNull();
    view.rerender(tree(null));
    pause();
    expect(emailDialog()).not.toBeNull();
  });

  it('never opens into a hidden tab, and opens once the tab is visible again', () => {
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    mount();
    reachDeepUse();
    pause();
    act(() => vi.advanceTimersByTime(60_000));
    expect(emailDialog()).toBeNull();
    visibility.mockReturnValue('visible');
    pause();
    expect(emailDialog()).not.toBeNull();
  });
});

describe('EmailPrompt — answers', () => {
  it('a signup is POSTed with source "deep-use", reports submit, and never writes the "not now" record', async () => {
    mount();
    reachDeepUse();
    pause();
    const email = document.getElementById('waitlist-email') as HTMLInputElement;
    fireEvent.change(email, { target: { value: 'flyer@example.com' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Stay in the Loop' }));
    });
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/waitlist');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ email: 'flyer@example.com', source: 'deep-use' });
    expect(screen.getByText(/You.re on the list/)).toBeTruthy();
    expect(localStorage.getItem('bb_waitlist_submitted')).toBe('true');

    // Closing the "You're on the list" card is not a "no".
    act(() => fireEvent.keyDown(document.activeElement!, { key: 'Escape' }));
    expect(emailDialog()).toBeNull();
    expect(localStorage.getItem(EMAIL_PROMPT_STORAGE_KEY)).toBeNull();
    expect(emailEvents()).toEqual(['shown', 'submit']);
    expect(source).toBe('popup');
  });

  it('closing without a signup writes the 30-day record and the shared dismissal, and reports later', () => {
    mount();
    reachDeepUse();
    pause();
    const before = Date.now();
    act(() => fireEvent.keyDown(document.activeElement!, { key: 'Escape' }));
    expect(emailDialog()).toBeNull();
    const record = parseEmailPromptRecord(localStorage.getItem(EMAIL_PROMPT_STORAGE_KEY));
    expect(record?.outcome).toBe('later');
    expect(record!.at).toBeGreaterThanOrEqual(before);
    expect(Number(localStorage.getItem('bb_waitlist_dismissed'))).toBeGreaterThanOrEqual(before);
    expect(emailEvents()).toEqual(['shown', 'later']);
    expect(fetchMock).not.toHaveBeenCalled();
    // The dialog's source goes back to the link's for any later open.
    expect(source).toBe('popup');
  });

  it('the ✕ button counts as "not now" too', () => {
    mount();
    reachDeepUse();
    pause();
    act(() => fireEvent.click(screen.getByRole('button', { name: 'Close' })));
    expect(emailDialog()).toBeNull();
    expect(parseEmailPromptRecord(localStorage.getItem(EMAIL_PROMPT_STORAGE_KEY))?.outcome).toBe('later');
    expect(emailEvents()).toEqual(['shown', 'later']);
  });

  it('a strip-opened dialog reports no email_prompt events and writes no email-prompt record', async () => {
    localStorage.setItem(EMAIL_PROMPT_STORAGE_KEY, `later:${Date.now()}`);
    seedDonateQuiet();
    mount();
    reachDeepUse();
    act(() => fireEvent.click(strip()!));
    act(() => vi.advanceTimersByTime(0));
    expect(emailDialog()).not.toBeNull();
    expect(document.activeElement?.id).toBe('waitlist-email');
    act(() => fireEvent.keyDown(document.activeElement!, { key: 'Escape' }));
    expect(emailEvents()).toEqual([]);
  });
});

describe('one deep-use ask per visit (the latch)', () => {
  it('rolls the dice once, however often the ask is read', () => {
    const dice = vi.fn(() => EMAIL);
    resetDeepUseAsk(dice);
    mount();
    reachDeepUse();
    pause();
    act(() => vi.advanceTimersByTime(60_000));
    deepUseAskThisVisit();
    deepUseAskThisVisit();
    expect(dice).toHaveBeenCalledTimes(1);
  });

  it('after the email ask is answered, neither the donate prompt nor the strip follows this visit', () => {
    mount();
    reachDeepUse();
    pause();
    act(() => fireEvent.keyDown(document.activeElement!, { key: 'Escape' }));
    const row = document.getElementById('content')!;
    for (let i = 0; i < 30; i += 1) act(() => row.click());
    act(() => vi.advanceTimersByTime(TRIGGER_TIME_MS as number));
    pause();
    expect(emailDialog()).toBeNull();
    expect(donateDialog()).toBeNull();
    expect(strip()).toBeNull();
    expect(emailEvents()).toEqual(['shown', 'later']);
  });

  it('on a donate visit (0.59) the donation prompt opens and the email dialog never follows', () => {
    resetDeepUseAsk(() => DONATE);
    mount();
    reachDeepUse();
    pause();
    expect(donateDialog()).not.toBeNull();
    expect(emailDialog()).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Maybe later' }));
    act(() => vi.advanceTimersByTime(TRIGGER_TIME_MS as number));
    pause();
    expect(emailDialog()).toBeNull();
    expect(strip()).toBeNull();
    expect(emailEvents()).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('with the donate prompt cooling down, email is the ask whatever the dice say', () => {
    resetDeepUseAsk(() => 0);
    seedDonateQuiet();
    mount();
    reachDeepUse();
    pause();
    expect(emailDialog()).not.toBeNull();
    expect(donateDialog()).toBeNull();
  });

  it('with the email ask cooling down, donate is the ask whatever the dice say', () => {
    resetDeepUseAsk(() => 0.99);
    localStorage.setItem(EMAIL_PROMPT_STORAGE_KEY, `later:${Date.now() - 3 * DAY}`);
    mount();
    reachDeepUse();
    pause();
    expect(donateDialog()).not.toBeNull();
    expect(emailDialog()).toBeNull();
  });
});

describe('who never gets the email ask', () => {
  it('a visitor who already gave an email (stored): donate if it is eligible, otherwise nothing', () => {
    localStorage.setItem('bb_waitlist_submitted', 'true');
    resetDeepUseAsk(() => 0.99);
    mount();
    reachDeepUse();
    pause();
    expect(emailDialog()).toBeNull();
    expect(donateDialog()).not.toBeNull();

    cleanup();
    resetDeepUseAsk(() => 0.99);
    resetEngagement();
    seedDonateQuiet();
    mount();
    reachDeepUse();
    pause();
    act(() => vi.advanceTimersByTime(60_000));
    expect(emailDialog()).toBeNull();
    expect(donateDialog()).toBeNull();
    expect(strip()).toBeNull();
    expect(emailEvents()).toEqual([]);
  });

  it('a visitor who signed up earlier this visit (in memory only) is not asked', () => {
    seedDonateQuiet();
    mount();
    act(() => markWaitlistSubmitted());
    reachDeepUse();
    pause();
    // The latch itself skips email (the dialog's own submitted guard is a second line).
    expect(deepUseAskThisVisit()).toBe('waitlist');
    expect(emailDialog()).toBeNull();
    expect(emailEvents()).toEqual([]);
  });

  it('answering a link-opened dialog after the trigger fired ends the email ask for this visit', async () => {
    // A `?waitlist=1` arrival: the dialog is up (as the link opens it) when the trigger fires,
    // so the latch picks email; the visitor then answers the dialog they came for.
    for (const answer of ['submit', 'close'] as const) {
      cleanup();
      resetDeepUseAsk(() => EMAIL);
      resetEngagement();
      localStorage.clear();
      track.mockClear();
      let openLink: () => void = () => {};
      function LinkOpener() {
        const { setWaitlistOpen } = useUi();
        openLink = () => setWaitlistOpen(true);
        return null;
      }
      mount(<LinkOpener />);
      act(() => openLink());
      act(() => vi.advanceTimersByTime(0));
      expect(emailDialog()).not.toBeNull();
      reachDeepUse();
      expect(deepUseAskThisVisit()).toBe('email');
      if (answer === 'submit') {
        fireEvent.change(document.getElementById('waitlist-email')!, { target: { value: 'flyer@example.com' } });
        await act(async () => {
          fireEvent.click(screen.getByRole('button', { name: 'Stay in the Loop' }));
        });
        await flush();
        expect(JSON.parse(String(fetchMock.mock.calls.at(-1)?.[1]?.body)).source).toBe('popup');
      }
      act(() => fireEvent.keyDown(document.activeElement!, { key: 'Escape' }));
      expect(emailDialog()).toBeNull();
      pause();
      act(() => vi.advanceTimersByTime(60_000));
      expect(emailDialog()).toBeNull();
      expect(emailEvents()).toEqual([]);
    }
  });

  it('a store that throws asks nothing at all (fails closed)', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    mount();
    reachDeepUse();
    pause();
    act(() => vi.advanceTimersByTime(60_000));
    expect(emailDialog()).toBeNull();
    expect(donateDialog()).toBeNull();
    expect(strip()).toBeNull();
  });
});
