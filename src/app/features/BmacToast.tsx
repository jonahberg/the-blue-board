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
 * Positioned bottom-LEFT. The legacy toast sat at `bottom:16px; right:16px`, directly on
 * top of Leaflet's zoom-out button — the same corner that swallowed the About popover and
 * that `tests/leaflet-required-styles.test.js` now guards.
 */

import { Button } from '@/components/ui/button';
import { STORAGE_KEYS, writeString } from '../state/storage';
import { useUi } from '../state/ui';

/** Never "fix" this URL — the Buy Me a Coffee account is `notjbg`. */
const BMAC_URL = 'https://buymeacoffee.com/notjbg';

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
      className="fixed bottom-24 left-3 z-[70] max-w-[300px] rounded-lg border bg-card p-3.5 pr-9 shadow-lg md:bottom-4 md:left-4"
    >
      <Button
        variant="ghost"
        size="sm"
        aria-label="Dismiss"
        className="absolute right-1 top-1 h-7 w-7 p-0 text-muted-foreground"
        onClick={dismiss}
      >
        ✕
      </Button>
      <p className="text-xs leading-relaxed">
        Glad you landed ✈️ — if The Blue Board helped today, you can support the server costs.
      </p>
      <a
        href={BMAC_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-2.5 inline-flex min-h-11 items-center rounded-md bg-primary px-4 text-xs font-semibold text-primary-foreground md:min-h-9"
      >
        ☕ Buy Me a Coffee
      </a>
    </div>
  );
}
