import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DISMISS_TTL_MS,
  TRIGGER_CLICKS_NEW,
  TRIGGER_CLICKS_RETURNING,
  shouldShowOnboarding,
  waitlistState,
} from '../src/lib/engagement.js';
import { clicksReachedThreshold, shouldShowWaitlist } from '../src/lib/waitlist-gate.js';

/**
 * Trigger and suppression contracts for the waitlist modal and the onboarding overlay.
 *
 * These assertions used to re-implement main.js's IIFE guards inline, which meant they
 * verified a COPY of the logic rather than the logic. The rules now live in two pure
 * modules — `src/lib/engagement.js` (the storage half) and `src/lib/waitlist-gate.js`
 * (the composed decision) — and the React surfaces in `src/app/features/` import them,
 * so this file asserts against the code that actually ships.
 *
 * The properties pinned here are unchanged:
 *   - Click threshold: 30 for a returning visitor (never 8, never 10), 20 for a new one
 *   - Session guard: once per session, and a flight landing does not reset it
 *   - Permanent suppression via bb_waitlist_submitted, which ?waitlist=1 cannot override
 *   - 7-day dismissal TTL for both the waitlist and onboarding, fail-open on a corrupt value
 *   - ?waitlist=1 forces past the session guard, the TTL and the onboarding overlay
 */

function createMockStorage(initial = {}) {
  const store = { ...initial };
  return {
    getItem(key) { return key in store ? store[key] : null; },
    setItem(key, val) { store[key] = String(val); },
    removeItem(key) { delete store[key]; },
    _store: store,
  };
}

/** A returning visitor: `bb-visited` already written by an earlier session. */
function returningStorage(initial = {}) {
  return createMockStorage({ 'bb-visited': '1', ...initial });
}

/** `waitlistState().dismissedRecently` is the exported form of main.js's TTL check. */
function isDismissedRecently(storage, key) {
  if (key === 'bb_waitlist_dismissed') return waitlistState(storage).dismissedRecently;
  // The onboarding key runs through the same private helper; `shouldShowOnboarding`
  // is its only public caller, so probe it on a storage that is otherwise clean.
  return !shouldShowOnboarding(createMockStorage({ 'bb-visited': '1', [key]: storage.getItem(key) }));
}

