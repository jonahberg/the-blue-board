/**
 * The board's six-or-seven card summary (inventory §20 "Stat strip").
 *
 * The muted "Uncategorized" card is the point of this component, not a detail. The shipped
 * strip computed a cancellation count and never rendered it: ORD once showed Total 717 while
 * the visible cards summed 475, hiding 70 cancellations on an IROPS night. `board-stats.js`
 * buckets every row exactly once and this renders the catch-all, so the cards visibly
 * reconcile with the total instead of lying by omission.
 *
 * "On-Time" is the one piece of ops jargon on the strip, so it carries the glossary tooltip
 * (inventory §17) — and its colour always ships with a word.
 *
 * On a phone (`compact`) the seven cards were 165 px — most of a 360×780 screen's first view,
 * with the board itself below the fold (audit Oct 3 2026). There they become one bordered
 * 4×2 grid of the same counts, about 76 px: every number still on screen, nothing behind a
 * tap, and room left for the flights.
 */

import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { JargonTerm } from '../../features/JargonTerm';
import type { BoardModel } from './useBoardModel';
import { otpTone } from './tone';

/** One cell of the phone grid. `dt` before `dd` for the semantics; the value paints on top. */
function MiniMetric({
  value,
  label,
  valueClass,
  title,
  className,
}: {
  value: React.ReactNode;
  label: React.ReactNode;
  valueClass?: string;
  title?: string;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col-reverse items-center justify-center gap-0.5 bg-card px-1 py-1.5', className)} title={title}>
      <dt className="text-center text-[9px] leading-tight uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={cn('font-mono text-base leading-none font-semibold tabular-nums', valueClass)}>{value}</dd>
    </div>
  );
}

function Metric({
  value,
  label,
  valueClass,
  title,
}: {
  value: React.ReactNode;
  label: React.ReactNode;
  valueClass?: string;
  title?: string;
}) {
  return (
    <Card className="flex min-w-24 flex-1 flex-col items-center gap-0.5 rounded-md px-2 py-1.5" title={title}>
      <span className={cn('font-mono text-lg leading-none font-semibold', valueClass)}>{value}</span>
      <span className="text-center text-[9px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
    </Card>
  );
}

