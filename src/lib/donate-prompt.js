// ═══ DEEP-USE SUPPORT ASK — WHEN IT MAY SHOW ═══
// Oct 2026: the owner asked for "a pop up for donations if someone really is going deep on the
// site", and heavy users got a donation MODAL. "Going deep" is the waitlist strip's T1/T2
// trigger (5 minutes of use, or 20/30 engagement clicks). From Oct 6 that modal was shown 417
// times, tapped 7 times and produced at most one donation. Nov 2026: the modal is gone. The
// same moment now brings up the "cover a day" STRIP in the engagement slot
// (`features/SupportStrip.tsx`), and these rules are its rules, unchanged:
//
// One ask per visit. The first time the trigger fires, `chooseDeepUseAsk`
// (src/lib/deep-use-ask.js) picks the support strip, the email dialog or the email strip, and
// the caller latches that choice for the page's life. The support ask is chosen about 60% of
// the time it is eligible (Oct 28 2026). It goes quiet for 30 days after a dismiss and 90 after
// a tap on its button, stored under the same key as the modal's answers (`bb_donate_prompt`,
// same `<outcome>:<epoch ms>` format), so every quiet period already running carries over.
//
// `donatePromptMayOpen` / `DONATE_QUIET_MS` are the pause rule the remaining modal ask, the
// email dialog, still waits on (`useDeepUsePause` in `state/deep-use.ts`).

/** Stored as `<outcome>:<epoch ms>`, e.g. `later:1791300000000`. */
export const DONATE_PROMPT_STORAGE_KEY = 'bb_donate_prompt';

/** A dismiss (stored as `later`) quiets the support ask for 30 days. */
export const DONATE_LATER_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;

/** A tap on its button (`donate`) quiets it for 90: the dashboard cannot see whether they paid. */
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
 * May a deep-use MODAL open at this instant? Since the support ask became a strip (Nov 2026)
 * only the email dialog waits on this (`EmailPrompt.tsx`).
 * @param {{now: number, lastActivity: number, otherDialogOpen: boolean, hidden: boolean}} s
 * @returns {boolean}
 */
export function donatePromptMayOpen({ now, lastActivity, otherDialogOpen, hidden }) {
  return !hidden && !otherDialogOpen && now - lastActivity >= DONATE_QUIET_MS;
}
