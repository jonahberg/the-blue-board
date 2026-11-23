// @vitest-environment jsdom
/**
 * The engagement store's lifecycle (src/app/state/engagement.tsx): the module-level store behind
 * the waitlist asks, read through useEngagement(). Its header names an order that matters, and
 * this file pins it against jsdom's localStorage, real React subscribers and the real
 * WaitlistDialog:
 *
 *  - initialisation: the click threshold is read from storage BEFORE recordVisit() marks the
 *    visit (a first-timer gets 20, not 30); it runs once per page however many surfaces call
 *    initEngagement(); a store that throws, or no store at all, fails closed (no threshold can be
 *    reached, so no passive ask);
 *  - subscription: a subscriber re-renders when the store changes and not otherwise (a change that
 *    changes nothing keeps the same snapshot object, which useSyncExternalStore relies on); the
 *    click listener is attached once and removed by resetEngagement();
 *  - dismissal: closing the waitlist dialog reads which surface opened it BEFORE resetting the
 *    source, keeps the ask marked as shown for the session, writes the dismissal, and leaves a
 *    signup alone.
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const postWaitlist = vi.hoisted(() => vi.fn(async () => ({ success: true })));
vi.mock('../src/app/data/api', () => ({ postWaitlist }));
vi.mock('../src/lib/track.js', () => ({ track: vi.fn() }));

import WaitlistDialog from '../src/app/features/WaitlistDialog';
import {
  engagementSnapshot,
  initEngagement,
  markWaitlistShown,
  resetEngagement,
  setWaitlistSource,
  useEngagement,
} from '../src/app/state/engagement';
import type { EngagementState } from '../src/app/state/engagement';
import { UiProvider, useUi } from '../src/app/state/ui';
import type { UiValue } from '../src/app/state/ui';

/** Every value a subscriber rendered with, in order. */
const renders: EngagementState[] = [];
function Subscriber() {
  renders.push(useEngagement());
  return null;
}

const last = () => renders[renders.length - 1];

beforeEach(() => {
  localStorage.clear();
  resetEngagement();
  renders.length = 0;
  postWaitlist.mockClear();
  window.history.replaceState(null, '', '/');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  resetEngagement();
  localStorage.clear();
});

describe('initEngagement: what it reads, and in what order', () => {
  it('nothing is read before it runs: not ready, the defaults, no visit recorded', () => {
    expect(engagementSnapshot()).toEqual({
      clicks: 0,
      triggerClicks: 30,
      shownThisSession: false,
      submitted: false,
      ready: false,
      waitlistSource: 'popup',
    });
    expect(localStorage.getItem('bb-visited')).toBeNull();
  });

  it('a first-time visitor: the threshold is read before the visit is recorded, so it is 20', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem');
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    initEngagement();

    expect(engagementSnapshot()).toMatchObject({ ready: true, triggerClicks: 20, submitted: false });
    expect(localStorage.getItem('bb-visited')).toBe('1');
    const firstRead = getItem.mock.calls.findIndex(([key]) => key === 'bb-visited');
    const write = setItem.mock.calls.findIndex(([key]) => key === 'bb-visited');
    expect(firstRead).toBeGreaterThanOrEqual(0);
    expect(write).toBeGreaterThanOrEqual(0);
    expect(getItem.mock.invocationCallOrder[firstRead]).toBeLessThan(setItem.mock.invocationCallOrder[write]);
  });

  it('a returning visitor gets 30, and a signup already in storage is read', () => {
    localStorage.setItem('bb-visited', '1');
    localStorage.setItem('bb_waitlist_submitted', 'true');
    initEngagement();
    expect(engagementSnapshot()).toMatchObject({ ready: true, triggerClicks: 30, submitted: true });
  });

  it('runs once per page: a second call reads nothing, so a first-timer stays at 20', () => {
    initEngagement();
    // The visit is on record now, and a signup lands in storage from somewhere else.
    localStorage.setItem('bb_waitlist_submitted', 'true');
    const getItem = vi.spyOn(Storage.prototype, 'getItem');
    initEngagement();
    expect(getItem).not.toHaveBeenCalled();
    expect(engagementSnapshot()).toMatchObject({ triggerClicks: 20, submitted: false });
  });

  it('a store that throws on read fails closed: ready, with a threshold no click count reaches', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    initEngagement();
    expect(engagementSnapshot()).toMatchObject({
      ready: true,
      triggerClicks: Number.POSITIVE_INFINITY,
      submitted: false,
    });
  });

  it('a store that cannot record the visit fails closed too', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    initEngagement();
    expect(engagementSnapshot()).toMatchObject({ ready: true, triggerClicks: Number.POSITIVE_INFINITY });
  });

  it('no store at all (private mode, SSR) fails closed', () => {
    vi.stubGlobal('localStorage', undefined);
    initEngagement();
    expect(engagementSnapshot()).toMatchObject({
      ready: true,
      triggerClicks: Number.POSITIVE_INFINITY,
      submitted: false,
    });
  });
});

