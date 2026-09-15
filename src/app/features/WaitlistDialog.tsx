/**
 * "✈ Stay in the loop" — the email-capture modal and the three triggers that raise it
 * (inventory §11, §16).
 *
 * Four triggers, only one of which is a user action:
 *   T1  five minutes of active use
 *   T2  the click threshold — 20 for a first-time visitor, 30 for a returning one
 *   T4  `?waitlist=1`, which is someone arriving on the link deliberately
 * (T3, the flight-landing trigger, is deliberately NOT here any more: forcing this modal
 * open at the moment a flight lands muddied the one moment the app had clearly delivered
 * something. That moment gets its own BMAC toast — inventory §12.)
 *
 * The passive triggers go through `shouldShowWaitlist()`, which composes the storage rules
 * in `src/lib/engagement.js` with the session guard. T4 bypasses those but NOT the
 * submitted flag: someone who has already given an email is never asked again, however
 * they arrive.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { TRIGGER_TIME_MS } from '@/lib/engagement.js';
import { clicksReachedThreshold, shouldShowWaitlist } from '@/lib/waitlist-gate.js';
import { postWaitlist } from '../data/api';
import {
  initEngagement,
  markWaitlistShown,
  markWaitlistSubmitted,
  useEngagement,
} from '../state/engagement';
import { STORAGE_KEYS, safeLocalStorage, writeString } from '../state/storage';
import { useUi } from '../state/ui';

/** `main.js:8079` — deliberately loose. The POST is what actually validates. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const NULL_STORAGE = { getItem: () => null };

export default function WaitlistDialog() {
  const { waitlistOpen, setWaitlistOpen, onboardingOpen } = useUi();
  const engagement = useEngagement();

  const [email, setEmail] = useState('');
  const [feature, setFeature] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    initEngagement();
  }, []);

  // The gate reads live state, so it is held in a ref rather than captured by the timer's
  // closure: a five-minute timeout that closed over `shownThisSession: false` at mount
  // would still fire after the visitor had already seen and dismissed the modal.
  const gate = useRef({ engagement, onboardingOpen });
  gate.current = { engagement, onboardingOpen };

  const tryOpen = useCallback(() => {
    const { engagement: eng, onboardingOpen: obOpen } = gate.current;
    if (!eng.ready) return;
    const allowed = shouldShowWaitlist(safeLocalStorage() ?? NULL_STORAGE, {
      shownThisSession: eng.shownThisSession,
      submitted: eng.submitted,
      onboardingVisible: obOpen,
    });
    if (!allowed) return;
    markWaitlistShown();
    setWaitlistOpen(true);
  }, [setWaitlistOpen]);

  // T1 — five minutes of active use.
  useEffect(() => {
    const timer = setTimeout(tryOpen, TRIGGER_TIME_MS as number);
    return () => clearTimeout(timer);
  }, [tryOpen]);

  // T2 — the click threshold. `engagement.clicks` is incremented by one document-level
  // listener in the store, and the comparison is equality so this fires once rather than
  // re-running the gate on every click from the 30th onwards.
  useEffect(() => {
    if (clicksReachedThreshold(engagement.clicks, engagement.triggerClicks)) tryOpen();
  }, [engagement.clicks, engagement.triggerClicks, tryOpen]);

  // T4 — `?waitlist=1` (`state/deep-links.ts` already flips `waitlistOpen`). Nothing to do
  // beyond recording that the modal has now been seen this session.
  useEffect(() => {
    if (waitlistOpen) markWaitlistShown();
  }, [waitlistOpen]);

  /** Every close path — ✕, Escape, backdrop — writes the 7-day dismissal. */
  const close = useCallback(() => {
    setWaitlistOpen(false);
    markWaitlistShown();
    writeString(STORAGE_KEYS.waitlistDismissed, String(Date.now()));
  }, [setWaitlistOpen]);

  const submit = useCallback(async () => {
    const value = email.trim();
    if (!value || !EMAIL_RE.test(value)) {
      setError('Please enter a valid email address.');
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      const data = await postWaitlist({
        email: value,
        source: 'popup',
        featureRequest: feature.trim() || undefined,
      });
      // A duplicate IS a success from the visitor's side — they are on the list. Telling
      // them "that email is already registered" reads as a rejection of something they
      // just did correctly.
      if (data.success || data.error === 'duplicate') {
        writeString(STORAGE_KEYS.waitlistSubmitted, 'true');
        markWaitlistSubmitted();
        setDone(true);
        return;
      }
      setError(data.error || 'Something went wrong. Please try again.');
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }, [email, feature]);

  // The submitted flag outranks the open flag, T4 included — someone who has already given
  // an email is never asked again, however they arrive.
  //
  // `done` is the exception, and it has to be: submitting sets BOTH the store's `submitted`
  // and this local flag, and React batches them into one render. Without `done` in the
  // condition that render closes the dialog, so the "You're on the list" card never paints —
  // the modal would simply vanish the instant someone signed up, which reads as a failure.
  // `done` is local state, so it dies with the dialog and cannot reopen it later.
  const open = waitlistOpen && (done || !engagement.submitted);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      {/* z-[60] on BOTH halves: the onboarding overlay is the one other root dialog that
          can be up at the same time, and it sits at the shared z-50. Someone who followed
          `?waitlist=1` asked for THIS modal, so it has to outrank the welcome overlay the
          way legacy did with z 10001 > 10000. `DialogContent` renders its own overlay, so
          the lift has to be passed through — content alone would leave the waitlist card
          floating above onboarding's backdrop but below its own. */}
      <DialogContent className="z-[60] sm:max-w-[480px]" overlayClassName="z-[60]">
        <DialogHeader>
          <DialogTitle className="text-xl">✈ Stay in the loop</DialogTitle>
          <DialogDescription>
            Get launch updates and new-feature announcements — no spam.
          </DialogDescription>
        </DialogHeader>

        {done ? (
          <div className="py-5 text-center">
            <div aria-hidden="true" className="text-3xl">
              ✈️
            </div>
            <p className="mt-2 text-base font-semibold text-emerald-400">You&rsquo;re on the list! ✈</p>
            <p className="mt-2 text-xs text-muted-foreground">
              We&rsquo;ll keep you posted on launch updates.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="waitlist-email" className="sr-only">
                Email address
              </Label>
              <Input
                id="waitlist-email"
                type="email"
                autoComplete="email"
                placeholder="Email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void submit();
                }}
                aria-invalid={Boolean(error) || undefined}
                aria-describedby={error ? 'waitlist-error' : undefined}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="waitlist-feature" className="sr-only">
                Feature request
              </Label>
              <Textarea
                id="waitlist-feature"
                rows={3}
                placeholder="Any features you'd love to see? (optional)"
                value={feature}
                onChange={(event) => setFeature(event.target.value)}
              />
            </div>

            {error ? (
              <p id="waitlist-error" role="alert" className="text-xs text-red-400">
                {error}
              </p>
            ) : null}

            <Button className="min-h-11 w-full" disabled={submitting} onClick={() => void submit()}>
              {submitting ? 'Submitting…' : 'Stay in the Loop'}
            </Button>

            <p className="text-xs text-muted-foreground">✓ No spam, just launch updates</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
