// ═══ THE DEEP-USE ASK — WHICH ONE THIS VISIT GETS ═══
// "Going deep" is the T1/T2 trigger in `src/app/state/deep-use.ts` (five minutes of use, or
// 20/30 engagement clicks). The first time it fires, ONE ask is chosen and latched for the
// page's life, so answering it never brings another ask up in the same visit.
//
// Owner, Oct 28 2026: heavy users should be asked to donate a bit more than half the time
// and to sign up for email a bit less than half the time. Among the asks eligible right
// now:
//
//   donate eligible | email eligible | ask
//   ----------------+----------------+---------------------------------------------
//   yes             | yes            | 'donate' with DEEP_USE_DONATE_WEIGHT, else 'email'
//   yes             | no             | 'donate'
//   no              | yes            | 'email'
//   no              | no             | 'waitlist' — the strip, whose own gate decides
//   no store        |                | null
//
// 'donate' is the donation prompt (`DonatePrompt.tsx`, eligibility `donatePromptEligible`);
// 'email' is the "Stay in the loop" dialog opened after a pause (`EmailPrompt.tsx`,
// eligibility `emailPromptEligible`); 'waitlist' is today's quiet strip
// (`WaitlistStrip.tsx`, `shouldShowWaitlistStrip`).

import { donatePromptEligible } from './donate-prompt.js';
import { emailPromptEligible } from './email-prompt.js';

/** The share of two-way choices that go to the donation prompt; the rest go to email. */
export const DEEP_USE_DONATE_WEIGHT = 0.6;

/**
 * @param {{getItem: Function}|null|undefined} storage
 * @param {number} [now]
 * @param {{random?: () => number, submitted?: boolean}} [opts]
 *   `random` — a uniform [0, 1) source, rolled only when both asks are eligible;
 *   `submitted` — the in-memory "already gave an email" flag.
 * @returns {'donate'|'email'|'waitlist'|null}
 */
export function chooseDeepUseAsk(storage, now = Date.now(), { random = Math.random, submitted = false } = {}) {
  if (!storage) return null;
  const donate = donatePromptEligible(storage, now);
  const email = emailPromptEligible(storage, now, { submitted });
  if (donate && email) return random() < DEEP_USE_DONATE_WEIGHT ? 'donate' : 'email';
  if (donate) return 'donate';
  if (email) return 'email';
  return 'waitlist';
}