describe('waitlist modal trigger logic', () => {
  let storage;

  beforeEach(() => {
    storage = returningStorage();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('click threshold', () => {
    it('is 30 for a returning visitor — not the retired 8 or 10', () => {
      expect(TRIGGER_CLICKS_RETURNING).toBe(30);
      expect(waitlistState(returningStorage()).triggerClicks).toBe(30);
    });

    it('is 20 for a first-time visitor, who has not been marked bb-visited yet', () => {
      expect(TRIGGER_CLICKS_NEW).toBe(20);
      expect(waitlistState(createMockStorage()).triggerClicks).toBe(20);
    });

    it('should NOT show at 29 clicks', () => {
      expect(clicksReachedThreshold(29, 30)).toBe(false);
    });

    it('should show at exactly 30 clicks', () => {
      expect(clicksReachedThreshold(30, 30)).toBe(true);
    });

    it('should NOT show at old threshold of 10', () => {
      expect(clicksReachedThreshold(10, 30)).toBe(false);
    });

    it('fires ONCE — click 31 and beyond do not re-evaluate the gate', () => {
      expect(clicksReachedThreshold(31, 30)).toBe(false);
      expect(clicksReachedThreshold(120, 30)).toBe(false);
    });
  });

  describe('session guard', () => {
    it('allows showing when not yet shown this session', () => {
      expect(shouldShowWaitlist(storage, { shownThisSession: false, submitted: false })).toBe(true);
    });

    it('blocks showing when already shown this session', () => {
      expect(shouldShowWaitlist(storage, { shownThisSession: true, submitted: false })).toBe(false);
    });

    it('blocks when flight lands but modal was already shown (no guard reset)', () => {
      // The flight-landing trigger used to reset the session guard. It no longer does —
      // the landing moment gets its own BMAC toast instead.
      expect(shouldShowWaitlist(storage, { shownThisSession: true, submitted: false })).toBe(false);
    });

    it('allows showing on flight landing if modal was never shown', () => {
      expect(shouldShowWaitlist(storage, { shownThisSession: false, submitted: false })).toBe(true);
    });
  });

  describe('onboarding suppression (do not stack two modals)', () => {
    it('blocks a passive trigger while the onboarding overlay is up', () => {
      expect(
        shouldShowWaitlist(storage, { shownThisSession: false, onboardingVisible: true }),
      ).toBe(false);
    });

    it('lets the ?waitlist=1 deep link through anyway', () => {
      expect(
        shouldShowWaitlist(storage, {
          shownThisSession: false,
          onboardingVisible: true,
          forced: true,
        }),
      ).toBe(true);
    });
  });

  describe('permanent suppression (bb_waitlist_submitted)', () => {
    it('blocks showing when user has submitted email', () => {
      expect(shouldShowWaitlist(storage, { shownThisSession: false, submitted: true })).toBe(false);
    });

    it('reads the flag back off storage as the `submitted` seed', () => {
      const submittedStorage = returningStorage({ bb_waitlist_submitted: 'true' });
      expect(waitlistState(submittedStorage).submitted).toBe(true);
      expect(waitlistState(returningStorage()).submitted).toBe(false);
    });
  });

  describe('7-day dismissal TTL', () => {
    it('blocks showing when dismissed less than 7 days ago', () => {
      storage.setItem('bb_waitlist_dismissed', String(Date.now() - 3 * 24 * 60 * 60 * 1000));
      expect(shouldShowWaitlist(storage, { shownThisSession: false, submitted: false })).toBe(false);
    });

    it('allows showing when dismissed more than 7 days ago', () => {
      storage.setItem('bb_waitlist_dismissed', String(Date.now() - 8 * 24 * 60 * 60 * 1000));
      expect(shouldShowWaitlist(storage, { shownThisSession: false, submitted: false })).toBe(true);
    });

    it('allows showing when dismissed exactly 7 days ago', () => {
      storage.setItem('bb_waitlist_dismissed', String(Date.now() - DISMISS_TTL_MS));
      expect(shouldShowWaitlist(storage, { shownThisSession: false, submitted: false })).toBe(true);
    });

    it('allows showing when no dismissal timestamp exists', () => {
      expect(shouldShowWaitlist(storage, { shownThisSession: false, submitted: false })).toBe(true);
    });

    it('handles corrupted localStorage value gracefully (fail-open)', () => {
      storage.setItem('bb_waitlist_dismissed', 'not-a-number');
      expect(isDismissedRecently(storage, 'bb_waitlist_dismissed')).toBe(false);
      expect(shouldShowWaitlist(storage, { shownThisSession: false, submitted: false })).toBe(true);
    });

    it('handles empty string localStorage value gracefully', () => {
      storage.setItem('bb_waitlist_dismissed', '');
      expect(isDismissedRecently(storage, 'bb_waitlist_dismissed')).toBe(false);
    });

    it('handles negative timestamp gracefully', () => {
      storage.setItem('bb_waitlist_dismissed', '-1');
      expect(isDismissedRecently(storage, 'bb_waitlist_dismissed')).toBe(false);
    });

    it('handles zero timestamp gracefully', () => {
      storage.setItem('bb_waitlist_dismissed', '0');
      expect(isDismissedRecently(storage, 'bb_waitlist_dismissed')).toBe(false);
    });

    it('fails open — never suppresses — when the whole store throws on read', () => {
      const brokenStorage = {
        getItem(key) {
          if (key === 'bb-visited') return '1';
          throw new Error('SecurityError: localStorage is disabled');
        },
      };
      expect(waitlistState(brokenStorage).dismissedRecently).toBe(false);
      expect(waitlistState(brokenStorage).suppressed).toBe(false);
    });
  });

  describe('force mode (?waitlist=1 deep link)', () => {
    it('shows modal even when already shown this session', () => {
      expect(
        shouldShowWaitlist(storage, { shownThisSession: true, submitted: false, forced: true }),
      ).toBe(true);
    });

    it('shows modal even when dismissed recently', () => {
      storage.setItem('bb_waitlist_dismissed', String(Date.now()));
      expect(
        shouldShowWaitlist(storage, { shownThisSession: false, submitted: false, forced: true }),
      ).toBe(true);
    });

    it('still blocks when user already submitted email', () => {
      expect(
        shouldShowWaitlist(storage, { shownThisSession: false, submitted: true, forced: true }),
      ).toBe(false);
    });

    it('shows modal even when both session guard and TTL would block', () => {
      storage.setItem('bb_waitlist_dismissed', String(Date.now()));
      expect(
        shouldShowWaitlist(storage, { shownThisSession: true, submitted: false, forced: true }),
      ).toBe(true);
    });
  });

  describe('closeWaitlistModal persists dismissal', () => {
    it('a timestamp written on close suppresses the next passive trigger', () => {
      const now = Date.now();
      storage.setItem('bb_waitlist_dismissed', String(now));

      expect(parseInt(storage.getItem('bb_waitlist_dismissed'), 10)).toBe(now);
      expect(isDismissedRecently(storage, 'bb_waitlist_dismissed')).toBe(true);
      expect(shouldShowWaitlist(storage, { shownThisSession: false })).toBe(false);
    });
  });
});

describe('onboarding overlay suppression', () => {
  let storage;

  beforeEach(() => {
    storage = returningStorage();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('hides overlay when bb-onboarded is set', () => {
    storage.setItem('bb-onboarded', '1');
    expect(shouldShowOnboarding(storage)).toBe(false);
  });

  it('hides overlay when dismissed within 7 days (even without bb-onboarded)', () => {
    storage.setItem('bb_onboarding_dismissed', String(Date.now() - 2 * 24 * 60 * 60 * 1000));
    expect(shouldShowOnboarding(storage)).toBe(false);
  });

  it('shows overlay when no onboarding flag and no recent dismissal', () => {
    expect(shouldShowOnboarding(storage)).toBe(true);
  });

  it('shows overlay when dismissal is older than 7 days and bb-onboarded not set', () => {
    storage.setItem('bb_onboarding_dismissed', String(Date.now() - 10 * 24 * 60 * 60 * 1000));
    expect(shouldShowOnboarding(storage)).toBe(true);
  });

  it('hides overlay when both bb-onboarded and recent dismissal exist', () => {
    storage.setItem('bb-onboarded', '1');
    storage.setItem('bb_onboarding_dismissed', String(Date.now()));
    expect(shouldShowOnboarding(storage)).toBe(false);
  });

  it('marks a first-time visitor bb-visited, and shows them the overlay', () => {
    const fresh = createMockStorage();
    expect(shouldShowOnboarding(fresh)).toBe(true);
    expect(fresh.getItem('bb-visited')).toBe('1');
  });

  it('records the visit BEFORE the waitlist threshold is read, which is why order matters', () => {
    // main.js reads the click threshold first on purpose: a first-timer must get 20, and
    // `shouldShowOnboarding` is what writes the flag that would otherwise make it 30.
    const fresh = createMockStorage();
    const threshold = waitlistState(fresh).triggerClicks;
    shouldShowOnboarding(fresh);
    expect(threshold).toBe(TRIGGER_CLICKS_NEW);
    expect(waitlistState(fresh).triggerClicks).toBe(TRIGGER_CLICKS_RETURNING);
  });
});

describe('cache-clear scenario (integration)', () => {
  it('full flow: clear cache → onboarding → dismiss → clicks → waitlist → dismiss → suppressed for 7 days', () => {
    vi.useFakeTimers();
    const storage = createMockStorage(); // empty = simulating cache clear

    // Step 1: no visited flag → the new-visitor threshold, then the overlay shows.
    expect(storage.getItem('bb-visited')).toBe(null);
    const triggerClicks = waitlistState(storage).triggerClicks;
    expect(triggerClicks).toBe(TRIGGER_CLICKS_NEW);
    expect(shouldShowOnboarding(storage)).toBe(true);
    expect(storage.getItem('bb-visited')).toBe('1');

    // Step 2: user dismisses onboarding.
    storage.setItem('bb-onboarded', '1');
    storage.setItem('bb_onboarding_dismissed', String(Date.now()));
    expect(shouldShowOnboarding(storage)).toBe(false);

    // Step 3: the click trigger arms at the threshold read in step 1, not the new one.
    expect(clicksReachedThreshold(triggerClicks, triggerClicks)).toBe(true);
    expect(shouldShowWaitlist(storage, { shownThisSession: false, submitted: false })).toBe(true);

    // Step 4: user dismisses the waitlist modal.
    storage.setItem('bb_waitlist_dismissed', String(Date.now()));

    // Step 5: suppressed by the TTL, even in a brand-new session.
    expect(shouldShowWaitlist(storage, { shownThisSession: false, submitted: false })).toBe(false);

    // Step 6-7: eight days later it is allowed again.
    vi.advanceTimersByTime(8 * 24 * 60 * 60 * 1000);
    expect(shouldShowWaitlist(storage, { shownThisSession: false, submitted: false })).toBe(true);

    vi.useRealTimers();
  });
});
