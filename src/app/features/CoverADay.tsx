/**
 * "Cover a day" in the About dialog (Nov 2026): this month as a calendar of small day cells
 * (covered / open, today marked), one line of truth about today, and the button.
 *
 * Everything shown is true or absent. The calendar and the line come from /api/support-status
 * (`state/support-status.ts`), read only once the dialog opens. Until it answers, or if it
 * answers `{configured:false}` (no webhook yet, no table, a failed read, a stale date), this
 * shows only the plain ask: what the site costs and the button, with no coverage claim. Days
 * fill in order from the 1st (src/lib/cover-a-day.js), so a past day can be open and a $17
 * gift covers the first open day, which is often not today. The note under the calendar says
 * so.
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
  DAILY_COST_USD,
  MONTHLY_COST_USD,
  calendarCells,
  coverageRuns,
  coveredCountLine,
  monthFullyCovered,
  monthName,
  todayLine,
} from '@/lib/cover-a-day.js';
import { hasMonthlySupport, monthlySupportUrl, supportUrl } from '@/lib/support-link.js';
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
  const line = todayLine(status);
  const full = monthFullyCovered(status);
  const runs = coverageRuns(status);
  const monthly = hasMonthlySupport() ? monthlySupportUrl('about-monthly') : null;

  return (
    <section aria-labelledby="cover-a-day-heading" className="rounded-md border p-3.5">
      <h3
        id="cover-a-day-heading"
        className="font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
      >
        Cover a day
      </h3>
      <p className="mt-1.5">
        {`The Blue Board is free, with no ads. It costs about $${MONTHLY_COST_USD} a month to run, about $${DAILY_COST_USD} a day.`}
      </p>

      {status.configured && calendar ? (
        <div className="mt-3 max-w-[18rem]">
          <div className="flex items-baseline justify-between gap-2">
            <p className="font-semibold">
              {monthName(status.month)} {status.year}
            </p>
            <p className="font-mono text-[10px] tabular-nums text-muted-foreground">{coveredCountLine(status)}</p>
          </div>
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

      {line ? <p className="mt-3 text-xs font-semibold">{line}</p> : null}
      {full && status.configured ? (
        <p className="mt-1">Every day in {monthName(status.month)} is covered. Thank you.</p>
      ) : null}
      {status.configured ? (
        <p className="mt-1 text-muted-foreground">
          Each ${DAILY_COST_USD} covers one day. Donations fill the month in order from the 1st.
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        <Button asChild className="min-h-11 pointer-fine:md:min-h-9">
          <a href={supportUrl('about')} target="_blank" rel="noopener noreferrer" data-support="about">
            {full ? 'Support The Blue Board' : `Cover a day · $${DAILY_COST_USD}`}
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
