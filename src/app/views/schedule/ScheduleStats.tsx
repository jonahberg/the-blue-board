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

import { Plane, TriangleAlert } from 'lucide-react';

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
  className,
}: {
  value: React.ReactNode;
  label: React.ReactNode;
  note?: string | null;
  valueClass?: string;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-0.5 bg-card px-1 py-1.5', className)}>
      <dt className="order-2 text-center text-[9px] leading-tight uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={cn('order-1 font-mono text-base leading-none font-semibold tabular-nums', valueClass)}>{value}</dd>
      {note ? <dd className="order-3 text-center font-mono text-[9px] leading-tight text-muted-foreground">{note}</dd> : null}
    </div>
  );
}

function Metric({
  value,
  label,
  note,
  valueClass,
}: {
  value: React.ReactNode;
  label: React.ReactNode;
  /**
   * A quieter second figure ("+14 unconfirmed"), on the label's line so the card row keeps
   * its height; it wraps under the label only when the card is too narrow.
   */
  note?: string | null;
  valueClass?: string;
}) {
  return (
    <Card className="flex min-w-24 flex-1 flex-col items-center gap-0.5 rounded-md px-2 py-1.5">
      <span className={cn('font-mono text-lg leading-none font-semibold tabular-nums', valueClass)}>{value}</span>
      {/* `text-balance` and the unbreakable note: on a tablet the seven cards are ~105 px wide
          and the labels wrap, which left "11" or "TIMED" alone on a line. */}
      <span className="text-center text-[9px] text-balance uppercase tracking-wide text-muted-foreground">
        {label}
        {note ? (
          <span className="font-mono normal-case tracking-normal">
            {'\u00a0· '}
            <span className="whitespace-nowrap">{note}</span>
          </span>
        ) : null}
      </span>
    </Card>
  );
}

/**
 * A card label that explains itself: the dotted term opens its explanation on hover, focus or a
 * tap (`JargonTerm`). These were `title=` attributes on the cards, which a touch screen never
 * shows (Nov 2026). On touch the term is a 44 px target; the wrapper's negative margin takes that
 * height back out of the label's line, so the card does not grow (the On-Time pattern).
 */
