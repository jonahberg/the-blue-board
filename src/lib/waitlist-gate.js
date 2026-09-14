// ═══ WAITLIST MODAL — THE COMPOSED SHOW/HIDE DECISION ═══
// `engagement.js` answers the STORAGE half of the question (dismissed recently? already
// submitted? which click threshold does this visitor get?). The other half is session
// state that never touches storage — "have we already shown it this session?" and "is the
// onboarding overlay up?" — which lived inline in main.js's IIFE (:6881-6886).
//
// Composing the two here rather than in the React component is what keeps the whole
// decision testable: tests/popup-triggers.test.js asserts against this module, not
// against a DOM or a rendered dialog.

import { waitlistState } from './engagement.js';

/**
 * Should the waitlist modal open right now?
 *
 * The gate order is main.js's, and the ORDER is the behaviour:
 *   1. `submitted` wins over everything, `forced` included. Someone who has already given
 *      an email must never be asked again, and `?waitlist=1` does not revive the ask.
 *   2. `forced` (the `?waitlist=1` deep link) then bypasses the three passive guards,
 *      because arriving on that link IS the intent.
 *   3. Once per session, outside the 7-day dismissal, and never stacked on top of the
 *      onboarding overlay.
 *
 * @param {{getItem: Function}} storage
 * @param {{shownThisSession?: boolean, submitted?: boolean, onboardingVisible?: boolean,
 *   forced?: boolean, now?: number}} [opts]
 * @returns {boolean}
 */
export function shouldShowWaitlist(storage, opts = {}) {
  const {
    shownThisSession = false,
    submitted = false,
    onboardingVisible = false,
    forced = false,
    now = Date.now(),
  } = opts;

  if (submitted) return false;
  if (!forced && shownThisSession) return false;
  if (waitlistState(storage, now, { forced }).suppressed) return false;
  if (!forced && onboardingVisible) return false;
  return true;
}

/**
 * Has the click counter just crossed this visitor's threshold?
 *
 * Equality, not `>=`, on purpose: the document-level click handler fires on EVERY click,
 * and `>=` would re-evaluate the whole gate on click 31, 32, 33… forever (main.js :7081).
 *
 * @param {number} clicks
 * @param {number} triggerClicks  from `waitlistState().triggerClicks` — 20 new / 30 returning.
 * @returns {boolean}
 */
export function clicksReachedThreshold(clicks, triggerClicks) {
  return clicks === triggerClicks;
}
