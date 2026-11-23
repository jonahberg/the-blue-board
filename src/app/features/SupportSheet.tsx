/**
 * "Cover a day" on a phone (Nov 22 2026): a small bottom sheet opened by the phone header's
 * support icon (`mobile-header`) or the More sheet's "Help cover a day" row (`mobile-more`).
 *
 * The icon used to go straight to the any-amount Stripe page: from Nov 12 to Nov 22 2026 it was
 * tapped 11 times and nobody paid. Now the amounts come first, in the site's existing words
 * (src/lib/cover-a-day.js `supportSheetCopy`): the core line; the line of truth about today when
 * /api/support-status can vouch for it, and nothing claimed when it cannot; the amount ladder
 * ($5, $10, $17, $100, Other amount), whose $17 names the day it would cover ("Cover today · $17")
 * when that can be said; and, when the status is known, a way to this month's calendar in About.
 * The About section's calendar (`CoverADay`) is not reused here: with it the sheet measured taller
 * than a 390×659 phone screen.
 *
 * Every link is labelled `<placement>-<amount>` or `<placement>-other` (`data-support`, which the
 * delegated listener counts as `support_click` and Stripe stores as the payment's placement). The
 * open itself is `support_open` (`state/support-sheet.ts`). It opens only on the visitor's own tap,
 * so it is not an engagement surface that pounces; being modal, it also keeps the deep-use email
 * dialog from opening over it. Escape, a tap on the dimmed board or the ✕ closes it, and focus
 * goes back to the control that opened it.
 *
 * The status is read when the sheet first opens (never on page load). Until it answers, the plain
 * ladder shows (no claim), with today's line's height kept so the ladder does not jump when it
 * arrives.
 */

import { useRef } from 'react';

import { Button } from '@/components/ui/button';
import { focusContentOnOpen } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { NAME_LINE, SUPPORT_SHEET_TITLE, supportSheetCopy } from '@/lib/cover-a-day.js';
import { closeSupportSheet, supportSheetOpener, useSupportSheet } from '../state/support-sheet';
import type { SupportSheetFrom } from '../state/support-sheet';
import { useSupportStatus } from '../state/support-status';
import type { SupportStatus } from '../state/support-status';
import { useUi } from '../state/ui';

const UNKNOWN: SupportStatus = { configured: false };

export default function SupportSheet() {
  const from = useSupportSheet();
  const { setDisclaimerOpen } = useUi();
  // The placement outlives the open state through the closing animation, so the links keep
  // their labels while they slide away.
  const last = useRef<SupportSheetFrom>('mobile-header');
  if (from) last.current = from;
  const placement = last.current;

  const loaded = useSupportStatus(from !== null);
  const copy = supportSheetCopy(loaded ?? UNKNOWN, placement);

  const returnFocus = (event: Event) => {
    const control = supportSheetOpener();
    if (!control) return;
    event.preventDefault();
    control.focus();
  };

  const openAbout = () => {
    // Close, then open, as the More sheet's About row does.
    closeSupportSheet();
    setDisclaimerOpen(true);
  };

  return (
    <Sheet open={from !== null} onOpenChange={(open) => (open ? undefined : closeSupportSheet())}>
      <SheetContent
        side="bottom"
        // The sheet itself takes focus, announced by its title, rather than ringing the $5.
        onOpenAutoFocus={focusContentOnOpen}
        onCloseAutoFocus={returnFocus}
        className="max-h-[85dvh] gap-0 overflow-y-auto rounded-t-xl"
      >
        <div className="p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <SheetTitle className="pr-12">{SUPPORT_SHEET_TITLE}</SheetTitle>
          <SheetDescription className="mt-1 text-foreground">{copy.core}</SheetDescription>
          {loaded === null || copy.today ? <p className="mt-2 min-h-5 font-semibold">{copy.today}</p> : null}

          {copy.ladder ? (
            <div className="mt-3 flex flex-wrap items-center gap-2" data-support-ladder>
              {copy.ladder.amounts.map((step) => (
                <Button key={step.amount} asChild variant={step.primary ? 'default' : 'outline'} className="min-h-11 px-3">
                  <a href={step.href} target="_blank" rel="noopener noreferrer" data-support={step.placement}>
                    {step.text}
                  </a>
                </Button>
              ))}
              <a
                href={copy.ladder.other.href}
                target="_blank"
                rel="noopener noreferrer"
                data-support={copy.ladder.other.placement}
                className="inline-flex min-h-11 items-center px-1 text-primary underline underline-offset-2"
              >
                {copy.ladder.other.text}
              </a>
            </div>
          ) : copy.help ? (
            <Button asChild className="mt-3 min-h-11">
              <a href={copy.help.href} target="_blank" rel="noopener noreferrer" data-support={copy.help.placement}>
                {copy.help.text}
              </a>
            </Button>
          ) : null}

          <p className="mt-3 text-xs text-muted-foreground">{NAME_LINE}</p>
          {copy.about ? (
            <button
              type="button"
              onClick={openAbout}
              className="inline-flex min-h-11 items-center text-xs text-primary underline underline-offset-2"
            >
              {copy.about}
            </button>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
