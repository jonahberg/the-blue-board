/**
 * The full brief as a sheet, opened from the header row: a bottom sheet below `lg` (over the
 * map, as a flight opens), a right-hand panel at `lg`+ on the tabs that do not already show the
 * brief in their sidebar.
 *
 * Modal, unlike the flight panel: a flight sits beside a map the visitor keeps using, whereas
 * the brief is something to read and then leave, and every chip in it navigates away. Modal
 * gives the focus trap, Escape, a tap on the dimmed map to close, and keeps the deep-use asks
 * from opening over it (they wait while any `role="dialog"` is open).
 *
 * One-handed: the body is 16 px, the sheet stops at 85dvh and scrolls, and a full-width Close
 * sits at the end of the text, where the thumb already is when the reading is done.
 */

import { Button } from '@/components/ui/button';
import { focusContentOnOpen } from '@/components/ui/dialog';
import { Sheet, SheetClose, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { useBrief } from '../state/brief';
import { useMediaQuery } from '../state/hooks';
import { BriefBody } from './BriefPanel';

export default function BriefSheet() {
  const { view, sheetOpen, setSheetOpen } = useBrief();
  const wide = useMediaQuery('(min-width: 1024px)');

  return (
    <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
      <SheetContent
        side={wide ? 'right' : 'bottom'}
        aria-describedby={undefined}
        // The sheet itself takes focus, not the first chip: announced by its title, and a phone
        // does not scroll to (or ring) a link the visitor has not reached yet.
        onOpenAutoFocus={focusContentOnOpen}
        className={
          wide
            ? 'w-full gap-0 overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-md'
            : 'max-h-[85dvh] gap-0 overflow-y-auto rounded-t-xl'
        }
      >
        {view.status === 'ready' ? (
          <div className="p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <BriefBody
              view={view}
              variant="sheet"
              renderHeadline={(text, className) => <SheetTitle className={className}>{text}</SheetTitle>}
            />
            {!wide ? (
              <SheetClose asChild>
                <Button variant="outline" className="mt-4 min-h-11 w-full">
                  Close
                </Button>
              </SheetClose>
            ) : null}
          </div>
        ) : (
          <SheetTitle className="sr-only">The brief</SheetTitle>
        )}
      </SheetContent>
    </Sheet>
  );
}
