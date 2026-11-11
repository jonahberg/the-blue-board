/**
 * The board's summary strip (inventory §20 "Stat strip").
 *
 * Reconciling with the total is the point of this component, not a detail. The shipped
 * strip computed a cancellation count and never rendered it: ORD once showed Total 717 while
 * the visible cards summed 475, hiding 70 cancellations on an IROPS night. `board-stats.js`
 * buckets every row exactly once and this renders every non-empty bucket, so the cards visibly
 * reconcile with the total instead of lying by omission.
 *
 * Two of those buckets are new in Nov 2026 and replace most of what used to be a large muted
 * "Uncategorized": `untimed` ("Departed · not timed" — the board prints the row as Departed
 * but no time was reported, so it is not scored) and, on arrivals boards, `inAir`. On ORD on
 * Nov 10 the old strip read "89 Uncategorized" beside a 91% on-time day; every one of those
 * rows said "Departed" right below it.
 *
 * The Canceled card counts CONFIRMED cancellations. The provider's unconfirmed "Likely
 * Canceled" rows ride under it as a quieter "+N unconfirmed" (`cancellation-display.js`), so
 * the strip still reconciles — ORD's "14 CANCELED" that day was 0 confirmed + 14 unconfirmed.
 *
 * "On-Time" is the one piece of ops jargon on the strip, so it carries the glossary tooltip
 * (inventory §17) — and its colour always ships with a word.
 *
 * On a phone (`compact`) the cards become one bordered four-column grid of the same counts:
 * every number still on screen, nothing behind a tap, and room left for the flights.
 */

import { Card } from '@/components/ui/card';
import { statStripCopy } from '@/lib/board-stats.js';
import { boardCanceledTitle, splitCancellations, unconfirmedFigure } from '@/lib/cancellation-display.js';
import { cn } from '@/lib/utils';
import { JargonTerm } from '../../features/JargonTerm';
import type { BoardModel } from './useBoardModel';
import { otpTone } from './tone';

/**
 * One cell of the phone grid. `dt` before `dd` for the semantics; `order` paints the value on
 * top, the label under it and the note (when there is one) last.
 */
function MiniMetric({
  value,
  label,
  note,
  valueClass,
  title,
  className,
}: {
  value: React.ReactNode;
  label: React.ReactNode;
  note?: string | null;
  valueClass?: string;
  title?: string;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-0.5 bg-card px-1 py-1.5', className)} title={title}>
      <dt className="order-2 text-center text-[9px] leading-tight uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={cn('order-1 font-mono text-base leading-none font-semibold tabular-nums', valueClass)}>{value}</dd>
      {note ? <dd className="order-3 text-center text-[9px] leading-tight text-muted-foreground">{note}</dd> : null}
    </div>
  );
}

