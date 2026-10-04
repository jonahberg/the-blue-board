/**
 * "✈ Stay in the loop" — the email-capture modal (inventory §11, §16).
 *
 * Since Oct 2026 this dialog only opens because someone ASKED for it:
 *   T4     `?waitlist=1`, someone arriving on the link deliberately (source `popup`, as it
 *          always was);
 *   strip  the "Get updates" button on the `WaitlistStrip` (source `dashboard`).
 * The two passive triggers — T1 (five minutes of use) and T2 (the click threshold) — used to
 * pop this modal over the board uninvited (phone QA, Oct 3 2026). They now reveal the strip
 * instead; see `WaitlistStrip.tsx` and `shouldShowWaitlistStrip()`. (T3, the flight-landing
 * trigger, went earlier: that moment gets its own BMAC toast — inventory §12.)
 *
 * Every open is a request, so Radix's autofocus on the email field is right for all of them.
 * The submitted flag still outranks every open: someone who has already given an email is
 * never asked again, however they arrive.
 */

import { useCallback, useEffect, useState } from 'react';

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
import { postWaitlist } from '../data/api';
import {
  initEngagement,
  markWaitlistShown,
  markWaitlistSubmitted,
  setWaitlistSource,
  useEngagement,
} from '../state/engagement';
import { STORAGE_KEYS, writeString } from '../state/storage';
import { useUi } from '../state/ui';

/** `main.js:8079` — deliberately loose. The POST is what actually validates. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function WaitlistDialog() {
  const { waitlistOpen, setWaitlistOpen } = useUi();
  const engagement = useEngagement();

  const [email, setEmail] = useState('');
  const [feature, setFeature] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    initEngagement();
  }, []);

  // T4 — `?waitlist=1` (`state/deep-links.ts` already flips `waitlistOpen`) and the strip's
  // button both just set `waitlistOpen`. Record that the modal has been seen this session.
  useEffect(() => {
    if (waitlistOpen) markWaitlistShown();
  }, [waitlistOpen]);

  /**
   * Every close path — ✕, Escape, backdrop — writes the dismissal timestamp. The strip reads
   * it as a 30-day "not now" (`shouldShowWaitlistStrip`); `?waitlist=1` deliberately ignores
   * it, because arriving on that link is the request.
   */
  const close = useCallback(() => {
    setWaitlistOpen(false);
    markWaitlistShown();
    writeString(STORAGE_KEYS.waitlistDismissed, String(Date.now()));
    setWaitlistSource('popup');
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
        source: engagement.waitlistSource,
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
  }, [email, feature, engagement.waitlistSource]);

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
            <p className="mt-2 text-base font-semibold text-bb-ok">You&rsquo;re on the list! ✈</p>
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
              <p id="waitlist-error" role="alert" className="text-xs text-destructive">
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