export function ScheduleStats({
  stats,
  dir,
  dayLabel,
  hub,
  hubDisruptionMinutes,
  compact = false,
  footnote,
}: {
  compact?: boolean;
  /** Phone only: a one-line note (the cache line) folded into the notes row to save a line. */
  footnote?: React.ReactNode;
  stats: BoardModel['stats'];
  dir: 'departures' | 'arrivals';
  dayLabel: string;
  hub: string;
  hubDisruptionMinutes: number | null;
}) {
  const otp = stats.otp;
  const tone = otpTone(otp === null || otp === undefined ? null : otp);
  const dirLabel = dir === 'departures' ? 'DEP' : 'ARR';
  const presumedVerb = dir === 'arrivals' ? 'landed' : 'departed';
  const showDisruption =
    hubDisruptionMinutes !== null && Number.isFinite(hubDisruptionMinutes) && hubDisruptionMinutes > 60;

  const otpTitle = `Operated: flights with a recorded ${dir === 'arrivals' ? 'arrival' : 'departure'} time (estimates don't count), the same count the hub strip uses. On time = within 30 min of schedule.`;
  const canceledTitle =
    stats.canceledUncertain > 0
      ? `Includes ${stats.canceledUncertain} likely canceled (unconfirmed by provider)`
      : undefined;

  // The phone grid's note line (the desktop strip keeps its own markup below, unchanged).
  const phoneNotes = [
    stats.presumed > 0 ? (
      <span
        key="presumed"
        className="rounded-sm border bg-muted/50 px-1.5 py-0.5 text-muted-foreground"
        title={`Presumed ${presumedVerb} — scheduled time passed without a live update`}
      >
        ✈ {stats.presumed} presumed {presumedVerb}
      </span>
    ) : null,
    showDisruption ? (
      <span key="faa" className="text-bb-warn">
        ⚠ {hub} under FAA delay program (avg {Math.round(hubDisruptionMinutes as number)}min) —
        statuses may lag.
      </span>
    ) : null,
    footnote ? <span key="footnote">{footnote}</span> : null,
  ].filter(Boolean);

  if (compact) {
    return (
      <div>
        <dl
          aria-label={`UA ${dirLabel} · ${dayLabel}`}
          className="grid grid-cols-4 gap-px overflow-hidden rounded-md border bg-border"
        >
          <MiniMetric value={stats.total} label={`UA ${dirLabel}`} />
          {/* Side by side rather than stacked: the glossary term is a 44 px tap target on a
              phone, and stacking it under the value made this one cell set the whole row's
              height. */}
          <div
            className="col-span-2 flex flex-row-reverse items-center justify-center gap-2 bg-card px-1"
            title={otpTitle}
          >
            <dt className="text-[9px] leading-tight uppercase tracking-wide text-muted-foreground">
              <JargonTerm term="otp">On-Time</JargonTerm>{' '}
              <span className={tone.className}>{otp === null ? '' : tone.label}</span>
            </dt>
            <dd className="flex flex-col items-end">
              <span className={cn('font-mono text-base leading-none font-semibold tabular-nums', tone.className)}>
                {otp === null || otp === undefined ? '—' : `${otp}%`}
              </span>
              <span className="text-[9px] leading-tight uppercase tracking-wide text-muted-foreground">
                {stats.operated} operated
              </span>
            </dd>
          </div>
          <MiniMetric value={stats.onTime} valueClass="text-bb-ok" label="On Time" />
          <MiniMetric value={stats.late} valueClass="text-bb-warn" label="Late" />
          <MiniMetric value={stats.canceled} valueClass="text-destructive" label="Canceled" title={canceledTitle} />
          <MiniMetric value={stats.upcoming} valueClass="text-muted-foreground" label="Upcoming" />
          {stats.uncategorized > 0 ? (
            <MiniMetric
              value={stats.uncategorized}
              valueClass="text-muted-foreground"
              label="Uncategorized"
              title="Uncategorized: rows that fit no card — diverted, or operated without usable timestamps"
            />
          ) : (
            <div aria-hidden="true" className="bg-card" />
          )}
        </dl>
        {phoneNotes.length ? (
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px]">{phoneNotes}</p>
        ) : null}
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        <Metric value={stats.total} label={`UA ${dirLabel} · ${dayLabel}`} />
        <Metric
          value={otp === null || otp === undefined ? '—' : `${otp}%`}
          valueClass={tone.className}
          // D9: the one "operated" definition (hub-health.js operatedOutcome), shared with the
          // hub strip — spelled out so the two counts are visibly the same thing.
          title={`Operated: flights with a recorded ${dir === 'arrivals' ? 'arrival' : 'departure'} time (estimates don't count), the same count the hub strip uses. On time = within 30 min of schedule.`}
          label={
            <>
              <JargonTerm term="otp">On-Time</JargonTerm>{' '}
              <span className={tone.className}>{otp === null ? '' : tone.label}</span> (
              {stats.operated} operated)
            </>
          }
        />
        <Metric value={stats.onTime} valueClass="text-bb-ok" label="On Time" />
        <Metric value={stats.late} valueClass="text-bb-warn" label="Late" />
        <Metric
          value={stats.canceled}
          valueClass="text-destructive"
          label="Canceled"
          title={
            stats.canceledUncertain > 0
              ? `Includes ${stats.canceledUncertain} likely canceled (unconfirmed by provider)`
              : undefined
          }
        />
        <Metric value={stats.upcoming} valueClass="text-muted-foreground" label="Upcoming" />
        {stats.uncategorized > 0 ? (
          <Metric
            value={stats.uncategorized}
            valueClass="text-muted-foreground"
            label="Uncategorized"
            title="Rows that fit no card: diverted, or operated without usable timestamps"
          />
        ) : null}
      </div>

      {stats.presumed > 0 || showDisruption ? (
        <p className="mt-1 flex flex-wrap items-center gap-2 text-[10px]">
          {stats.presumed > 0 ? (
            <span
              className="rounded-sm border bg-muted/50 px-1.5 py-0.5 text-muted-foreground"
              title={`Presumed ${presumedVerb} — scheduled time passed without a live update`}
            >
              ✈ {stats.presumed} presumed {presumedVerb}
            </span>
          ) : null}
          {showDisruption ? (
            <span className="text-bb-warn">
              ⚠ {hub} under FAA delay program (avg {Math.round(hubDisruptionMinutes as number)}min) —
              statuses may lag.
            </span>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
