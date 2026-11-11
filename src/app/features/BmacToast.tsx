/**
 * "Glad you landed ✈️" — the one donation ask, at the one moment the dashboard has
 * demonstrably done its job (inventory §12).
 *
 * The frequency cap is not politeness, it is the whole design: this used to force the
 * generic email/donate modal open the instant a watched flight landed, which turned the
 * payoff into a toll booth. Now it is a small toast, once per fortnight, with a close
 * button and no backdrop — a visitor who ignores it loses nothing.
 *
 * The cooldown (`bmacEligible`) and the three-second delay live in `state/ui.tsx` behind
 * `showBmacToast()`, so `state/schedule.tsx` can call it with just an ident.
 *
 * Since Nov 2026 it speaks in the site's "cover a day" unit ($17 keeps it running for a day,
 * src/lib/cover-a-day.js). It makes no claim about whether today is covered: it has not
 * fetched the status, and a thank-you for a landing does not need one.
 *
 * Positioned bottom-LEFT. The legacy toast sat at `bottom:16px; right:16px`, directly on
 * top of Leaflet's zoom-out button — the same corner that swallowed the About popover and
 * that `tests/leaflet-required-styles.test.js` now guards.
 */

import { X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { DAILY_COST_USD } from '@/lib/cover-a-day.js';
import { supportUrl } from '@/lib/support-link.js';
import { STORAGE_KEYS, writeString } from '../state/storage';
import { useUi } from '../state/ui';

export default function BmacToast() {
  const { bmacToast, dismissBmacToast } = useUi();
  if (!bmacToast) return null;

  const dismiss = () => {
    writeString(STORAGE_KEYS.bmacDismissed, String(Date.now()));
    dismissBmacToast();
  };

  return (
    <div
      role="status"
      className="fixed bottom-24 left-3 z-[70] max-w-[300px] rounded-lg border bg-card p-3.5 pr-12 shadow-lg md:bottom-4 md:left-4 md:pr-9"
    >
      <Button
        variant="ghost"
        size="sm"
        aria-label="Dismiss"
        className="absolute right-0.5 top-0.5 h-11 w-11 p-0 text-muted-foreground md:right-1 md:top-1 pointer-fine:md:h-7 pointer-fine:md:w-7"
        onClick={dismiss}
      >
        <X aria-hidden="true" />
      </Button>
      <p className="text-xs leading-relaxed">
        Glad you landed ✈️ If The Blue Board helped today, ${DAILY_COST_USD} keeps it running for a day.
      </p>
      <a
        href={supportUrl('landed-toast')}
        target="_blank"
        rel="noopener noreferrer"
        data-support="landed-toast"
        className="mt-2.5 inline-flex min-h-11 items-center rounded-md bg-primary-fill px-4 text-xs font-semibold text-primary-foreground pointer-fine:md:min-h-9"
      >
        Cover a day · ${DAILY_COST_USD}
      </a>
    </div>
  );
}
