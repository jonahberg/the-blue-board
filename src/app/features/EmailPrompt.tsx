/**
 * The deep-use EMAIL ask (Oct 28 2026): opens the existing "Stay in the loop" dialog
 * (`WaitlistDialog.tsx`) for a heavy user, on the visits the deep-use latch picks email.
 *
 * Owner, Oct 28 2026: heavy users should be asked to donate a bit more than half the time
 * and to sign up for email a bit less than half the time (`chooseDeepUseAsk`,
 * src/lib/deep-use-ask.js — 60/40 while both are eligible). Email signups had been zero
 * since Oct 5: the auto-opening dialog brought in 188 of the first 192, and its replacement
 * strip almost never showed once the donation prompt took the deep-use moment.
 *
 * It renders nothing. It waits with the donation prompt's manners (`useDeepUsePause`: a
 * 3-second pause, never over another dialog, sheet or popover, never into a hidden tab),
 * then sets the dialog's source to `'deep-use'` and opens it. The dialog does the rest:
 * it keeps the soft keyboard down for this unrequested open, sends the signup with
 * `source: 'deep-use'`, and on a close without a signup writes `bb_email_prompt` (30 days
 * quiet) and the shared `bb_waitlist_dismissed`. Analytics: `email_prompt` with `action`
 * shown / submit / later, mirroring `donate_prompt`.
 */

import { useState } from 'react';

import { emailPromptEligible } from '@/lib/email-prompt.js';
import { deepUseAskThisVisit, useDeepUsePause, useDeepUseTrigger } from '../state/deep-use';
import { engagementSnapshot, setWaitlistSource } from '../state/engagement';
import { safeLocalStorage } from '../state/storage';
import { useUi } from '../state/ui';

export default function EmailPrompt() {
  const triggered = useDeepUseTrigger();
  const { setWaitlistOpen } = useUi();
  const [opened, setOpened] = useState(false);

  const waiting = triggered && !opened && deepUseAskThisVisit() === 'email';

  useDeepUsePause(waiting, () => {
    setOpened(true);
    // The latch was decided when the trigger fired; the visitor may have answered the
    // dialog since (a `?waitlist=1` arrival that was still open then). A signup or a "no"
    // in the meantime ends this visit's email ask instead of reopening the dialog.
    if (!emailPromptEligible(safeLocalStorage(), Date.now(), { submitted: engagementSnapshot().submitted })) return;
    setWaitlistSource('deep-use');
    setWaitlistOpen(true);
  });

  return null;
}
