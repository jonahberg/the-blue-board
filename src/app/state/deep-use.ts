/**
 * "Going deep on the site": the trigger shared by the deep-use asks (Oct 2026).
 *
 * T1 is five minutes of use; T2 is the click threshold (20 new / 30 returning), counted by
 * the engagement store's document-level listener with navigation clicks excluded. Equality
 * ARMS T2 once; it fires after the clicking stops for `T2_SETTLE_MS`. This was
 * `WaitlistStrip`'s own trigger until the donation prompt needed the same moment.
 *
 * `deepUseAskThisVisit()` latches which ask that moment brings up — 'donate' (since Nov 2026
 * the "cover a day" support STRIP, `features/SupportStrip.tsx`, which replaced the Oct 2026
 * donation modal), 'email' (the email dialog) or 'waitlist' (the email strip)
 * (`chooseDeepUseAsk`, src/lib/deep-use-ask.js) — once per page load, so answering one ask
 * does not bring another up in the same visit. The dice for the donate/email split are rolled
 * inside the latch, once.
 *
 * `useDeepUsePause()` is the manners the one remaining modal ask, the email dialog, keeps:
 * wait for a pause, never open over another dialog, sheet or popover, never into a hidden tab
 * (`donatePromptMayOpen`). The support strip does not need it: it sits below the board.
 *
 * Since Nov 22 2026 the support strip alone may come sooner (`useSupportStripMoment`, rules in
 * src/lib/support-moment.js): two seconds after the second flight's panel is closed (two or more
 * distinct flights opened on this page load, none open now), or after 60 s instead of five minutes
 * on a visit that arrived from a social post
 * (`arrivedFromPostThisVisit`, read once when this module loads, before anything can rewrite the
 * address). Such a moment rolls the same latch; on 'email' and 'waitlist' visits it does nothing,
 * and those asks still wait for T1/T2 (`useDeepUseTrigger`, unchanged).
 */

import { useEffect, useRef, useState } from 'react';

import { chooseDeepUseAsk } from '@/lib/deep-use-ask.js';
import { donatePromptMayOpen } from '@/lib/donate-prompt.js';
import { TRIGGER_TIME_MS } from '@/lib/engagement.js';
import { arrivedFromPost, firstTrigger, flightsMomentArmed, stripTimeTriggerMs } from '@/lib/support-moment.js';
import { clicksReachedThreshold } from '@/lib/waitlist-gate.js';
import { engagementSnapshot, initEngagement, useEngagement } from './engagement';
import { safeLocalStorage } from './storage';

/**
 * T2 waits for the clicking to stop: a quiet spell of this long means the visitor has
 * paused. Another click restarts the wait.
 */
export const T2_SETTLE_MS = 2000;

export type DeepUseAsk = 'donate' | 'email' | 'waitlist' | null;

/** What brought the support strip up: `trigger` on its `donate_prompt` events. */
export type SupportStripTrigger = 'time' | 'clicks' | 'flights' | 'post';

let latched: DeepUseAsk | undefined;
let random: () => number = Math.random;

/** This page load's landing address and referrer, read for `arrivedFromPost`. */
function readArrival(): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  try {
    return arrivedFromPost({
      search: window.location.search,
      hash: window.location.hash,
      referrer: document.referrer,
    });
  } catch {
    return false;
  }
}

// Read when this module first loads: the island's imports are evaluated before its first render,
// and that render is where the address starts being rewritten (`initialTab` in ui.tsx moves
// parameters out of the hash; the flight panel and the aircraft dialog replace the query).
let fromPost = readArrival();

/** Did this page load arrive from a social post (src/lib/support-moment.js `arrivedFromPost`)? */
export function arrivedFromPostThisVisit(): boolean {
  return fromPost;
}

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
 * (a value below `DEEP_USE_DONATE_WEIGHT` picks the support strip when both are eligible).
 * It also re-reads the arrival from the current address and referrer, as a page load would.
 */
export function resetDeepUseAsk(nextRandom: () => number = Math.random): void {
  latched = undefined;
  random = nextRandom;
  fromPost = readArrival();
}

/** True once T1 or T2 has fired on this page load. */
export function useDeepUseTrigger(): boolean {
  return useDeepUseMoment() !== null;
}

/** Which of T1 ('time') or T2 ('clicks') fired first on this page load, or null before either. */
function useDeepUseMoment(): 'time' | 'clicks' | null {
  const engagement = useEngagement();
  const [moment, setMoment] = useState<'time' | 'clicks' | null>(null);
  const fire = (next: 'time' | 'clicks') => setMoment((current) => current ?? next);

  useEffect(() => {
    initEngagement();
  }, []);

  // T1 — five minutes of use.
  useEffect(() => {
    const timer = setTimeout(() => fire('time'), TRIGGER_TIME_MS as number);
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
      fire('clicks');
    }, T2_SETTLE_MS);
  }, [engagement.clicks, engagement.triggerClicks]);
  useEffect(
    () => () => {
      if (t2Timer.current) clearTimeout(t2Timer.current);
    },
    [],
  );

  return moment;
}

/**
 * The moment that brings up the support strip on this page load, or null before one has come:
 * T1 or T2 as for every deep-use ask, or one of the strip's own early moments (Nov 22 2026,
 * src/lib/support-moment.js):
 *   'flights' — `distinctFlights` (the flights opened on this page load, the same one twice
 *               counted once) reached the second, `flightOpen` is false (the panel is closed),
 *               and it stayed closed for `T2_SETTLE_MS`; opening a flight cancels the wait until
 *               the next close (`flightsMomentArmed`), so the strip never arrives behind a panel;
 *   'post'    — this visit arrived from a social post, and 60 s have passed.
 * The first to fire keeps its name for the life of the page. A moment only says the strip MAY
 * show: the caller still asks the latch (`deepUseAskThisVisit`), which is rolled then, the same
 * dice as ever, and shows the strip only on a 'donate' visit (`supportStripMayShow`).
 */
export function useSupportStripMoment(distinctFlights: number, flightOpen: boolean): SupportStripTrigger | null {
  const deep = useDeepUseMoment();
  const [first, setFirst] = useState<SupportStripTrigger | null>(null);
  const fire = (next: SupportStripTrigger) => setFirst((current) => firstTrigger(current, next));

  // T1 / T2: recorded in the order they arrive among the strip's moments.
  useEffect(() => {
    if (deep) fire(deep);
  }, [deep]);

  // A post's 60 s. T1's five minutes still runs above, for the other asks.
  useEffect(() => {
    if (!fromPost) return undefined;
    const timer = setTimeout(() => fire('post'), stripTimeTriggerMs(true));
    return () => clearTimeout(timer);
  }, []);

  // Two or more flights opened and the panel closed, then the settle, timed from the close;
  // opening a flight in the meantime clears the timer, and the next close starts it again.
  const flightsArmed = flightsMomentArmed({ distinctFlights, flightOpen });
  useEffect(() => {
    if (!flightsArmed) return undefined;
    const timer = setTimeout(() => fire('flights'), T2_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [flightsArmed]);

  // `deep` stands in for the one render before its effect records it (nothing fired earlier).
  return first ?? deep;
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
