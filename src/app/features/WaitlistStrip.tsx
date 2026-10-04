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
 * No live region: a strip arriving five minutes in is not news, and the live-region inventory
 * in DESIGN.md is closed. Its buttons are `data-no-engagement` so they never advance the T2
 * counter that summoned the strip in the first place.
 */

import { Mail, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { TRIGGER_TIME_MS } from '@/lib/engagement.js';
import { track } from '@/lib/track.js';
import { clicksReachedThreshold, shouldShowWaitlistStrip } from '@/lib/waitlist-gate.js';
import { initEngagement, setWaitlistSource, useEngagement } from '../state/engagement';
import { STORAGE_KEYS, safeLocalStorage, writeString } from '../state/storage';
import { useUi } from '../state/ui';

/**
 * T2 waits for the clicking to stop before the strip appears: a quiet spell of this long means
 * the visitor has paused. Another click restarts the wait.
 */
export const T2_SETTLE_MS = 2000;

export default function WaitlistStrip() {
  // Subscribing to the UI store also re-renders this when the dialog closes.
  const { setWaitlistOpen } = useUi();
  const engagement = useEngagement();
  const [triggered, setTriggered] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    initEngagement();
  }, []);

  // T1 — five minutes of use.
  useEffect(() => {
    const timer = setTimeout(() => setTriggered(true), TRIGGER_TIME_MS as number);
    return () => clearTimeout(timer);
  }, []);

  // T2 — the click threshold (20 new / 30 returning), counted by the store's document-level
  // listener with navigation clicks excluded. Equality ARMS it once; it fires after the pause.
  const t2Armed = useRef(false);
  const t2Timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (clicksReachedThreshold(engagement.clicks, engagement.triggerClicks)) t2Armed.current = true;
    if (!t2Armed.current) return;
    if (t2Timer.current) clearTimeout(t2Timer.current);
    t2Timer.current = setTimeout(() => {
      t2Armed.current = false;
      t2Timer.current = null;
      setTriggered(true);
    }, T2_SETTLE_MS);
  }, [engagement.clicks, engagement.triggerClicks]);
  useEffect(
    () => () => {
      if (t2Timer.current) clearTimeout(t2Timer.current);
    },
    [],
  );

  // Re-read on every render: closing the dialog writes the dismissal and submitting flips
  // `submitted`, and either has to take the strip away with it.
  const visible =
    !dismissed &&
    engagement.ready &&
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
