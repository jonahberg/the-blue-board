/**
 * "🔔 UA1234 ORD→DEN: Departed (was: Scheduled)" — a watched flight changed while you were
 * looking at the page (inventory §6).
 *
 * The native `Notification` is only fired when the document is HIDDEN; someone watching the
 * board does not want an OS toast for something happening in front of them, but they do need
 * to see it, because the row that changed may be scrolled far out of view. Ten seconds and
 * then it leaves on its own — this is a nudge, not a modal.
 *
 * The store also routes the same sentence through the shell's single polite live region, so
 * a screen-reader user hears it once, from one writer.
 *
 * Mounted inside the Schedule view for now. It belongs in the shell alongside the other
 * global banners, which is Task 8's territory — noted in the Task 3 report.
 */

import { useEffect } from 'react';

import { Button } from '@/components/ui/button';

const AUTO_HIDE_MS = 10000;

export function WatchBanner({
  alert,
  onDismiss,
}: {
  alert: { message: string; key: number } | null;
  onDismiss: () => void;
}) {
  useEffect(() => {
    if (!alert) return undefined;
    const timer = setTimeout(onDismiss, AUTO_HIDE_MS);
    return () => clearTimeout(timer);
  }, [alert, onDismiss]);

  if (!alert) return null;

  return (
    <div className="flex items-center gap-2 rounded-md border border-primary/40 bg-primary/10 px-2.5 py-1.5 text-[11px]">
      <span className="flex-1">{alert.message}</span>
      <Button
        variant="ghost"
        size="sm"
        className="h-auto min-h-11 px-2 py-0 text-[11px] md:min-h-0"
        onClick={onDismiss}
      >
        Dismiss
      </Button>
    </div>
  );
}
