/**
 * "Going deep on the site": the trigger shared by the two deep-use asks (Oct 2026).
 *
 * T1 is five minutes of use; T2 is the click threshold (20 new / 30 returning), counted by
 * the engagement store's document-level listener with navigation clicks excluded. Equality
 * ARMS T2 once; it fires after the clicking stops for `T2_SETTLE_MS`. This was
 * `WaitlistStrip`'s own trigger until the donation prompt (`DonatePrompt.tsx`) needed the
 * same moment.
 *
 * `deepUseAskThisVisit()` latches which ask that moment brings up — the donation prompt or
 * the email strip (`chooseDeepUseAsk`, src/lib/donate-prompt.js) — once per page load, so
 * answering the prompt does not bring the strip up in the same visit.
 */

import { useEffect, useRef, useState } from 'react';

import { chooseDeepUseAsk } from '@/lib/donate-prompt.js';
import { TRIGGER_TIME_MS } from '@/lib/engagement.js';
import { clicksReachedThreshold } from '@/lib/waitlist-gate.js';
import { initEngagement, useEngagement } from './engagement';
import { safeLocalStorage } from './storage';

/**
 * T2 waits for the clicking to stop: a quiet spell of this long means the visitor has
 * paused. Another click restarts the wait.
 */
export const T2_SETTLE_MS = 2000;

export type DeepUseAsk = 'donate' | 'waitlist' | null;

let latched: DeepUseAsk | undefined;

/** The ask for this page load, chosen the first time anyone asks. */
export function deepUseAskThisVisit(now = Date.now()): DeepUseAsk {
  if (latched === undefined) latched = chooseDeepUseAsk(safeLocalStorage(), now) as DeepUseAsk;
  return latched;
}

/** Test seam: forget this visit's choice. */
export function resetDeepUseAsk(): void {
  latched = undefined;
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
