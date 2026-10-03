/**
 * The phone bottom bar.
 *
 * Four primary destinations plus a "More" sheet for the other four. Which tabs are primary
 * is declared once in `src/app/tabs.ts` (`mobilePrimary`) rather than duplicated here — the
 * old bar hard-coded its overflow list and silently desynced when My Flights was promoted,
 * lighting up two buttons at once and none for Fleet or Starlink.
 *
 * Below the tabs the sheet carries About and a Support link (v1.11.3). The ⓘ menu that holds
 * them on desktop sits in the attribution strip, which is hidden below `md:`, so on a phone the
 * About dialog — the independence statement, the "not for operational or safety-critical
 * decisions" line and the Supporters Wall — and every donate link were unreachable. Both rows
 * are plain list items: nothing here opens by itself or asks for anything.
 */

import { BadgeInfo, CircleHelp, Coffee, Ellipsis } from 'lucide-react';
import { useState } from 'react';

import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { useUi } from '../state/ui';
import { TABS } from '../tabs';
import type { TabId } from '../tabs';

const ROW = 'flex min-h-11 w-full items-center gap-3 rounded-md px-2 text-sm';

export function MobileNav({
  tab,
  onSelect,
  onOpenHelp,
}: {
  tab: TabId;
  onSelect: (id: TabId) => void;
  /** Reopens the welcome dialog — the header's "?" gives its phone slot to the support link. */
  onOpenHelp?: () => void;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const { setDisclaimerOpen } = useUi();
  const primary = TABS.filter((entry) => entry.mobilePrimary);
  const overflow = TABS.filter((entry) => !entry.mobilePrimary);
  const overflowActive = overflow.some((entry) => entry.id === tab);

  return (
    <nav
      aria-label="Dashboard navigation"
      className="flex shrink-0 items-stretch border-t bg-background pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      {primary.map((entry) => (
        <button
          key={entry.id}
          type="button"
          onClick={() => onSelect(entry.id)}
          aria-current={tab === entry.id ? 'page' : undefined}
          className={cn(
            'flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-[10px]',
            tab === entry.id ? 'text-primary' : 'text-muted-foreground',
          )}
        >
          <entry.icon aria-hidden="true" className="size-5" />
          {entry.shortLabel}
        </button>
      ))}

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetTrigger
          className={cn(
            'flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-[10px]',
            overflowActive ? 'text-primary' : 'text-muted-foreground',
          )}
        >
          <Ellipsis aria-hidden="true" className="size-5" />
          More
        </SheetTrigger>
        <SheetContent side="bottom" className="data-[side=bottom]:h-auto">
          <SheetHeader>
            <SheetTitle>More</SheetTitle>
          </SheetHeader>
          <ul className="px-4 pb-8">
            {overflow.map((entry) => (
              <li key={entry.id}>
                <button
                  type="button"
                  className={cn(ROW, tab === entry.id ? 'text-primary' : 'text-foreground')}
                  onClick={() => {
                    onSelect(entry.id);
                    setMoreOpen(false);
                  }}
                >
                  <entry.icon aria-hidden="true" className="size-4" />
                  {entry.label}
                </button>
              </li>
            ))}
            {onOpenHelp ? (
              <li className="mt-2 border-t pt-2">
                <button
                  type="button"
                  className={cn(ROW, 'text-foreground')}
                  onClick={() => {
                    setMoreOpen(false);
                    onOpenHelp();
                  }}
                >
                  <CircleHelp aria-hidden="true" className="size-4" />
                  What is this dashboard?
                </button>
              </li>
            ) : null}
            <li className={onOpenHelp ? undefined : 'mt-2 border-t pt-2'}>
              <button
                type="button"
                className={cn(ROW, 'text-foreground')}
                onClick={() => {
                  // Same close-then-open as the desktop ⓘ menu's About link (LegalPopover).
                  setMoreOpen(false);
                  setDisclaimerOpen(true);
                }}
              >
                <BadgeInfo aria-hidden="true" className="size-4" />
                About
              </button>
            </li>
            <li>
              <a
                href="https://buymeacoffee.com/notjbg"
                target="_blank"
                rel="noopener noreferrer"
                data-support="mobile-more"
                className={cn(ROW, 'text-muted-foreground')}
              >
                <Coffee aria-hidden="true" className="size-4" />
                Support The Blue Board
              </a>
            </li>
          </ul>
        </SheetContent>
      </Sheet>
    </nav>
  );
}
