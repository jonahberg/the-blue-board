/**
 * Hub Departures Board — a NOC-style FIDS built entirely client-side from the per-tail
 * schedules already in memory (inventory §22, `renderSlRoutesBoard()`). No endpoint, no poll
 * of its own: `buildDeparturesBoard()` in `src/lib/starlink-utils.js` flattens, windows, caps
 * and buckets, and this file lays the result out.
 *
 * Three honesty rules are built into the chrome rather than the footer alone:
 *  - the callsigns are the OPERATING carrier's (SKW####, RPA####), not United marketing
 *    numbers, so the operator is printed next to every one of them;
 *  - the times are scheduled / last-seen out of a cache up to six hours old, so the panel
 *    states its own freshness inline instead of implying live ATC;
 *  - in the degraded tier the board does not appear at all — it is replaced by one line
 *    saying the schedule feed is offline, because an empty board reads as "no departures".
 *
 * The all-hubs view caps each hub to a tight slice (`boardCapPolicy`): the uncapped 12 h list
 * is ~180 rows, which buries the roster and the ledger below it. "Show all" lifts the cap.
 */

import { memo } from 'react';

import { Card } from '@/components/ui/card';
import { formatFlightTime } from '@/lib/starlink-view.js';
import { operatorLabel, relativeDeparture } from '@/lib/starlink-roster.js';
import type { BoardModel, BoardRow } from './types';

export type WindowHours = 12 | 48;

/** Verbatim from the shipped panel — this line is the whole disclosure for the board. */
export const BOARD_FOOTER =
  "A NOC departures board, not a passenger FIDS. Callsigns are the operating carrier (SkyWest, Republic, Mesa…), not United marketing flight numbers. Times are scheduled / last-seen, served through The Blue Board's cache (up to 6h) — not live ATC.";

export const BOARD_UNAVAILABLE_NOTE =
  'Live departures board unavailable — Starlink schedule feed is offline (showing the fleet roster only).';

function Row({
  row,
  tzAbbrev,
  onOpenAircraft,
  onTrack,
}: {
  row: BoardRow;
  tzAbbrev: (hub: string) => string;
  onOpenAircraft: (reg: string) => void;
  onTrack: (row: BoardRow) => void;
}) {
  const time = formatFlightTime(row.departure_ts, row.origin, tzAbbrev) as string;
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-b px-2 py-2 last:border-b-0 sm:grid-cols-[7.5rem_minmax(0,11rem)_minmax(0,1fr)_auto_auto]">
      <span className="font-mono text-[11px] tabular-nums">
        {time}
        <span className="ml-1.5 text-muted-foreground">{relativeDeparture(row.deltaSec)}</span>
      </span>

      <button
        type="button"
        onClick={() => onOpenAircraft(row.tail)}
        className="min-h-11 min-w-0 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring md:min-h-0"
        title={`Aircraft details · ${row.tail}`}
      >
        <span className="block truncate font-mono text-xs font-semibold">
          {row.flight_number || '—'}
        </span>
        <span className="block truncate text-[10px] text-muted-foreground">
          {operatorLabel(row.operator)} · {row.tail}
        </span>
      </button>

      <span className="col-span-3 font-mono text-[11px] sm:col-span-1">
        {row.origin}
        <span aria-hidden="true" className="mx-1 text-muted-foreground">
          →
        </span>
        {row.destination || '???'}
      </span>

      <span className="hidden text-[11px] text-muted-foreground sm:inline">{row.type}</span>

      <span className="col-span-3 flex items-center justify-end gap-2 sm:col-span-1">
        {row.airborne ? (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold">
            <span aria-hidden="true" className="size-1.5 rounded-full bg-emerald-400" />
            Airborne
          </span>
        ) : (
          <span className="text-[10px] text-muted-foreground">SCHED</span>
        )}
        {row.airborne && row.icao24 ? (
          <button
            type="button"
            onClick={() => onTrack(row)}
            className="inline-flex min-h-11 items-center rounded-md border px-2 text-[10px] hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring md:min-h-7"
            title={`Track ${row.tail} on the live map`}
          >
            <span aria-hidden="true" className="mr-1">
              📡
            </span>
            Track
          </button>
        ) : null}
      </span>
    </div>
  );
}

