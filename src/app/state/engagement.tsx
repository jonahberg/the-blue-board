/**
 * The three asks — onboarding, the waitlist, the coffee — and the session state that
 * decides when they are allowed to appear (inventory §10–§12).
 *
 * This is a module-level store rather than a context provider, for two reasons.
 *
 * The first is ORDERING, and it is a real bug if you get it wrong. `shouldShowOnboarding()`
 * WRITES `bb-visited` as a side effect, and `waitlistState().triggerClicks` READS it to
 * decide whether this visitor needs 20 clicks or 30. main.js read the threshold first, on
 * purpose (`main.js:7070-7074`), so a first-time visitor gets 20. Two sibling components
 * each doing their own read in their own effect cannot guarantee that order — React runs
 * effects in mount order, which is a rendering detail, not a contract. One `init()` that
 * does both reads in the right sequence can.
 *
 * The second is that `Dashboard.tsx` is closed to this work package except for the watch
 * banner, so there is nowhere to add a provider even if one were wanted.
 *
 * Storage reads in `src/lib/engagement.js` are deliberately BARE — they throw on a broken
 * store, exactly as main.js did, and the module's header says the React port is where that
 * gets decided. This is that decision: `init()` wraps them and fails CLOSED. main.js's
 * IIFE aborted on a throw, which left the onboarding overlay visible in the markup with no
 * dismiss handler attached — an undismissable wall in front of the dashboard for anyone
 * with storage disabled. Showing nothing is the better failure.
 */

import { useSyncExternalStore } from 'react';

import { shouldShowOnboarding, waitlistState } from '@/lib/engagement.js';
import { isDeepLinkArrival } from './deep-links';
import { safeLocalStorage } from './storage';

/**
 * Clicks that are NAVIGATION, not engagement: switching tabs (desktop tab bar, mobile bottom
 * nav), anything inside a dialog — the welcome overlay's own buttons included — and anything
 * that opts out with `data-no-engagement`. Counting those made the T2 waitlist modal pop up
 * mid tab-switch, over whatever the visitor was on their way to (audit F19/F26).
 */
export const NON_ENGAGEMENT_SELECTOR =
  '[role="tab"], [role="tablist"], nav, [role="dialog"], [role="alertdialog"], [data-no-engagement]';

/** Does this click count towards the T2 strip trigger's threshold? */
export function countsAsEngagement(target: EventTarget | null): boolean {
  const el = target instanceof Element ? target : null;
  return !el?.closest(NON_ENGAGEMENT_SELECTOR);
}

export type EngagementState = {
  /** Engagement clicks since load (see `countsAsEngagement`) — the T2 waitlist trigger's counter. */
  clicks: number;
  /** 20 for a first-time visitor, 30 for a returning one. Read ONCE, before `bb-visited`. */
  triggerClicks: number;
  /** Has the waitlist modal been opened at all this session? */
  shownThisSession: boolean;
  /** `bb_waitlist_submitted` — permanent, and `?waitlist=1` does not override it. */
  submitted: boolean;
  /** Should the onboarding overlay come up on this load? */
  showOnboardingInitially: boolean;
  /** True once `init()` has run, so a consumer can tell "no" from "not asked yet". */
  ready: boolean;
  /**
   * Which surface opened the waitlist dialog, sent as the signup's `source`. `'popup'` is the
   * dialog's historical value (the `?waitlist=1` link keeps it); `'dashboard'` marks a signup
   * that came through the Oct 2026 strip, so the two can be compared in the waitlist table.
   * Both are already in the API's `VALID_SOURCES` and the table's CHECK constraint.
   */
  waitlistSource: WaitlistSource;
};

export type WaitlistSource = 'popup' | 'dashboard';

let state: EngagementState = {
  clicks: 0,
  triggerClicks: 30,
  shownThisSession: false,
  submitted: false,
  showOnboardingInitially: false,
  ready: false,
  waitlistSource: 'popup',
};

const listeners = new Set<() => void>();

function setState(patch: Partial<EngagementState>) {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): EngagementState {
  return state;
}

let initialised = false;
let detachClicks: (() => void) | null = null;

/**
 * Read storage once and start counting clicks. Idempotent — every surface that needs the
 * store calls it on mount and only the first call does anything.
 */
export function initEngagement(): void {
  if (initialised) return;
  initialised = true;

  const storage = safeLocalStorage();
  let triggerClicks = 30;
  let submitted = false;
  let showOnboardingInitially = false;

  if (storage) {
    try {
      // ORDER MATTERS — see the file header. The threshold is read from the store as it
      // stands BEFORE `shouldShowOnboarding` marks the visit.
      const waitlist = waitlistState(storage);
      triggerClicks = waitlist.triggerClicks;
      submitted = waitlist.submitted;
      // Called unconditionally: it marks the visit, which the threshold above depends on. A
      // deep-link arrival already has a destination, so the welcome stays down (F45).
      const wantsOnboarding = shouldShowOnboarding(storage);
      showOnboardingInitially = wantsOnboarding && !isDeepLinkArrival();
    } catch {
      // Fail closed: no overlay, no passive waitlist. See the header.
      triggerClicks = Number.POSITIVE_INFINITY;
      submitted = false;
      showOnboardingInitially = false;
    }
  } else {
    // No storage at all (private mode, SSR): the same fail-closed posture. Without a place
    // to record a dismissal, every one of these asks would return on the next page view.
    triggerClicks = Number.POSITIVE_INFINITY;
  }

  setState({ triggerClicks, submitted, showOnboardingInitially, ready: true });

  if (typeof document !== 'undefined') {
    const onClick = (event: Event) => {
      if (countsAsEngagement(event.target)) setState({ clicks: state.clicks + 1 });
    };
    document.addEventListener('click', onClick);
    detachClicks = () => document.removeEventListener('click', onClick);
  }
}

export function markWaitlistShown(): void {
  if (!state.shownThisSession) setState({ shownThisSession: true });
}

export function markWaitlistSubmitted(): void {
  setState({ submitted: true });
}

/** Record which surface is opening the waitlist dialog (see `waitlistSource`). */
export function setWaitlistSource(source: WaitlistSource): void {
  if (state.waitlistSource !== source) setState({ waitlistSource: source });
}

/** Test/HMR seam — production never tears the store down. */
export function resetEngagement(): void {
  detachClicks?.();
  detachClicks = null;
  initialised = false;
  state = {
    clicks: 0,
    triggerClicks: 30,
    shownThisSession: false,
    submitted: false,
    showOnboardingInitially: false,
    ready: false,
    waitlistSource: 'popup',
  };
}

export function useEngagement(): EngagementState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
