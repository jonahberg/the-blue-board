/**
 * "Keep The Blue Board going" — the donation prompt for heavy users (Oct 2026).
 *
 * Owner, Oct 6 2026: "a pop up for donations if someone really is going deep on the site",
 * worded as "donate to support costs and keep the blue board going" (no coffee). It is the
 * one MODAL ask on the dashboard: DESIGN.md's "engagement surfaces stay quiet" rule bends
 * for it on the owner's call, and the rest of that rule is kept:
 *   - it comes up on the deep-use trigger (`state/deep-use.ts`, the email strip's T1/T2)
 *     and only when this visit's latched ask is the prompt (`deepUseAskThisVisit`);
 *   - it waits for a pause — `DONATE_QUIET_MS` with no tap, key or scroll — and never opens
 *     over another dialog, sheet or popover, or into a hidden tab (`donatePromptMayOpen`);
 *   - any close that isn't Donate is "Maybe later" and quiets it for 30 days; Donate
 *     quiets it for 90, since the dashboard cannot see whether they paid.
 *
 * Analytics: `donate_prompt` with `action` shown / donate / later, and the link's
 * `data-support="deep-use-prompt"` also counts as a `support_click` like every other
 * placement (src/lib/support-tracking.js).
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { donatePromptMayOpen, donatePromptRecord } from '@/lib/donate-prompt.js';
import { track } from '@/lib/track.js';
import { deepUseAskThisVisit, useDeepUseTrigger } from '../state/deep-use';
import { STORAGE_KEYS, writeString } from '../state/storage';

/** Never "fix" this URL — the Buy Me a Coffee account is `notjbg`. */
const DONATE_URL = 'https://buymeacoffee.com/notjbg';

/** How often a waiting prompt re-checks for a pause. */
const POLL_MS = 1000;

const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchmove', 'scroll'] as const;

function otherDialogOpen(): boolean {
  return document.querySelector('[role="dialog"], [role="alertdialog"]') !== null;
}

export default function DonatePrompt() {
  const triggered = useDeepUseTrigger();
  const [open, setOpen] = useState(false);
  const [answered, setAnswered] = useState(false);
  const lastActivity = useRef(0);

  const waiting = triggered && !answered && !open && deepUseAskThisVisit() === 'donate';

  // While waiting, every tap, key and scroll restarts the pause; the clock starts at the
  // trigger itself, so the prompt never lands on the very click that summoned it.
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
      if (may) setOpen(true);
    }, POLL_MS);
    return () => {
      clearInterval(poll);
      for (const name of ACTIVITY_EVENTS) window.removeEventListener(name, mark, { capture: true });
    };
  }, [waiting]);

  useEffect(() => {
    if (open) track('donate_prompt', { action: 'shown' });
  }, [open]);

  const answer = useCallback((outcome: 'later' | 'donate') => {
    writeString(STORAGE_KEYS.donatePrompt, donatePromptRecord(outcome));
    track('donate_prompt', { action: outcome });
    setAnswered(true);
    setOpen(false);
  }, []);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) answer('later');
      }}
    >
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle className="text-xl">Keep The Blue Board going</DialogTitle>
          <DialogDescription>
            Glad it&rsquo;s been useful. The Blue Board is free, with no ads. Donations cover the
            flight data and servers that keep it running.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" className="min-h-11 pointer-fine:md:min-h-9" onClick={() => answer('later')}>
            Maybe later
          </Button>
          <Button asChild className="min-h-11 pointer-fine:md:min-h-9">
            <a
              href={DONATE_URL}
              target="_blank"
              rel="noopener noreferrer"
              data-support="deep-use-prompt"
              onClick={() => answer('donate')}
            >
              Donate to keep it going
            </a>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
