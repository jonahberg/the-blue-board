/**
 * "Cover a day" in the About dialog (Nov 2026): this month as a calendar of small day cells
 * (covered / open, today marked), the month in one sentence, one line of truth about today, the
 * day button and the amount ladder.
 *
 * Everything shown is true or absent. The calendar and the lines come from /api/support-status
 * (`state/support-status.ts`), read only once the dialog opens. Until it answers, or if it
 * answers `{configured:false}` (no webhook yet, no table, a failed read, a stale date), this
 * shows only the plain ask: what the site costs and "Help cover a day" (the any-amount link), with
 * no coverage claim. A payment covers the day it is given, or the next open day after it
 * (src/lib/cover-a-day.js), so the button names that day ("Cover today · $17", "Cover tomorrow ·
 * $17", "Cover Nov 15 · $17", to the fixed $17 link) and the note under the calendar states the
 * rule. Under the button sits the amount ladder (`aboutLadder`: one button per amount with a
 * fixed link, less the $17 when the button above already names a day at $17, then "Other
 * amount"; absent when no amount has a link) and the line that a name can be added at checkout.
 * In a month with no day covered yet, the month line alone takes the bold slot (`aboutCoverLines`). Every word comes from src/lib/cover-a-day.js.
 *
 * Covered vs open is never colour alone: a covered cell is filled and an open one is a dashed
 * outline; today wears a ring; there is a legend with words; and each cell carries its own
 * sentence for a screen reader ("November 3: covered by Dana R."). Names follow the display
 * rules in src/lib/supporter-name.js, and "Who covered which day" lists them for touch screens,
 * where a cell's `title` never shows.
 */

import { ChevronRight } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  ABOUT_INTRO_LINE,
  COVER_RULE_LINE,
  NAME_LINE,
  aboutCoverLines,
  aboutLadder,
  calendarCells,
  coverButtonHref,
  coverButtonLabel,
  coverageRuns,
  monthName,
} from '@/lib/cover-a-day.js';
import { hasMonthlySupport, monthlySupportUrl } from '@/lib/support-link.js';
import { useSupportStatus } from '../state/support-status';
import type { SupportStatus } from '../state/support-status';

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const UNKNOWN: SupportStatus = { configured: false };

function cellClass(covered: boolean, today: boolean): string {
  const base = 'flex h-7 items-center justify-center rounded-sm font-mono text-[10px] tabular-nums';
  const fill = covered
    ? 'bg-primary-fill font-semibold text-primary-foreground'
    : 'border border-dashed border-muted-foreground/50 text-muted-foreground';
  const ring = today ? 'ring-2 ring-foreground ring-offset-1 ring-offset-background' : '';
  return `${base} ${fill} ${ring}`;
}

export function CoverADay({ active }: { active: boolean }) {
  const loaded = useSupportStatus(active);
  const status = loaded ?? UNKNOWN;
  const calendar = status.configured ? calendarCells(status) : null;
  const lines = aboutCoverLines(status);
  const runs = coverageRuns(status);
  const monthly = hasMonthlySupport() ? monthlySupportUrl('about-monthly') : null;
  const ladder = aboutLadder(status);

  return (
    <section aria-labelledby="cover-a-day-heading" className="rounded-md border p-3.5">
      <h3
        id="cover-a-day-heading"
        className="font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
      >
        Cover a day
      </h3>
      <p className="mt-1.5">{ABOUT_INTRO_LINE}</p>

      {status.configured && calendar ? (
        <div className="mt-3 max-w-[18rem]">
          <p className="font-semibold">
            {monthName(status.month)} {status.year}
          </p>
          <div aria-hidden="true" className="mt-1.5 grid grid-cols-7 gap-1 text-center font-mono text-[10px] text-muted-foreground">
            {WEEKDAYS.map((d, i) => (
              <span key={i}>{d}</span>
            ))}
          </div>
          <ol aria-label={`${monthName(status.month)} ${status.year}, day by day`} className="mt-1 grid grid-cols-7 gap-1">
            {Array.from({ length: calendar.leadingBlanks }, (_, i) => (
              <li key={`blank-${i}`} aria-hidden="true" />
            ))}
            {calendar.cells.map((cell) => (
              <li key={cell.day} title={cell.label} className={cellClass(cell.covered, cell.today)}>
                <span aria-hidden="true">{cell.day}</span>
                <span className="sr-only">{cell.label}</span>
              </li>
            ))}
          </ol>
          <ul aria-hidden="true" className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
            <li className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm bg-primary-fill" /> Covered
            </li>
            <li className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm border border-dashed border-muted-foreground/50" /> Open
            </li>
            <li className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm ring-2 ring-foreground" /> Today
            </li>
          </ul>
        </div>
      ) : null}

      {lines.lead ? <p className="mt-3 text-xs font-semibold">{lines.lead}</p> : null}
      {lines.follow ? <p className="mt-1">{lines.follow}</p> : null}
      {status.configured ? <p className="mt-1 text-muted-foreground">{COVER_RULE_LINE}</p> : null}

      <div className="mt-3 flex flex-wrap gap-2">
        <Button asChild className="min-h-11 pointer-fine:md:min-h-9">
          <a href={coverButtonHref(status, 'about')} target="_blank" rel="noopener noreferrer" data-support="about">
            {coverButtonLabel(status)}
          </a>
        </Button>
        {monthly ? (
          <Button asChild variant="outline" className="min-h-11 pointer-fine:md:min-h-9">
            <a href={monthly} target="_blank" rel="noopener noreferrer" data-support="about-monthly">
              Cover a day every month
            </a>
          </Button>
        ) : null}
      </div>

      {ladder ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5" data-support-ladder>
          {ladder.amounts.map((step) => (
            <Button key={step.amount} asChild variant="outline" size="sm" className="min-h-11 px-3 text-xs pointer-fine:md:min-h-8">
              <a href={step.href} target="_blank" rel="noopener noreferrer" data-support={step.placement}>
                {step.text}
              </a>
            </Button>
          ))}
          <a
            href={ladder.other.href}
            target="_blank"
            rel="noopener noreferrer"
            data-support={ladder.other.placement}
            className="inline-flex min-h-11 items-center px-1 text-xs text-primary underline underline-offset-2 pointer-fine:md:min-h-8"
          >
            {ladder.other.text}
          </a>
        </div>
      ) : null}
      <p className="mt-2 text-muted-foreground">{NAME_LINE}</p>

      {runs.length ? (
        <details className="group mt-3">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1 text-muted-foreground underline-offset-2 hover:underline pointer-fine:md:min-h-6 [&::-webkit-details-marker]:hidden">
            <ChevronRight aria-hidden="true" className="size-3.5 transition-transform group-open:rotate-90 motion-reduce:transition-none" />
            Who covered which day
          </summary>
          <ul className="mt-1 space-y-0.5">
            {runs.map((run) => (
              <li key={run.from} className="flex gap-2">
                <span className="w-16 shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">{run.text}</span>
                <span>{run.by}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