function Explained({ text, children }: { text: string; children: React.ReactNode }) {
  return (
    <span className="-my-4 inline-flex align-middle pointer-fine:my-0">
      <JargonTerm description={text}>
        {/* A <button> resets text-transform, so the term carries its own. */}
        <span className="uppercase">{children}</span>
      </JargonTerm>
    </span>
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
  /** The board's own footnote (data age, cache line), folded into the one meta line under the strip. */
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

  const otpTitle = stats.otpWithheld
    ? 'No on-time percentage while the board is filtered by status: a percentage of the rows the filter picked says nothing about the hub. Clear the status filter to see it.'
    : `Operated: flights with a recorded ${dir === 'arrivals' ? 'arrival' : 'departure'} time (estimates don't count), the same count the hub strip uses. On time = within 30 min of schedule.`;

  // Confirmed in the headline, unconfirmed ("Likely Canceled") as the quiet line under it.
  const cancellations = splitCancellations(stats.canceled, stats.canceledUncertain);
  const canceledValue = cancellations.confirmed ?? stats.canceled;
  // Red is for a real cancellation; a calm zero is not an alarm.
  const canceledClass = canceledValue > 0 ? 'text-destructive' : 'text-muted-foreground';
  const canceledNote = unconfirmedFigure(cancellations);
  const canceledTitle = boardCanceledTitle(cancellations);

  // ONE meta line under the strip at every width: the presumed chip, the FAA program note and
  // the board's own footnote (data age, cache), wrapping as a unit on a phone. Desktop used to
  // stack three of these lines between the cards and the table.
  const notes = [
    stats.presumed > 0 ? (
      // The chip is the term: a tap, hover or focus says what "presumed" means. On touch its 44 px
      // hit box is an `after:` box, so the running line keeps its height.
      <JargonTerm
        key="presumed"
        description={copy.presumed.title}
        className="relative mr-2 min-h-0 gap-1 rounded-sm border bg-muted/50 px-1.5 py-0.5 align-middle after:absolute after:inset-x-0 after:-inset-y-2.5 pointer-fine:md:after:hidden"
      >
        <Plane aria-hidden="true" className="size-3" />
        {stats.presumed} {copy.presumed.label}
      </JargonTerm>
    ) : null,
    showDisruption ? (
      <span key="faa" className="mr-2 text-bb-warn">
        <TriangleAlert aria-hidden="true" className="mr-1 inline size-3 align-[-2px]" />
        {hub} under FAA delay program (avg {Math.round(hubDisruptionMinutes as number)}min) — statuses may
        lag.
      </span>
    ) : null,
    footnote ? <span key="footnote">{footnote}</span> : null,
  ].filter(Boolean);
  const notesLine = notes.length ? (
    // Running text, not a flex row: the words flow on after the chip and wrap like a sentence,
    // where a flex item dropped whole onto a second line and left the chip alone on the first.
    <p className="mt-1.5 px-1 text-[10px] leading-5 text-muted-foreground">{notes}</p>
  ) : null;

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
          label={<Explained text={copy.untimed.title}>{copy.untimed.phoneLabel}</Explained>}
        />
      ) : null,
      <MiniMetric
        key="canceled"
        value={canceledValue}
        valueClass={canceledClass}
        label={<Explained text={canceledTitle}>Canceled</Explained>}
        note={canceledNote}
      />,
      stats.inAir > 0 ? (
        <MiniMetric
          key="inAir"
          value={stats.inAir}
          valueClass="text-muted-foreground"
          label={<Explained text={copy.inAir.title}>{copy.inAir.label}</Explained>}
        />
      ) : null,
      <MiniMetric key="upcoming" value={stats.upcoming} valueClass="text-muted-foreground" label="Upcoming" />,
      stats.uncategorized > 0 ? (
        <MiniMetric
          key="uncategorized"
          value={stats.uncategorized}
          valueClass="text-muted-foreground"
          label={<Explained text={copy.uncategorized.title}>{copy.uncategorized.label}</Explained>}
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
          {/* Stacked like every other cell (figure, label, note) so the grid reads as one
              grid. The glossary term is a 44 px tap target on a phone; its wrapper's negative
              margin takes that height back out of the flow (the SlHero pattern), so this cell
              is no taller than Canceled beside it. */}
          <div className="col-span-2 flex flex-col items-center justify-center gap-0.5 bg-card px-1 py-1.5">
            <dt className="order-2 -my-4 flex items-center justify-center gap-1 text-[9px] leading-tight uppercase tracking-wide text-muted-foreground">
              <JargonTerm term="otp" description={otpTitle}>
                {/* A <button> resets text-transform, so the term carries its own. */}
                <span className="uppercase">On-Time</span>
              </JargonTerm>
              {otp === null ? null : <span className={tone.className}>{tone.label}</span>}
            </dt>
            <dd className={cn('order-1 font-mono text-base leading-none font-semibold tabular-nums', tone.className)}>
              {otp === null || otp === undefined ? '—' : `${otp}%`}
            </dd>
            <dd className="order-3 font-mono text-[9px] leading-tight text-muted-foreground">
              {stats.operated} operated
            </dd>
          </div>
          {cells}
          {Array.from({ length: fillers }, (_, i) => (
            <div key={`filler-${i}`} aria-hidden="true" className="bg-card" />
          ))}
        </dl>
        {notesLine}
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        <Metric
          value={stats.total}
          label={
            <>
              {/* A no-break space before the dot: a wrap falls after it, never before. */}
              UA {dirLabel}{'\u00a0· '}
              <span className="whitespace-nowrap">{dayLabel}</span>
            </>
          }
        />
        <Metric
          value={otp === null || otp === undefined ? '—' : `${otp}%`}
          valueClass={tone.className}
          // D9: the one "operated" definition (hub-health.js operatedOutcome), shared with the
          // hub strip — spelled out so the two counts are visibly the same thing. It is the
          // term's explanation (a tap opens it on touch), no longer a card `title`.
          label={
            <>
              {/* On a touch tablet the term is a 44 px target; the wrapper's negative margin keeps
                  that height out of the label's line, so the card does not grow a gap. */}
              <span className="-my-4 inline-flex align-middle pointer-fine:my-0">
                <JargonTerm term="otp" description={otpTitle}>
                  {/* A <button> resets text-transform, so the term carries its own. */}
                  <span className="uppercase">On-Time</span>
                </JargonTerm>
              </span>
              {otp === null ? null : <span className={tone.className}> {tone.label}</span>}
            </>
          }
          note={`${stats.operated} operated`}
        />
        <Metric value={stats.onTime} valueClass="text-bb-ok" label="On Time" />
        <Metric value={stats.late} valueClass="text-bb-warn" label="Late" />
        {stats.untimed > 0 ? (
          <Metric
            value={stats.untimed}
            valueClass="text-muted-foreground"
            label={<Explained text={copy.untimed.title}>{copy.untimed.label}</Explained>}
          />
        ) : null}
        <Metric
          value={canceledValue}
          valueClass={canceledClass}
          label={<Explained text={canceledTitle}>Canceled</Explained>}
          note={canceledNote}
        />
        {stats.inAir > 0 ? (
          <Metric
            value={stats.inAir}
            valueClass="text-muted-foreground"
            label={<Explained text={copy.inAir.title}>{copy.inAir.label}</Explained>}
          />
        ) : null}
        <Metric value={stats.upcoming} valueClass="text-muted-foreground" label="Upcoming" />
        {stats.uncategorized > 0 ? (
          <Metric
            value={stats.uncategorized}
            valueClass="text-muted-foreground"
            label={<Explained text={copy.uncategorized.title}>{copy.uncategorized.label}</Explained>}
          />
        ) : null}
      </div>

      {notesLine}
    </div>
  );
}
