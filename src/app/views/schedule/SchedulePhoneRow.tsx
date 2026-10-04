/**
 * One flight on the PHONE board (below `md`): two lines instead of ten columns.
 *
 *   18:48  UA2059  ROC → ORD             [Departed] LIVE  +208m   (eye)
 *   →22:16 N57868 · 757-300 · 16F/…/96Y · ViaSat Ka
 *
 * Line one is what a traveller scans for — the flight, where it goes, and whether it is on
 * time — so the status pill and the delay sit at its right edge where the eye lands; line two
 * is the aircraft, muted. A third line appears only for the rare things that change a
 * passenger's day: an equipment swap, an FAA program, a "seen airborne" override, a special
 * livery.
 *
 * The whole row opens the flight sheet. That is a STRETCHED button (its `after:` box covers
 * the row) rather than an onClick on the `<li>`: the row stays a list item to a screen reader,
 * the button has a real name and keyboard focus, and the watch eye and the risk badge — which
 * do something else — sit above it (`relative z-10`) instead of being illegally nested inside.
 *
 * Every text field comes from the row model as built; the wording decisions live in
 * `src/lib/schedule-phone-row.js` with a test. Nothing here re-derives a status or a delay.
 */

import { Eye, Star, Wifi, Zap } from 'lucide-react';
import { memo } from 'react';

import { Button } from '@/components/ui/button';
import {
  phoneAircraftLine,
  phoneStatusLabel,
  phoneSwapText,
  phoneTimeChange,
} from '@/lib/schedule-phone-row.js';
import { cn } from '@/lib/utils';
import type { RowModel } from './useBoardModel';
import { DelayFigure } from './DelayFigure';
import { STATUS_PILL, SWAP_TONE, riskToneClass } from './tone';

export type SchedulePhoneRowProps = {
  row: RowModel;
  index: number;
  watched: boolean;
  boardAsOf: string;
  /** The board's direction: a runway-time delay is wheels-up on one, touchdown on the other. */
  dir?: 'departures' | 'arrivals';
  onOpenFlight: (row: RowModel) => void;
  onToggleWatch: (row: RowModel) => void;
  onExplainDelay: (context: Record<string, unknown>) => void;
};

/** A middot that is decoration, not content. */
function Sep() {
  return (
    <span aria-hidden="true" className="shrink-0 text-muted-foreground/60">
      ·
    </span>
  );
}

