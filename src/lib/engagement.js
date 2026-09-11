// ═══ ONBOARDING / WAITLIST / BMAC FREQUENCY RULES ═══
// When each of the three asks is allowed to appear. All three read the same pattern —
// an epoch timestamp in localStorage plus a TTL — and all three fail OPEN: if storage
// throws, the visitor still sees the thing rather than being silently locked out.
//
// Extracted verbatim from src/dashboard/main.js (:7979-7984 the suppression guards,
// :8169-8249 the triggers, :8197-8205 the BMAC cooldown, :8243-8249 the onboarding
// visit check). Modal construction, timers and the per-session "already shown" flag
// stay in main.js — that flag is session state, not storage.

/** Dismissals of the onboarding overlay and the waitlist last 7 days. */
export const DISMISS_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** The landing thank-you toast is capped to once per 14 days. */
export const BMAC_LANDED_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000;

/** Time-based waitlist trigger: 5 minutes of active use. */
export const TRIGGER_TIME_MS = 5 * 60 * 1000;

/**
 * Click-based waitlist trigger. P2-A item 4c: the old 8-click/90s new-visitor trigger
 * interrupted a first-timer mid-search (F044), so it only fires on visitors who are
 * genuinely engaged, not the first few taps of orientation.
 */
export const TRIGGER_CLICKS_NEW = 20;
export const TRIGGER_CLICKS_RETURNING = 30;

/** Was `key` dismissed within the TTL? Never throws. */
function isDismissedRecently(storage, key, now) {
  try {
    const ts = parseInt(storage.getItem(key), 10);
    return ts > 0 && (now - ts) < DISMISS_TTL_MS;
  } catch (e) { return false; }
}

/**
 * Should the onboarding overlay be shown — and record the visit.
 *
 * SIDE EFFECT: a first-time visitor is marked `bb-visited` here. That write is what
 * later decides the waitlist click threshold, so it must stay at this point in the
 * sequence (the waitlist reads bb-visited before this runs, on purpose).
 *
 * @param {{getItem: Function, setItem: Function}} storage
 * @param {number} [now]  epoch ms.
 * @returns {boolean}
 */
export function shouldShowOnboarding(storage, now = Date.now()) {
  let visited;
  try { visited = storage.getItem('bb-visited'); } catch (e) { return true; }
  if (!visited) {
    try { storage.setItem('bb-visited', '1'); } catch (e) { /* storage unavailable */ }
    return !isDismissedRecently(storage, 'bb_onboarding_dismissed', now);
  }
  let onboarded;
  try { onboarded = storage.getItem('bb-onboarded'); } catch (e) { onboarded = null; }
  return !(onboarded || isDismissedRecently(storage, 'bb_onboarding_dismissed', now));
}

/**
 * Storage-derived state for the waitlist modal.
 *
 * `suppressed` covers only the persistent guards. main.js additionally checks the
 * per-session "already shown" flag and whether the onboarding overlay is still up.
 *
 * @param {{getItem: Function}} storage
 * @param {number} [now]  epoch ms.
 * @param {{clicks?: number, forced?: boolean}} [opts]  `forced` = the ?waitlist=1 bypass.
 * @returns {{submitted: boolean, dismissedRecently: boolean, isNewVisitor: boolean,
 *   triggerClicks: number, clicksReached: boolean, suppressed: boolean}}
 */
export function waitlistState(storage, now = Date.now(), { clicks = 0, forced = false } = {}) {
  let submitted = false;
  try { submitted = storage.getItem('bb_waitlist_submitted') === 'true'; } catch (e) { /* unreadable */ }

  let isNewVisitor = true;
  try { isNewVisitor = !storage.getItem('bb-visited'); } catch (e) { /* unreadable */ }

  const dismissedRecently = isDismissedRecently(storage, 'bb_waitlist_dismissed', now);
  const triggerClicks = isNewVisitor ? TRIGGER_CLICKS_NEW : TRIGGER_CLICKS_RETURNING;

  return {
    submitted,
    dismissedRecently,
    isNewVisitor,
    triggerClicks,
    // Exactly ON the threshold — the click handler fires once, not on every later click.
    clicksReached: clicks === triggerClicks,
    suppressed: submitted || (!forced && dismissedRecently),
  };
}

/**
 * Is the "glad you landed" BMAC toast outside its 14-day cooldown?
 * @param {{getItem: Function}} storage
 * @param {number} [now]  epoch ms.
 * @returns {boolean} true (eligible) when nothing is stored or storage throws.
 */
export function bmacEligible(storage, now = Date.now()) {
  try {
    const last = Number(storage.getItem('bb-bmac-dismissed') || 0);
    if (last && (now - last) < BMAC_LANDED_COOLDOWN_MS) return false;
  } catch (e) { /* storage unavailable — fail open */ }
  return true;
}
