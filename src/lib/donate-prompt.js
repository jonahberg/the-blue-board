// ═══ DEEP-USE DONATION PROMPT — WHEN IT MAY OPEN ═══
// The one modal ask on the dashboard (Oct 2026). Owner, Oct 6 2026: "a pop up for
// donations if someone really is going deep on the site." "Going deep" is the waitlist
// strip's T1/T2 trigger (5 minutes of use, or 20/30 engagement clicks); from Oct 3 to Oct 6
// it fired for 322 visitors, and the email strip it summoned got 5 opens from 376 showings
// and no donations.
//
// One ask per visit. The first time the trigger fires, `chooseDeepUseAsk`
// (src/lib/deep-use-ask.js) picks the donation prompt, the email dialog or the email strip,
// and the caller latches that choice for the page's life, so answering one ask does not
// bring another up in the same visit. Since Oct 28 2026 the prompt is the ask about 60% of
// the time it is eligible, not every time.
//
// The popup still owes the data its manners (DESIGN.md "Engagement surfaces stay quiet"):
// it opens only once the visitor has paused, never over another dialog or sheet, and
// never into a hidden tab.

/** Stored as `<outcome>:<epoch ms>`, e.g. `later:1791300000000`. */
export const DONATE_PROMPT_STORAGE_KEY = 'bb_donate_prompt';

/** "Maybe later" (or any close that isn't Donate) quiets the prompt for 30 days. */
export const DONATE_LATER_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;

/** A Donate tap quiets it for 90: the dashboard cannot see whether they paid. */
export const DONATE_TAPPED_COOLDOWN_MS = 90 * 24 * 60 * 60 * 1000;

/** The visitor has paused when nothing was tapped, typed or scrolled for this long. */
export const DONATE_QUIET_MS = 3000;

/**
 * The stored answer, or null when there is none or it doesn't parse.
 * @param {string|null|undefined} raw
 * @returns {{outcome: 'later'|'donate', at: number}|null}
 */
export function parseDonatePromptRecord(raw) {
  const match = /^(later|donate):(\d+)$/.exec(String(raw ?? ''));
  if (!match) return null;
  const at = Number(match[2]);
  return at > 0 ? { outcome: /** @type {'later'|'donate'} */ (match[1]), at } : null;
}

/**
 * What to store when the prompt closes.
 * @param {'later'|'donate'} outcome
 * @param {number} [now]
 */
export function donatePromptRecord(outcome, now = Date.now()) {
  return `${outcome === 'donate' ? 'donate' : 'later'}:${now}`;
}

/**
 * Is the prompt outside its cooldown? Fails CLOSED: without a working store there is
 * nowhere to remember a "Maybe later", and a prompt that can't remember would open on
 * every visit.
 *
 * @param {{getItem: Function}|null|undefined} storage
 * @param {number} [now]
 * @returns {boolean}
 */
export function donatePromptEligible(storage, now = Date.now()) {
  if (!storage) return false;
  let record;
  try {
    record = parseDonatePromptRecord(storage.getItem(DONATE_PROMPT_STORAGE_KEY));
  } catch (e) {
    return false;
  }
  if (!record) return true;
  const cooldown = record.outcome === 'donate' ? DONATE_TAPPED_COOLDOWN_MS : DONATE_LATER_COOLDOWN_MS;
  return now - record.at >= cooldown;
}

/**
 * May the prompt open at this instant? The email dialog, when it is the deep-use ask, waits
 * on the same rule (`EmailPrompt.tsx`).
 * @param {{now: number, lastActivity: number, otherDialogOpen: boolean, hidden: boolean}} s
 * @returns {boolean}
 */
export function donatePromptMayOpen({ now, lastActivity, otherDialogOpen, hidden }) {
  return !hidden && !otherDialogOpen && now - lastActivity >= DONATE_QUIET_MS;
}
