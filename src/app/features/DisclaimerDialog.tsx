/**
 * "About The Blue Board" — the affiliation disclaimer, the attribution list, the safety
 * line and the Supporters Wall (inventory §13).
 *
 * Three things in here are obligations rather than copy:
 *  - the independence statement, because this dashboard carries United's name and colours
 *    and must never be mistaken for United's own tool;
 *  - the attribution list, because CARTO/OpenStreetMap is ODbL and AeroDataBox is the
 *    schedule source (crediting FR24 for schedules violates FR24's terms);
 *  - the "do not use this for operational or safety-critical decisions" line, which is the
 *    one sentence on this site that has to be unmissable.
 *
 * The supporter names live in `src/data/supporters.js` (verbatim from Buy Me a Coffee, pinned
 * by `tests/supporters.test.js`). One-time donations moved to Stripe on Nov 10 2026
 * (`supportUrl`, src/lib/support-link.js); the monthly-membership link still goes to Buy Me a
 * Coffee, where the existing members are, until there is a Stripe monthly link. They are people who paid for this to exist; dropping or
 * misspelling one in a rewrite is not a cosmetic bug.
 *
 * Since Nov 2026 the support section is "cover a day" (`CoverADay.tsx`): this month's calendar
 * of covered days, the truth about today, and a button naming the day $17 would cover
 * ("Cover today · $17", "Cover tomorrow · $17", …). Once
 * `STRIPE_MONTHLY_URL` is set it offers "Cover a day every month" and the Buy Me a Coffee
 * membership link here steps aside.
 *
 * The wall is a static list from before Stripe, so its caption says so and promises no place on
 * it: "These readers backed The Blue Board before days were counted." Its link offers the day
 * instead (src/lib/cover-a-day.js WALL_CAPTION_LINE / WALL_LINK_LABEL).
 */

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { SUPPORTERS } from '@/data/supporters.js';
import { WALL_CAPTION_LINE, WALL_LINK_LABEL } from '@/lib/cover-a-day.js';
import { hasMonthlySupport, supportUrl } from '@/lib/support-link.js';
import { useUi } from '../state/ui';
import { CoverADay } from './CoverADay';


const SOURCES: { href: string; label: string; rest: React.ReactNode }[] = [
  {
    href: 'https://aerodatabox.com',
    label: 'AeroDataBox',
    rest: ' — Airport departure & arrival schedule data',
  },
  {
    href: 'https://www.flightradar24.com',
    label: 'Flightradar24',
    rest: ' — Live flight positions',
  },
  {
    href: 'https://carto.com/attributions',
    label: 'CARTO',
    rest: (
      <>
        {' / '}
        <a
          href="https://www.openstreetmap.org/copyright"
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary underline-offset-2 hover:underline"
        >
          OpenStreetMap
        </a>
        {' contributors — Basemap tiles and map data (ODbL)'}
      </>
    ),
  },
  {
    href: 'https://aviationweather.gov',
    label: 'Aviation Weather Center (NOAA)',
    rest: ' — METAR weather observations',
  },
  {
    href: 'https://nasstatus.faa.gov',
    label: 'FAA NAS Status',
    rest: ' — Airport delay and closure information',
  },
];

function Ext({ href, children, support }: { href: string; children: React.ReactNode; support?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      data-support={support}
      className="text-primary underline-offset-2 hover:underline"
    >
      {children}
    </a>
  );
}

export default function DisclaimerDialog() {
  const { disclaimerOpen, setDisclaimerOpen } = useUi();

  return (
    <Dialog open={disclaimerOpen} onOpenChange={setDisclaimerOpen}>
      <DialogContent className="max-h-[80svh] overflow-y-auto sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="text-sm uppercase tracking-wider text-primary">
            ⚖️ About The Blue Board
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 text-[11px] leading-relaxed">
          <p>
            <strong className="text-bb-warn">
              The Blue Board is an independent, fan-built project and is not affiliated with,
              endorsed by, or connected to United Airlines, Inc.
            </strong>{' '}
            &ldquo;United Airlines&rdquo; and the United logo are trademarks of United Airlines,
            Inc. An independent tool built for the United community.
          </p>

          <div>
            <p className="font-semibold">Data Sources &amp; Attribution:</p>
            <ul className="ml-5 list-disc text-muted-foreground">
              {SOURCES.map((source) => (
                <li key={source.href}>
                  <Ext href={source.href}>{source.label}</Ext>
                  {source.rest}
                </li>
              ))}
              <li>Fleet configuration data sourced from publicly available records</li>
            </ul>
          </div>

          <p>
            <strong>Data Accuracy:</strong> All flight data is provided for informational purposes
            only and may be delayed, incomplete, or inaccurate.{' '}
            <strong className="text-destructive">
              Do not use this dashboard for operational or safety-critical decisions.
            </strong>{' '}
            Always verify flight status directly with <Ext href="https://www.united.com">united.com</Ext>{' '}
            or your airline.
          </p>

          <p>
            <strong>Open Source:</strong> This project is open source.{' '}
            <Ext href="https://github.com/jonahberg/the-blue-board">View on GitHub →</Ext> ·{' '}
            <Ext href="https://x.com/theblueboard">Follow on X →</Ext>
          </p>

          <p>
            <strong>Support:</strong> Built by a United flyer, not a corporation.{' '}
            {hasMonthlySupport() ? null : (
              <>
                <Ext href="https://buymeacoffee.com/notjbg/membership" support="about-membership">Become a monthly supporter →</Ext>{' '}
                ·{' '}
              </>
            )}
            <Ext href="https://github.com/jonahberg/the-blue-board/issues">Suggest a feature →</Ext>
          </p>

          <CoverADay active={disclaimerOpen} />

          <div className="rounded-md border border-primary/15 bg-primary/5 p-3.5">
            {/* The same quiet label as "Cover a day" above it: amber is status only (DESIGN.md). */}
            <p className="font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Supporters
            </p>
            <ul className="mt-2.5 flex flex-wrap gap-1.5">
              {SUPPORTERS.map((name) => (
                <li
                  key={name}
                  className="rounded-sm border border-primary/15 bg-primary/10 px-2 py-0.5 font-mono text-[10px]"
                >
                  {name}
                </li>
              ))}
            </ul>
            <p className="mt-2.5 text-[10px] text-muted-foreground">
              {WALL_CAPTION_LINE}{' '}
              <Ext href={supportUrl('about-wall')} support="about-wall">{WALL_LINK_LABEL}</Ext>
            </p>
          </div>
        </div>

        <Button className="min-h-11 w-full" onClick={() => setDisclaimerOpen(false)}>
          Got it
        </Button>
      </DialogContent>
    </Dialog>
  );
}
