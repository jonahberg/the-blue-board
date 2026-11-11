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
 * are plain list items: nothing here opens by itself or asks for anything. The last row is the
 * "Built by Jonah Berg" credit, for the same reason (v1.22.1).
 *
 * A "Home hub" row sits between the tabs and those links (Nov 2026). The header's hub button is
 * `hidden md:inline-flex`, so a phone could only reach the picker through "What is this
 * dashboard?". It is the same picker (the shadcn Select, the same nine hubs from
 * src/lib/home-hub-options.js) and the same setter (`usePrefs().setHomeAirport`), and it saves
 * on pick. Here "No preference" is a real choice and clears the hub: the control shows the hub
 * that is set, so picking it is an instruction, not a default left untouched.
 */

import { BadgeInfo, CircleHelp, Ellipsis, HandHeart, House, Newspaper, UserRound } from 'lucide-react';
import { useState } from 'react';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { HOME_HUB_OPTIONS } from '@/lib/home-hub-options.js';
import { supportUrl } from '@/lib/support-link.js';
import { cn } from '@/lib/utils';
import { usePrefs } from '../state/prefs';
import { useUi } from '../state/ui';
import { TABS } from '../tabs';
import type { TabId } from '../tabs';

const ROW = 'flex min-h-11 w-full items-center gap-3 rounded-md px-2 text-sm';

/** Radix `Select` cannot hold "" as a value, so the no-preference slot needs a sentinel. */
const NO_PREFERENCE = '__none__';

/** The More sheet's home-hub row: label, then the picker, saved the moment a hub is picked. */
function HomeHubRow() {
  const { homeAirport, setHomeAirport } = usePrefs();
  return (
    <div className={cn(ROW, 'text-foreground')}>
      <House aria-hidden="true" className="size-4 shrink-0" />
      <label htmlFor="mobile-home-hub" className="shrink-0">
        Home hub
      </label>
      <Select
        value={homeAirport || NO_PREFERENCE}
        onValueChange={(value) => setHomeAirport(value === NO_PREFERENCE ? '' : value)}
      >
        <SelectTrigger id="mobile-home-hub" className="ml-auto min-h-11 min-w-0 flex-1 justify-between">
          <SelectValue placeholder="No preference" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NO_PREFERENCE} className="min-h-11">
            No preference
          </SelectItem>
          {HOME_HUB_OPTIONS.map((option) => (
            <SelectItem key={option.code} value={option.code} className="min-h-11">
              {option.code} — {option.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

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
          <ul className="px-4 pb-[max(2rem,env(safe-area-inset-bottom))]">
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
            {/* The news strip is not shown on the phone Live tab (Nov 2026), so the stories are
                one tap from the More sheet instead. A page, not a tab: a plain link. */}
            <li>
              <a href="/news" className={cn(ROW, 'text-foreground')}>
                <Newspaper aria-hidden="true" className="size-4" />
                News
              </a>
            </li>
            <li className="mt-2 border-t pt-2">
              <HomeHubRow />
            </li>
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
                href={supportUrl('mobile-more')}
                target="_blank"
                rel="noopener noreferrer"
                data-support="mobile-more"
                className={cn(ROW, 'text-muted-foreground')}
              >
                <HandHeart aria-hidden="true" className="size-4" />
                Help cover a day
              </a>
            </li>
            {/* The author credit the attribution strip carries on md: and up. */}
            <li>
              <a
                href="https://jonahberg.com"
                target="_blank"
                rel="noopener noreferrer"
                className={cn(ROW, 'text-muted-foreground')}
              >
                <UserRound aria-hidden="true" className="size-4" />
                Built by Jonah Berg
              </a>
            </li>
          </ul>
        </SheetContent>
      </Sheet>
    </nav>
  );
}
