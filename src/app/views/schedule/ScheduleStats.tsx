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
 */

import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { JargonTerm } from '../../features/JargonTerm';
import type { BoardModel } from './useBoardModel';
import { otpTone } from './tone';

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
}: {
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

  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        <Metric value={stats.total} label={`UA ${dirLabel} · ${dayLabel}`} />
        <Metric
          value={otp === null || otp === undefined ? '—' : `${otp}%`}
          valueClass={tone.className}
          label={
            <>
              <JargonTerm term="otp">On-Time</JargonTerm>{' '}
              <span className={tone.className}>{otp === null ? '' : tone.label}</span> (
              {stats.operated} operated)
            </>
          }
        />
        <Metric value={stats.onTime} valueClass="text-emerald-400" label="On Time" />
        <Metric value={stats.late} valueClass="text-amber-400" label="Late" />
        <Metric
          value={stats.canceled}
          valueClass="text-red-400"
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
            <span className="text-amber-400">
              ⚠ {hub} under FAA delay program (avg {Math.round(hubDisruptionMinutes as number)}min) —
              statuses may lag.
            </span>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