function Metric({
  value,
  label,
  note,
  valueClass,
  title,
}: {
  value: React.ReactNode;
  label: React.ReactNode;
  /**
   * A quieter second figure ("+14 unconfirmed"), on the label's line so the card row keeps
   * its height; it wraps under the label only when the card is too narrow.
   */
  note?: string | null;
  valueClass?: string;
  title?: string;
}) {
  return (
    <Card className="flex min-w-24 flex-1 flex-col items-center gap-0.5 rounded-md px-2 py-1.5" title={title}>
      <span className={cn('font-mono text-lg leading-none font-semibold', valueClass)}>{value}</span>
      <span className="text-center text-[9px] uppercase tracking-wide text-muted-foreground">
        {label}
        {note ? <span className="font-mono normal-case tracking-normal"> · {note}</span> : null}
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
  const copy = statStripCopy(dir);
  const showDisruption =
    hubDisruptionMinutes !== null && Number.isFinite(hubDisruptionMinutes) && hubDisruptionMinutes > 60;

  const otpTitle = `Operated: flights with a recorded ${dir === 'arrivals' ? 'arrival' : 'departure'} time (estimates don't count), the same count the hub strip uses. On time = within 30 min of schedule.`;

  // Confirmed in the headline, unconfirmed ("Likely Canceled") as the quiet line under it.
  const cancellations = splitCancellations(stats.canceled, stats.canceledUncertain);
  const canceledValue = cancellations.confirmed ?? stats.canceled;
  // Red is for a real cancellation; a calm zero is not an alarm.
  const canceledClass = canceledValue > 0 ? 'text-destructive' : 'text-muted-foreground';
  const canceledNote = unconfirmedFigure(cancellations);
  const canceledTitle = boardCanceledTitle(cancellations);

  // The phone grid's note line (the desktop strip keeps its own markup below).
  const phoneNotes = [
    stats.presumed > 0 ? (
      <span
        key="presumed"
        className="rounded-sm border bg-muted/50 px-1.5 py-0.5 text-muted-foreground"
        title={copy.presumed.title}
      >
        ✈ {stats.presumed} {copy.presumed.label}
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
    // 4 columns: the total, the on-time cell (2 wide), then every count in reading order —
    // what has left (on time, late, not timed), what will not (canceled), what is coming. The
    // optional cells only appear when non-zero; the last row is padded so the grid stays a grid.
    const cells: React.ReactNode[] = [
      <MiniMetric key="onTime" value={stats.onTime} valueClass="text-bb-ok" label="On Time" />,
      <MiniMetric key="late" value={stats.late} valueClass="text-bb-warn" label="Late" />,
      stats.untimed > 0 ? (
        <MiniMetric
          key="untimed"
          value={stats.untimed}
          valueClass="text-muted-foreground"
          label={copy.untimed.phoneLabel}
          title={copy.untimed.title}
        />
      ) : null,
      <MiniMetric
        key="canceled"
        value={canceledValue}
        valueClass={canceledClass}
        label="Canceled"
        note={canceledNote}
        title={canceledTitle}
      />,
      stats.inAir > 0 ? (
        <MiniMetric key="inAir" value={stats.inAir} valueClass="text-muted-foreground" label={copy.inAir.label} title={copy.inAir.title} />
      ) : null,
      <MiniMetric key="upcoming" value={stats.upcoming} valueClass="text-muted-foreground" label="Upcoming" />,
      stats.uncategorized > 0 ? (
        <MiniMetric
          key="uncategorized"
          value={stats.uncategorized}
          valueClass="text-muted-foreground"
          label={copy.uncategorized.label}
          title={copy.uncategorized.title}
        />
      ) : null,
    ].filter(Boolean);
    // Slots used: total (1) + on-time (2) + the cells above.
    const used = 3 + cells.length;
    const fillers = (4 - (used % 4)) % 4;

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
          {cells}
          {Array.from({ length: fillers }, (_, i) => (
            <div key={`filler-${i}`} aria-hidden="true" className="bg-card" />
          ))}
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
          title={otpTitle}
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
        {stats.untimed > 0 ? (
          <Metric
            value={stats.untimed}
            valueClass="text-muted-foreground"
            label={copy.untimed.label}
            title={copy.untimed.title}
          />
        ) : null}
        <Metric
          value={canceledValue}
          valueClass={canceledClass}
          label="Canceled"
          note={canceledNote}
          title={canceledTitle}
        />
        {stats.inAir > 0 ? (
          <Metric value={stats.inAir} valueClass="text-muted-foreground" label={copy.inAir.label} title={copy.inAir.title} />
        ) : null}
        <Metric value={stats.upcoming} valueClass="text-muted-foreground" label="Upcoming" />
        {stats.uncategorized > 0 ? (
          <Metric
            value={stats.uncategorized}
            valueClass="text-muted-foreground"
            label={copy.uncategorized.label}
            title={copy.uncategorized.title}
          />
        ) : null}
      </div>

      {stats.presumed > 0 || showDisruption ? (
        <p className="mt-1 flex flex-wrap items-center gap-2 text-[10px]">
          {stats.presumed > 0 ? (
            <span
              className="rounded-sm border bg-muted/50 px-1.5 py-0.5 text-muted-foreground"
              title={copy.presumed.title}
            >
              ✈ {stats.presumed} {copy.presumed.label}
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
