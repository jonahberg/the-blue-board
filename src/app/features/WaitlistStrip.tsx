/**
 * "✈ Stay in the loop" as a STRIP, not a popup (Oct 2026).
 *
 * The waitlist modal used to open by itself after five minutes of use (T1) or once a visitor
 * passed the click threshold (T2) — on a phone, straight over the schedule board they were
 * reading (QA, Oct 3 2026). Jonah's call: the passive ask becomes this slim, dismissible line
 * in the engagement slot below the panel, above the mobile nav. It never covers the board or
 * the navigation, and it waits for the visitor rather than interrupting them. The dialog
 * still opens — but only when someone asks: this strip's "Get updates" button, or the
 * `?waitlist=1` link.
 *
 * It has to be SEEN, though: 188 of the 192 signups to date came through the popup. So the
 * strip is a filled primary button on the primary-tinted band rather than a muted footnote,
 * and on a phone it outranks the news and tip lines for the one engagement row the slot shows
 * there (`Dashboard.tsx`).
 *
 * The rules — triggered, not submitted, not dismissed within 30 days — live in
 * `shouldShowWaitlistStrip()` (`src/lib/waitlist-gate.js`), which reads the dialog's own two
 * storage keys, so saying no to either surface quiets both. Signups that come through here
 * are sent with `source: 'dashboard'` (the dialog's link-driven ones keep `popup`), which is
 * how the two can be compared.
 *
 * Since Oct 2026 the T1/T2 trigger lives in `state/deep-use.ts` and is shared with the
 * donation prompt: the first time it fires, ONE of the two asks is latched for the visit.
 * Heavy users get the donation prompt while it is eligible, and this strip while it cools
 * down (`chooseDeepUseAsk`, src/lib/donate-prompt.js).
 *
 * No live region: a strip arriving five minutes in is not news, and the live-region inventory
 * in DESIGN.md is closed. Its buttons are `data-no-engagement` so they never advance the T2
 * counter that summoned the strip in the first place.
 */

import { Mail, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { track } from '@/lib/track.js';
import { shouldShowWaitlistStrip } from '@/lib/waitlist-gate.js';
import { deepUseAskThisVisit, useDeepUseTrigger } from '../state/deep-use';
import { setWaitlistSource, useEngagement } from '../state/engagement';
import { STORAGE_KEYS, safeLocalStorage, writeString } from '../state/storage';
import { useUi } from '../state/ui';

export { T2_SETTLE_MS } from '../state/deep-use';

export default function WaitlistStrip() {
  // Subscribing to the UI store also re-renders this when the dialog closes.
  const { setWaitlistOpen } = useUi();
  const engagement = useEngagement();
  const triggered = useDeepUseTrigger();
  const [dismissed, setDismissed] = useState(false);

  // Re-read on every render: closing the dialog writes the dismissal and submitting flips
  // `submitted`, and either has to take the strip away with it.
  const visible =
    !dismissed &&
    engagement.ready &&
    triggered &&
    deepUseAskThisVisit() === 'waitlist' &&
    shouldShowWaitlistStrip(safeLocalStorage(), {
      triggered,
      submitted: engagement.submitted,
    });

  const shownTracked = useRef(false);
  useEffect(() => {
    if (!visible || shownTracked.current) return;
    shownTracked.current = true;
    track('waitlist_strip', { action: 'shown' });
  }, [visible]);

  const open = useCallback(() => {
    track('waitlist_strip', { action: 'open' });
    setWaitlistSource('dashboard');
    setWaitlistOpen(true);
  }, [setWaitlistOpen]);

  const dismiss = useCallback(() => {
    track('waitlist_strip', { action: 'dismiss' });
    writeString(STORAGE_KEYS.waitlistDismissed, String(Date.now()));
    setDismissed(true);
  }, []);

  if (!visible) return null;

  return (
    <div
      data-no-engagement
      className="flex h-10 shrink-0 items-center gap-2 border-t border-primary/40 bg-primary/10 px-3 text-xs"
    >
      <Mail aria-hidden="true" className="size-4 shrink-0 text-primary" />
      <p className="min-w-0 flex-1 truncate">
        <span className="font-semibold">Stay in the loop</span>
        <span className="text-muted-foreground sm:hidden"> — no spam</span>
        <span className="hidden text-muted-foreground sm:inline">
          {' '}
          — get launch updates and new-feature announcements, no spam.
        </span>
      </p>
      {/* 32 px buttons in a 40 px band; each keeps a 44 px hit area through its `after:` box. */}
      <Button
        size="sm"
        className="relative h-8 shrink-0 px-3 text-xs after:absolute after:inset-x-0 after:-inset-y-1.5"
        onClick={open}
      >
        Get updates
      </Button>
      <Button
        variant="ghost"
        size="sm"
        aria-label="Dismiss the updates sign-up"
        className="relative h-8 min-w-11 shrink-0 px-2 after:absolute after:inset-x-0 after:-inset-y-1.5"
        onClick={dismiss}
      >
        <X aria-hidden="true" />
      </Button>
    </div>
  );
}
