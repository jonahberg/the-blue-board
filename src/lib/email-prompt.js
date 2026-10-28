// ═══ DEEP-USE EMAIL PROMPT — WHEN IT MAY BE THE ASK ═══
// Owner, Oct 28 2026: heavy users are asked to donate a bit more than half the time and to
// sign up for email a bit less than half the time (`chooseDeepUseAsk`, deep-use-ask.js).
// The email ask is the existing "Stay in the loop" dialog (`WaitlistDialog.tsx`), opened
// with the donation prompt's manners: after a pause, never over another dialog, never into
// a hidden tab (`donatePromptMayOpen`).
//
// Why it came back as a modal: the auto-opening dialog brought in 188 of the first 192
// signups. From Oct 4 the passive triggers revealed a strip instead, and from Oct 6 the
// donation prompt took the deep-use moment whenever it was eligible, so the strip almost
// never showed (0 opens in 191 showings from Oct 7) and signups stopped at zero.

import { WAITLIST_STRIP_COOLDOWN_MS } from './waitlist-gate.js';

/** Stored as `<outcome>:<epoch ms>`, e.g. `later:1791300000000` — `bb_donate_prompt`'s shape. */
export const EMAIL_PROMPT_STORAGE_KEY = 'bb_email_prompt';

/** Closing the email ask without signing up quiets it for 30 days. */
export const EMAIL_PROMPT_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * The stored answer, or null when there is none or it doesn't parse.
 * @param {string|null|undefined} raw
 * @returns {{outcome: 'later', at: number}|null}
 */
export function parseEmailPromptRecord(raw) {
  const match = /^(later):(\d+)$/.exec(String(raw ?? ''));
  if (!match) return null;
  const at = Number(match[2]);
  return at > 0 ? { outcome: 'later', at } : null;
}

/**
 * What to store when the email ask closes without a signup. (A signup needs no record of
 * its own: `bb_waitlist_submitted` already retires every email ask for good.)
 * @param {number} [now]
 */
export function emailPromptRecord(now = Date.now()) {
  return `later:${now}`;
}

/**
 * May the deep-use email ask be this visit's ask?
 *
 *   - never once the visitor has given an email — `bb_waitlist_submitted`, or the
 *     in-memory `submitted` flag, which outlives a failed storage write;
 *   - not within 30 days of closing this ask (`bb_email_prompt`);
 *   - not within 30 days of saying no to the strip or to a dialog they opened themselves
 *     (`bb_waitlist_dismissed`, the strip's own window): "a dismissal of either surface
 *     silences both", and a "no" on the quiet strip must not be answered with a modal.
 *
 * Fails CLOSED, like `donatePromptEligible`: without a working store there is nowhere to
 * remember a "no", and an ask that can't remember one would open on every visit.
 *
 * @param {{getItem: Function}|null|undefined} storage
 * @param {number} [now]
 * @param {{submitted?: boolean}} [opts]
 * @returns {boolean}
 */
export function emailPromptEligible(storage, now = Date.now(), { submitted = false } = {}) {
  if (!storage || submitted) return false;
  try {
    if (storage.getItem('bb_waitlist_submitted') === 'true') return false;
    const record = parseEmailPromptRecord(storage.getItem(EMAIL_PROMPT_STORAGE_KEY));
    if (record && now - record.at < EMAIL_PROMPT_COOLDOWN_MS) return false;
    const dismissed = parseInt(storage.getItem('bb_waitlist_dismissed'), 10);
    if (dismissed > 0 && now - dismissed < WAITLIST_STRIP_COOLDOWN_MS) return false;
  } catch (e) {
    return false;
  }
  return true;
}