export const SchedulePhoneRow = memo(function SchedulePhoneRow({
  row,
  index,
  watched,
  boardAsOf,
  dir = 'departures',
  onOpenFlight,
  onToggleWatch,
  onExplainDelay,
}: SchedulePhoneRowProps) {
  const change = phoneTimeChange(row.actualLine);
  const aircraft = phoneAircraftLine(row);
  const status = phoneStatusLabel(row.status);
  const swapText = phoneSwapText(row.swap);
  const hasIdent = row.ident !== '—';
  const notes = Boolean(swapText || row.faaContext || row.status.seen || row.special);

  return (
    <li
      data-row-index={index}
      data-flight-row={row.ident}
      className="relative flex items-center border-b last:border-b-0 data-[highlight=on]:bg-primary/20"
    >
      <div className="flex min-w-0 flex-1 gap-2 py-1.5 pl-2">
        {/* Time column: scheduled on top, the changed time (or the carried-over date) under it. */}
        <div className="w-11 shrink-0 font-mono text-xs leading-5 tabular-nums">
          <span className="block">{row.timeText}</span>
          {change ? (
            <span
              className={cn('block text-[10px] leading-4', change.early ? 'text-bb-ok' : 'text-muted-foreground')}
            >
              <span className="sr-only">{row.status.key === 'scheduled' ? 'estimated ' : 'now '}</span>→{change.stamp}
            </span>
          ) : row.dateChip ? (
            <span className="block text-[10px] leading-4 text-muted-foreground">{row.dateChip}</span>
          ) : row.derivedActual ? (
            <span className="block text-[10px] leading-4 text-muted-foreground">actual</span>
          ) : null}
        </div>

        <div className="min-w-0 flex-1">
          {/* Line 1 — flight, route, then the status and the delay where the eye lands. */}
          <div className="flex min-w-0 items-center gap-1.5 leading-5">
            {hasIdent ? (
              <button
                type="button"
                onClick={() => onOpenFlight(row)}
                aria-label={`${row.identDisplay} flight details`}
                className="shrink-0 font-mono text-xs font-semibold text-primary after:absolute after:inset-0"
              >
                {row.identDisplay}
              </button>
            ) : (
              <span className="shrink-0 font-mono text-xs text-muted-foreground">—</span>
            )}
            <span className="shrink-0 font-mono text-xs">{row.routeLine}</span>

            <span className="ml-auto flex min-w-0 items-center gap-1">
              <span
                className={cn(
                  'min-w-0 truncate rounded-sm border px-1 text-[10px] leading-4 font-medium',
                  STATUS_PILL[row.status.cls] ?? STATUS_PILL.unknown,
                )}
                title={[status.note, row.status.asOf ? `as of ${boardAsOf}` : ''].filter(Boolean).join(' · ') || undefined}
              >
                {status.label}
                {status.note ? <span className="sr-only"> ({status.note})</span> : null}
                {row.status.asOf && boardAsOf ? <span className="sr-only"> (as of {boardAsOf})</span> : null}
              </span>
              {row.status.live ? (
                <span className="shrink-0 rounded-sm bg-secondary px-1 text-[9px] leading-4 font-semibold tracking-wide text-secondary-foreground">
                  LIVE
                </span>
              ) : null}
              {row.delay.kind === 'delta' ? (
                <DelayFigure
                  delay={row.delay}
                  dir={dir}
                  actualFromRunway={row.actualFromRunway}
                  className="shrink-0 font-mono text-xs font-semibold tabular-nums"
                />
              ) : row.delay.kind === 'risk' ? (
                <button
                  type="button"
                  onClick={() => onExplainDelay((row.delay as { context: Record<string, unknown> }).context)}
                  title="Tap for AI analysis"
                  // 44 px of hit area from the `after:` box, so the badge keeps the row's height.
                  className={cn(
                    'relative z-10 shrink-0 rounded-sm border px-1 font-mono text-[9px] leading-4',
                    'after:absolute after:-inset-x-1 after:-inset-y-3.5',
                    riskToneClass(row.delay.risk.label),
                  )}
                >
                  RISK: {row.delay.risk.label}
                </button>
              ) : null}
            </span>
          </div>

          {/* Line 2 — the aircraft, muted. The seat layout is the part that truncates, so the
              Wi-Fi (the thing the site is known for) is never the part cut off. */}
          <div className="flex min-w-0 items-center gap-1 text-[10px] leading-4 text-muted-foreground">
            {aircraft.tail ? (
              // A tail backfilled from live tracking is dotted, as on the desktop board.
              <span
                className={cn('shrink-0 font-mono', row.regFromLive && 'underline decoration-dotted underline-offset-2')}
                title={row.regFromLive ? 'Tail from live flight tracking (not in the schedule feed)' : undefined}
              >
                {aircraft.tail}
              </span>
            ) : null}
            {aircraft.tail && aircraft.type ? <Sep /> : null}
            {aircraft.type ? <span className="shrink-0">{aircraft.type}</span> : null}
            {aircraft.seats ? (
              <>
                <Sep />
                <span className="min-w-0 truncate font-mono">{aircraft.seats}</span>
              </>
            ) : null}
            {aircraft.wifi ? (
              <>
                <Sep />
                {aircraft.starlink ? (
                  <span className="flex shrink-0 items-center gap-0.5 font-medium text-bb-starlink">
                    <Zap aria-hidden="true" className="size-3" />
                    Starlink
                  </span>
                ) : (
                  <span className="flex shrink-0 items-center gap-0.5">
                    <Wifi aria-hidden="true" className="size-3" />
                    {aircraft.wifi}
                  </span>
                )}
              </>
            ) : null}
          </div>

          {notes ? (
            <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-[10px] leading-4">
              {swapText ? (
                <span className={cn('rounded-sm border px-1', SWAP_TONE[row.swap!.tone])}>{swapText}</span>
              ) : null}
              {row.status.seen ? <span className="text-muted-foreground">seen airborne</span> : null}
              {row.faaContext ? <span className="text-bb-warn">{row.faaContext}</span> : null}
              {row.special ? (
                <span className="flex items-center gap-0.5 text-muted-foreground">
                  <Star aria-hidden="true" className="size-3" />
                  {row.special}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      {hasIdent ? (
        <Button
          variant="ghost"
          size="icon"
          // Above the stretched row button, and a full 44 px on every pointer: this list only
          // renders below `md`, where the visitor is on a phone.
          className="relative z-10 size-11 shrink-0"
          aria-label={`Watch ${row.identDisplay}`}
          aria-pressed={watched}
          title={`${watched ? 'Stop watching' : 'Watch'} ${row.identDisplay}`}
          onClick={() => onToggleWatch(row)}
        >
          <Eye aria-hidden="true" className={watched ? 'text-primary' : 'text-muted-foreground'} />
        </Button>
      ) : (
        <span className="size-11 shrink-0" />
      )}
    </li>
  );
});