export const DeparturesBoard = memo(function DeparturesBoard({
  board,
  hubCodes,
  hub,
  onHub,
  windowH,
  onWindow,
  onShowAll,
  freshness,
  tzAbbrev,
  onOpenAircraft,
  onTrack,
}: {
  board: BoardModel;
  hubCodes: string[];
  hub: string | null;
  onHub: (hub: string | null) => void;
  windowH: WindowHours;
  onWindow: (hours: WindowHours) => void;
  onShowAll: () => void;
  /** "updated 12m ago" / "scheduled times" — never a claim of liveness. */
  freshness: string;
  tzAbbrev: (hub: string) => string;
  onOpenAircraft: (reg: string) => void;
  onTrack: (row: BoardRow) => void;
}) {
  return (
    <Card className="gap-0 p-4" id="sl-board">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">Hub Departures Board</h3>
          <p className="text-[11px] text-muted-foreground">
            United Starlink aircraft departing the hubs · operating callsigns ·{' '}
            <span id="sl-board-updated">{freshness}</span>
          </p>
        </div>
        <div className="flex gap-1" id="sl-board-windows" role="group" aria-label="Departure window">
          {([12, 48] as WindowHours[]).map((hours) => (
            <button
              key={hours}
              type="button"
              aria-pressed={windowH === hours}
              onClick={() => onWindow(hours)}
              className="min-h-11 rounded-md border px-3 text-[11px] font-semibold aria-pressed:bg-accent aria-pressed:text-accent-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring md:min-h-8"
            >
              {hours}H
            </button>
          ))}
        </div>
      </div>

      <div
        className="mt-3 flex flex-wrap gap-1"
        id="sl-board-pills"
        role="group"
        aria-label="Filter departures by hub"
      >
        <button
          type="button"
          aria-pressed={!hub}
          onClick={() => onHub(null)}
          className="min-h-11 rounded-md border px-2.5 text-[11px] font-semibold aria-pressed:bg-accent aria-pressed:text-accent-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring md:min-h-8"
        >
          ALL <span className="ml-1 font-mono tabular-nums opacity-70">{board.allCount}</span>
        </button>
        {hubCodes.map((code) => {
          const count = board.hubCounts[code] || 0;
          return (
            <button
              key={code}
              type="button"
              aria-pressed={hub === code}
              onClick={() => onHub(code)}
              // A zero hub is still offered — Pacific hubs go quiet for hours and hiding them
              // would read as "GUM has no Starlink aircraft".
              className={`min-h-11 rounded-md border px-2.5 text-[11px] font-semibold aria-pressed:bg-accent aria-pressed:text-accent-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring md:min-h-8 ${count === 0 ? 'sl-board-pill-empty opacity-50' : ''}`}
            >
              {code} <span className="ml-1 font-mono tabular-nums opacity-70">{count}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-3" id="sl-board-body">
        {board.buckets.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">
            No United Starlink departures from {hub ?? 'the hubs'} in the next {windowH}h.
          </p>
        ) : (
          <>
            {board.buckets.map((bucket) => (
              <div key={bucket.label}>
                <p className="mt-3 mb-1 text-[10px] font-semibold tracking-widest text-muted-foreground uppercase first:mt-0">
                  {bucket.label}{' '}
                  <span className="ml-1 font-mono tabular-nums opacity-70">
                    {bucket.rows.length}
                  </span>
                </p>
                <div className="rounded-md border">
                  {bucket.rows.map((row) => (
                    <Row
                      key={`${row.tail}-${row.departure_ts}-${row.flight_number}`}
                      row={row}
                      tzAbbrev={tzAbbrev}
                      onOpenAircraft={onOpenAircraft}
                      onTrack={onTrack}
                    />
                  ))}
                </div>
              </div>
            ))}
            {board.hiddenCount > 0 ? (
              <button
                type="button"
                onClick={onShowAll}
                className="mt-3 min-h-11 w-full rounded-md border text-[11px] font-semibold hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                Show all · {board.hiddenCount} more departures ▾
              </button>
            ) : null}
          </>
        )}
      </div>

      <p className="mt-3 border-t pt-2 text-[10px] text-muted-foreground">{BOARD_FOOTER}</p>
    </Card>
  );
});

export default DeparturesBoard;
