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
 * Mounted in the shell, not in the Schedule view: a status change arrives from whichever
 * board last loaded, and the viewer may well be on Live or My Flights when it does. A
 * banner that only exists on one tab is a notification that fires into an empty room.
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

  // One 32 px strip like the rows around it (Nov 2026: it was a rounded, bordered card inside
  // the full-width chrome, 56 px tall because its 44 px button set the height). It mounts above
  // the view, so it is kept as short as the news strip: the Dismiss button keeps a 44 px hit
  // area through its `after:` box, the NewsBanner pattern, not by making the row 44 px (7 px: the
  // box is measured from inside the button's 1 px border).
  return (
    <div className="flex h-8 shrink-0 items-center gap-2 border-b bg-primary/10 px-3 text-[11px] md:px-4">
      <span className="min-w-0 flex-1 truncate" title={alert.message}>
        {alert.message}
      </span>
      <Button
        variant="ghost"
        size="sm"
        className="relative h-8 shrink-0 px-2 py-0 text-[11px] after:absolute after:inset-x-0 after:-inset-y-[7px]"
        onClick={onDismiss}
      >
        Dismiss
      </Button>
    </div>
  );
}
