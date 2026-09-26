/**
 * The ⓘ menu: About, legal, donate, the hub pages and the cost meter (inventory §13).
 *
 * WHERE this lives is a bug fix, not a preference. The shipped `#legal-details` was
 * `position: fixed` in the map's bottom-right corner, which is where Leaflet mounts its
 * zoom control — `document.elementFromPoint` at the zoom-out button's centre returned
 * `#legal-btn`, so clicking "−" opened this menu instead of zooming.
 * `tests/leaflet-required-styles.test.js` now fails any component that pins itself there.
 * The trigger is therefore rendered in flow, as the trailing item of the attribution strip,
 * which also reproduces the legacy behaviour of hiding it below `md:` (inventory §14).
 *
 * The hub links matter beyond navigation: they are the dashboard's only internal links to
 * the nine hub pages, and they are what tie the island to the crawlable site around it.
 *
 * `Dashboard.tsx` mounts the default export from the start of the rebuild. There is
 * nothing for it to render at the root — see the comment on it below.
 */

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useUi } from '../state/ui';
import { SupportMeter } from './SupportMeter';

const HUB_LINKS = ['ORD', 'DEN', 'IAH', 'EWR', 'SFO', 'IAD', 'LAX', 'NRT', 'GUM'];

function Ext({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={className ?? 'underline-offset-2 hover:underline'}
    >
      {children}
    </a>
  );
}

/**
 * The menu itself. Rendered by `shell/Attribution.tsx`, which is the in-flow strip that
 * already carries the data credits this menu repeats.
 */
export function LegalMenu() {
  const { setDisclaimerOpen } = useUi();
  const [open, setOpen] = useState(false);

  const openDisclaimer = () => {
    setOpen(false);
    setDisclaimerOpen(true);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 shrink-0 p-0 text-sm"
          title="About · Legal · Donate"
          aria-label="About, legal and donate links"
        >
          ⓘ
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" side="top" className="w-[300px] text-[11px]">
        <p className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          About · Legal · Support
        </p>

        {/* Fetches only once the popover has actually been opened. */}
        <SupportMeter active={open} />

        <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
          <button type="button" className="text-left underline-offset-2 hover:underline" onClick={openDisclaimer}>
            About
          </button>
          <button type="button" className="text-left underline-offset-2 hover:underline" onClick={openDisclaimer}>
            Disclaimer
          </button>
          <a href="/privacy" className="underline-offset-2 hover:underline">
            Privacy
          </a>
          <a href="/fleet" className="underline-offset-2 hover:underline">
            Fleet Database
          </a>
          <Ext href="https://github.com/jonahberg/the-blue-board/issues">Support / Feedback</Ext>
          <Ext href="https://buymeacoffee.com/notjbg" className="font-semibold text-amber-400 underline-offset-2 hover:underline">
            ☕ Donate
          </Ext>
          <Ext href="https://x.com/theblueboard">@theblueboard</Ext>
        </div>

        <nav aria-label="United Airlines Hub Pages" className="mt-2.5 flex flex-wrap gap-x-2.5 gap-y-1 border-t pt-2.5 font-mono text-[10px]">
          {HUB_LINKS.map((hub) => (
            <a key={hub} href={`/hubs/${hub.toLowerCase()}`} className="underline-offset-2 hover:underline">
              {hub}
            </a>
          ))}
          <a href="/hubs" className="underline-offset-2 hover:underline">
            All Hubs
          </a>
          <a href="/news" className="underline-offset-2 hover:underline">
            News
          </a>
          <a href="/trackers" className="underline-offset-2 hover:underline">
            Trackers
          </a>
        </nav>

        <p className="mt-2.5 border-t pt-2.5 text-[10px] leading-relaxed text-muted-foreground">
          Data: <Ext href="https://aerodatabox.com">AeroDataBox</Ext> ·{' '}
          <Ext href="https://www.flightradar24.com">FR24</Ext> ·{' '}
          <Ext href="https://aviationweather.gov">AWC</Ext> ·{' '}
          <Ext href="https://nasstatus.faa.gov">FAA</Ext>
          <br />
          Built by <Ext href="https://jonahberg.com">Jonah Berg</Ext> · Not affiliated with United
          Airlines, Inc.
        </p>
      </PopoverContent>
    </Popover>
  );
}

/**
 * The root mount. `Dashboard.tsx` has mounted this since the first day of the rebuild, and
 * the menu turned out to belong inside the attribution strip rather than floating over the
 * map (see the header). Nothing renders here; the file is kept as the menu's home.
 */
export default function LegalPopover() {
  return null;
}
