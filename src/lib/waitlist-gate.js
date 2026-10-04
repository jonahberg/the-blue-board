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
 * May the onboarding overlay open right now?
 *
 * The other half of the ordering rule above, and the reason both halves live in one module:
 * `shouldShowWaitlist()` holds the waitlist back while onboarding is up, but `?waitlist=1`
 * is explicitly allowed to bypass that (`forced`). Without a matching rule on this side the
 * two overlays end up on screen together, and Radix's modal layer stack — which is ordered
 * by mount, not by z-index — hands focus and pointer events to whichever mounted LAST,
 * leaving the dialog the visitor actually followed a link to reach inert and `aria-hidden`.
 * Lifting the waitlist's z-index fixes what is painted on top; only this fixes what the
 * visitor can actually type into.
 *
 * So onboarding YIELDS: it waits while the waitlist is open and comes up once it closes.
 * The visitor deals with the ask they asked for, then gets the welcome — which is the order
 * legacy produced anyway, since main.js's overlay was built at a point the deep link had
 * already claimed the screen.
 *
 * This deliberately does NOT touch what `shouldShowOnboarding()` computes, nor when
 * `bb-visited` / `bb-onboarded` are written. It gates the OPENING of the overlay only, so
 * the storage side-effect order documented in `state/engagement.tsx` is untouched.
 *
 * @param {boolean} showOnboardingInitially  the storage-derived decision, already made.
 * @param {boolean} waitlistOpen  is the waitlist dialog on screen right now?
 * @returns {boolean}
 */
export function onboardingMayOpen(showOnboardingInitially, waitlistOpen) {
  return Boolean(showOnboardingInitially) && !waitlistOpen;
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

// ═══ THE "STAY IN THE LOOP" STRIP (Oct 2026) ═══
// The passive triggers (T1: five minutes of use, T2: the click threshold) used to open the
// waitlist as a MODAL over whatever the visitor was reading — the board, mid-scroll (phone
// QA, Oct 3 2026). They now reveal a slim strip in the engagement slot below the panel
// instead; the modal only ever opens because someone asked for it (`?waitlist=1`, or the
// strip's own button). The storage keys are the dialog's — `bb_waitlist_submitted` and
// `bb_waitlist_dismissed` — so a dismissal of either surface silences both. What changes is
// the window: a strip that sits in view until dismissed is a bigger ask than a one-off modal,
// so a "no" is honoured for 30 days, not the modal's 7.

/** A dismissed or closed waitlist ask stays away from the strip for 30 days. */
export const WAITLIST_STRIP_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Should the strip be on screen?
 *
 * Fails CLOSED on a store that throws: without somewhere to record a dismissal the strip
 * would come back on every page view, which is exactly the nagging this replaced.
 *
 * @param {{getItem: Function}|null} storage
 * @param {{triggered?: boolean, submitted?: boolean, now?: number}} [opts]
 *   `triggered` — T1 or T2 has fired this session; `submitted` — the in-memory flag, which
 *   outlives a failed storage write.
 * @returns {boolean}
 */
export function shouldShowWaitlistStrip(storage, opts = {}) {
  const { triggered = false, submitted = false, now = Date.now() } = opts;
  if (!triggered || submitted || !storage) return false;
  try {
    if (storage.getItem('bb_waitlist_submitted') === 'true') return false;
    const ts = parseInt(storage.getItem('bb_waitlist_dismissed'), 10);
    if (ts > 0 && now - ts < WAITLIST_STRIP_COOLDOWN_MS) return false;
  } catch (e) {
    return false;
  }
  return true;
}
