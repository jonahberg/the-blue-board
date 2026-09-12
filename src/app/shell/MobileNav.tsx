/**
 * The phone bottom bar.
 *
 * Four primary destinations plus a "More" sheet for the other four. Which tabs are primary
 * is declared once in `src/app/tabs.ts` (`mobilePrimary`) rather than duplicated here — the
 * old bar hard-coded its overflow list and silently desynced when My Flights was promoted,
 * lighting up two buttons at once and none for Fleet or Starlink.
 */

import { useState } from 'react';

import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { TABS } from '../tabs';
import type { TabId } from '../tabs';

export function MobileNav({
  tab,
  onSelect,
}: {
  tab: TabId;
  onSelect: (id: TabId) => void;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
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
          <span aria-hidden="true" className="text-base leading-none">
            {entry.icon}
          </span>
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
          <span aria-hidden="true" className="text-base leading-none">
            ▾
          </span>
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
                  className={cn(
                    'flex min-h-11 w-full items-center gap-3 rounded-md px-2 text-sm',
                    tab === entry.id ? 'text-primary' : 'text-foreground',
                  )}
                  onClick={() => {
                    onSelect(entry.id);
                    setMoreOpen(false);
                  }}
                >
                  <span aria-hidden="true">{entry.icon}</span>
                  {entry.label}
                </button>
              </li>
            ))}
          </ul>
        </SheetContent>
      </Sheet>
    </nav>
  );
}