describe('useEngagement: who hears what', () => {
  function Page() {
    return (
      <>
        <Subscriber />
        <button type="button">On the map</button>
        <nav>
          <button type="button">A tab</button>
        </nav>
      </>
    );
  }

  it('a subscriber hears the store become ready and each counted click, and nothing else', () => {
    render(<Page />);
    expect(last().ready).toBe(false);

    act(() => initEngagement());
    expect(last()).toMatchObject({ ready: true, clicks: 0 });

    const before = renders.length;
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'A tab' }));
    });
    // Navigation does not count, and a click that does not count notifies no one.
    expect(renders.length).toBe(before);
    expect(engagementSnapshot().clicks).toBe(0);

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'On the map' }));
    });
    expect(last().clicks).toBe(1);
  });

  it('every surface calls initEngagement() on mount; the click listener is still attached once', () => {
    render(<Page />);
    act(() => {
      initEngagement();
      initEngagement();
      initEngagement();
    });
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'On the map' }));
    });
    expect(engagementSnapshot().clicks).toBe(1);
  });

  it('a change that changes nothing keeps the same snapshot and re-renders no one', () => {
    initEngagement();
    render(<Subscriber />);
    const ready = engagementSnapshot();

    act(() => markWaitlistShown());
    const shown = engagementSnapshot();
    expect(shown).not.toBe(ready);
    expect(last().shownThisSession).toBe(true);

    const count = renders.length;
    act(() => {
      markWaitlistShown();
      setWaitlistSource('popup');
    });
    expect(engagementSnapshot()).toBe(shown);
    expect(renders.length).toBe(count);
  });

  it('resetEngagement() removes the click listener, and a fresh init attaches exactly one', () => {
    render(<Page />);
    const content = screen.getByRole('button', { name: 'On the map' });
    initEngagement();
    fireEvent.click(content);
    expect(engagementSnapshot().clicks).toBe(1);

    resetEngagement();
    fireEvent.click(content);
    expect(engagementSnapshot().clicks).toBe(0);

    initEngagement();
    fireEvent.click(content);
    expect(engagementSnapshot().clicks).toBe(1);
  });

  it('a subscriber mounted later reads the store as it stands', () => {
    initEngagement();
    act(() => setWaitlistSource('dashboard'));
    render(<Subscriber />);
    expect(last()).toMatchObject({ ready: true, waitlistSource: 'dashboard' });
  });
});

describe('dismissing the waitlist dialog: the order of the store writes', () => {
  let ui: UiValue | null = null;
  function Probe() {
    ui = useUi();
    return null;
  }

  async function mountDialog() {
    await act(async () => {
      render(
        <UiProvider>
          <Probe />
          <Subscriber />
          <WaitlistDialog />
        </UiProvider>,
      );
    });
  }

  async function openFrom(source: 'popup' | 'dashboard' | 'deep-use') {
    // The strip and the deep-use ask both name themselves first, then open (WaitlistStrip.tsx,
    // EmailPrompt.tsx); the `?waitlist=1` link only opens.
    act(() => setWaitlistSource(source));
    await act(async () => ui!.setWaitlistOpen(true));
    expect(screen.getByRole('dialog')).toBeTruthy();
  }

  async function closeWithX() {
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /close/i }));
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  }

  beforeEach(() => {
    // A returning visitor, so the threshold the dialog's own init reads is 30.
    localStorage.setItem('bb-visited', '1');
    ui = null;
  });

  it('mounting the dialog initialises the store, and opening it marks the ask shown for the session', async () => {
    await mountDialog();
    expect(engagementSnapshot()).toMatchObject({ ready: true, triggerClicks: 30, shownThisSession: false });
    await openFrom('popup');
    expect(last().shownThisSession).toBe(true);
  });

  it('a deep-use ask closed without a signup: the source is read before it is reset', async () => {
    await mountDialog();
    await openFrom('deep-use');
    await closeWithX();

    // Only a deep-use close writes this record, so it proves the close saw 'deep-use'.
    expect(localStorage.getItem('bb_email_prompt')).not.toBeNull();
    expect(Number(localStorage.getItem('bb_waitlist_dismissed'))).toBeGreaterThan(0);
    expect(engagementSnapshot()).toMatchObject({ shownThisSession: true, waitlistSource: 'popup', submitted: false });
  });

  it('a strip-opened dialog closed: no deep-use record, and the next opener starts from popup', async () => {
    await mountDialog();
    await openFrom('dashboard');
    await closeWithX();

    expect(localStorage.getItem('bb_email_prompt')).toBeNull();
    expect(Number(localStorage.getItem('bb_waitlist_dismissed'))).toBeGreaterThan(0);
    expect(engagementSnapshot()).toMatchObject({ shownThisSession: true, waitlistSource: 'popup' });
  });

  it('a signup, then the close: submitted stays, and no "not now" record is written', async () => {
    await mountDialog();
    await openFrom('deep-use');
    fireEvent.change(screen.getByPlaceholderText('Email'), { target: { value: 'flyer@example.com' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Stay in the Loop' }));
    });
    expect(postWaitlist).toHaveBeenCalledWith(expect.objectContaining({ source: 'deep-use' }));
    expect(screen.getByText(/on the list/)).toBeTruthy();
    expect(engagementSnapshot().submitted).toBe(true);

    await closeWithX();
    expect(localStorage.getItem('bb_email_prompt')).toBeNull();
    expect(localStorage.getItem('bb_waitlist_submitted')).toBe('true');
    expect(engagementSnapshot()).toMatchObject({ submitted: true, waitlistSource: 'popup' });
  });
});
