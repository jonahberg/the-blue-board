/**
 * "Going deep on the site": the trigger shared by the deep-use asks (Oct 2026).
 *
 * T1 is five minutes of use; T2 is the click threshold (20 new / 30 returning), counted by
 * the engagement store's document-level listener with navigation clicks excluded. Equality
 * ARMS T2 once; it fires after the clicking stops for `T2_SETTLE_MS`. This was
 * `WaitlistStrip`'s own trigger until the donation prompt (`DonatePrompt.tsx`) needed the
 * same moment.
 *
 * `deepUseAskThisVisit()` latches which ask that moment brings up — the donation prompt, the
 * email dialog or the email strip (`chooseDeepUseAsk`, src/lib/deep-use-ask.js) — once per
 * page load, so answering one ask does not bring another up in the same visit. The dice for
 * the donate/email split are rolled inside the latch, once.
 *
 * `useDeepUsePause()` is the manners both modal asks share: wait for a pause, never open
 * over another dialog, sheet or popover, never into a hidden tab (`donatePromptMayOpen`).
 */

import { useEffect, useRef, useState } from 'react';

import { chooseDeepUseAsk } from '@/lib/deep-use-ask.js';
import { donatePromptMayOpen } from '@/lib/donate-prompt.js';
import { TRIGGER_TIME_MS } from '@/lib/engagement.js';
import { clicksReachedThreshold } from '@/lib/waitlist-gate.js';
import { engagementSnapshot, initEngagement, useEngagement } from './engagement';
import { safeLocalStorage } from './storage';

/**
 * T2 waits for the clicking to stop: a quiet spell of this long means the visitor has
 * paused. Another click restarts the wait.
 */
export const T2_SETTLE_MS = 2000;

export type DeepUseAsk = 'donate' | 'email' | 'waitlist' | null;

let latched: DeepUseAsk | undefined;
let random: () => number = Math.random;

/** The ask for this page load, chosen the first time anyone asks. */
export function deepUseAskThisVisit(now = Date.now()): DeepUseAsk {
  if (latched === undefined) {
    latched = chooseDeepUseAsk(safeLocalStorage(), now, {
      random,
      submitted: engagementSnapshot().submitted,
    }) as DeepUseAsk;
  }
  return latched;
}

/**
 * Test seam: forget this visit's choice. `nextRandom` fixes the dice for the next choice
 * (a value below `DEEP_USE_DONATE_WEIGHT` picks the donation prompt when both are eligible).
 */
export function resetDeepUseAsk(nextRandom: () => number = Math.random): void {
  latched = undefined;
  random = nextRandom;
}

/** True once T1 or T2 has fired on this page load. */
export function useDeepUseTrigger(): boolean {
  const engagement = useEngagement();
  const [triggered, setTriggered] = useState(false);

  useEffect(() => {
    initEngagement();
  }, []);

  // T1 — five minutes of use.
  useEffect(() => {
    const timer = setTimeout(() => setTriggered(true), TRIGGER_TIME_MS as number);
    return () => clearTimeout(timer);
  }, []);

  // T2 — the click threshold, armed on equality, fired after the pause.
  const t2Armed = useRef(false);
  const t2Timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (clicksReachedThreshold(engagement.clicks, engagement.triggerClicks)) t2Armed.current = true;
    if (!t2Armed.current) return;
    if (t2Timer.current) clearTimeout(t2Timer.current);
    t2Timer.current = setTimeout(() => {
      t2Armed.current = false;
      t2Timer.current = null;
      setTriggered(true);
    }, T2_SETTLE_MS);
  }, [engagement.clicks, engagement.triggerClicks]);
  useEffect(
    () => () => {
      if (t2Timer.current) clearTimeout(t2Timer.current);
    },
    [],
  );

  return triggered;
}

/** How often a waiting ask re-checks for a pause. */
const POLL_MS = 1000;

const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchmove', 'scroll'] as const;

function otherDialogOpen(): boolean {
  return document.querySelector('[role="dialog"], [role="alertdialog"]') !== null;
}

/**
 * While `waiting`, call `onPause` once the visitor has paused (`DONATE_QUIET_MS` with no
 * tap, key or scroll), no other dialog, sheet or popover is up, and the tab is visible.
 * Every tap, key and scroll restarts the pause; the clock starts when waiting begins, so an
 * ask never lands on the very click that summoned it. The caller stops waiting by flipping
 * `waiting` off (normally from inside `onPause`).
 */
export function useDeepUsePause(waiting: boolean, onPause: () => void): void {
  const lastActivity = useRef(0);
  const callback = useRef(onPause);
  callback.current = onPause;

  useEffect(() => {
    if (!waiting) return;
    lastActivity.current = Date.now();
    const mark = () => {
      lastActivity.current = Date.now();
    };
    for (const name of ACTIVITY_EVENTS) window.addEventListener(name, mark, { capture: true, passive: true });
    const poll = setInterval(() => {
      const may = donatePromptMayOpen({
        now: Date.now(),
        lastActivity: lastActivity.current,
        otherDialogOpen: otherDialogOpen(),
        hidden: document.visibilityState === 'hidden',
      });
      if (may) callback.current();
    }, POLL_MS);
    return () => {
      clearInterval(poll);
      for (const name of ACTIVITY_EVENTS) window.removeEventListener(name, mark, { capture: true });
    };
  }, [waiting]);
}
