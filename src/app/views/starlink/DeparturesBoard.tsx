/**
 * Hub Departures Board — a NOC-style FIDS built entirely client-side from the per-tail
 * schedules already in memory (inventory §22, `renderSlRoutesBoard()`). No endpoint, no poll
 * of its own: `buildDeparturesBoard()` in `src/lib/starlink-utils.js` flattens, windows, caps
 * and buckets, and this file lays the result out.
 *
 * Three honesty rules are built into the chrome rather than the footer alone:
 *  - every United number prints in one form, the ident of the flight page it links to
 *    (`starlinkFlightLabel()` in src/lib/starlink-roster.js): the feed's mainline UAL347 reads
 *    UA347, and an Express leg the feed marks United reads its United number (SKW5415 → UA5415,
 *    `unitedNumber()`, checked against flight_history and approved by the owner Nov 12 2026). The
 *    carrier that operates the flight is printed under every number, and a number that does not
 *    link prints as the feed sent it;
 *  - the times are scheduled, from a stored schedule whose real age is stated inline and in the
 *    footer (`freshness` / `footer`, from src/lib/starlink-roster.js: "schedule synced 2h ago",
 *    "tracker offline, schedule from 22h ago"), never implying live ATC. The fixed "cache (up to
 *    6h)" footer was false whenever the tracker was down (22 h on Nov 11 2026);
 *  - an empty board must not read as "no departures" when it is the schedule that ran out:
 *    `emptyText` says the feed is offline then, and in the degraded tier the board does not
 *    appear at all — one line says the schedule feed is offline instead.
 *
 * The all-hubs view caps each hub to a tight slice (`boardCapPolicy`): the uncapped 12 h list
 * is ~180 rows, which buries the roster and the ledger below it. "Show all" lifts the cap.
 */

import { Radio } from 'lucide-react';
import { memo } from 'react';

import { Card } from '@/components/ui/card';
import { fleetTypeCodeForTail } from '@/lib/fleet-type-link.js';
import { formatFlightTime } from '@/lib/starlink-view.js';
import { operatorLabel, relativeDeparture, starlinkFlightLabel, starlinkInboundLabel } from '@/lib/starlink-roster.js';
import { HubLink, TypeLink } from '../../features/EntityLinks';
import { FlightLink } from '../../features/FlightLink';
import type { BoardModel, BoardRow, FleetByReg } from './types';

export type WindowHours = 12 | 48;

export const BOARD_UNAVAILABLE_NOTE =
  'Live departures board unavailable — Starlink schedule feed is offline (showing the fleet roster only).';

function Row({
  row,
  tzAbbrev,
  fleetByReg,
  onOpenAircraft,
  onTrack,
}: {
  row: BoardRow;
  tzAbbrev: (hub: string) => string;
  fleetByReg: FleetByReg;
  onOpenAircraft: (reg: string) => void;
  onTrack: (row: BoardRow) => void;
}) {
  const time = formatFlightTime(row.departure_ts, row.origin, tzAbbrev) as string;
  // What the row prints is what it links: UA347 for the feed's UAL347, UA5415 for an Express leg
  // the feed marks United; a number with no page prints as sent.
  const flight = starlinkFlightLabel(row.flight_number, row);
  const inbound = row.inbound?.flight ? starlinkInboundLabel(row.inbound.flight) : null;
  return (
    // Every row is its own grid, so the time column is a fixed width at every size: an `auto`
    // column sized itself per row and the callsigns under each other started at different x.
    // On a phone the route shares the second line with the status instead of taking a third.
    // From `sm` the type takes a fixed column beside the route as well: as an `auto` column after
    // the flexible one it was pushed around by each row's status, so no two types lined up.
    // `data-link-row`: the link audit reads each board row as one row (it is a grid, not a <tr>).
    <div
      data-link-row=""
      className="relative grid grid-cols-[7.5rem_minmax(0,1fr)] items-center gap-x-3 gap-y-1 border-b px-2 py-2 last:border-b-0 sm:grid-cols-[7.5rem_minmax(0,11rem)_6rem_5.5rem_minmax(0,1fr)]"
    >
      <span className="font-mono text-[11px] tabular-nums">
        {time}
        <span className="ml-1.5 text-muted-foreground">{relativeDeparture(row.deltaSec)}</span>
      </span>

      {/* The flight number links to its flight page when it is a United number (UA/UAL, or an
          Express leg the feed marks United), printed as that page's ident; an operating callsign
          the feed did not mark United (SKW5408) has no page and is plain text.
          The aircraft button is stretched over this column with a mouse, as the whole column
          was the button before; on a touch screen over the whole row, so the row stays one tap
          target (the aircraft dialog) and only the flight numbers (`z-10`) and Track sit above
          it. A link cannot sit inside a button. */}
      <div className="relative min-w-0 pointer-coarse:static">
        {/* Not `truncate`: its overflow clip would cut the link's touch box (a number is ≤ 7 characters). */}
        <span className="block font-mono text-xs font-semibold">
          <FlightLink ident={flight || '—'} linkClassName="z-10" />
        </span>
        <button
          type="button"
          onClick={() => onOpenAircraft(row.tail)}
          className="block w-full min-w-0 truncate text-left text-[10px] text-muted-foreground after:absolute after:inset-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          title={`Aircraft details · ${row.tail}`}
        >
          <span className="sr-only">Aircraft details:</span>{' '}
          {operatorLabel(row.operator)} · {row.tail}
        </button>
      </div>

      {/* A hub end links to its Schedule board with a mouse, where the aircraft button covers only
          the flight-number column. On a touch screen the row is one tap target, so the hubs and the type
          take no taps there (`finePointerOnly`); the board's own hub chips pick a hub. Any other
          airport is plain text. */}
      <span className="font-mono text-[11px]">
        <HubLink code={row.origin} finePointerOnly className="z-10" />
        <span aria-hidden="true" className="mx-1 text-muted-foreground">
          →
        </span>
        {row.destination ? <HubLink code={row.destination} finePointerOnly className="z-10" /> : '???'}
      </span>

      {/* The tracker's words, linked by the type the fleet database has for this tail: N75436
          prints "737-900" and is a 737-900ER. `truncate` is on the link, not this cell, so the
          cell's overflow clip cannot cut the link's focus ring; inline-block keeps the link as
          wide as its words, not the column. */}
      <span className="hidden min-w-0 text-[11px] text-muted-foreground sm:block">
        {row.type ? (
          <TypeLink
            typeCode={fleetTypeCodeForTail(row.tail, fleetByReg)}
            finePointerOnly
            className="inline-block max-w-full truncate align-top"
          >
            {row.type}
          </TypeLink>
        ) : null}
      </span>

      {/* A long status ("SCHED · inbound on UA3508" + Track inbound) keeps a phone line of its
          own; SCHED or Airborne + Track shares the route's. */}
      <span
        className={`flex min-w-0 items-center justify-end gap-2 text-right sm:col-span-1 ${
          row.inbound && !row.airborne ? 'col-span-2' : ''
        }`}
      >
        {row.airborne ? (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold">
            <span aria-hidden="true" className="size-1.5 rounded-full bg-bb-ok" />
            Airborne
          </span>
        ) : row.inbound ? (
          // The aircraft is in the air on its inbound leg — this departure has not happened. The
          // inbound number is the live feed's, and that feed carries only United flights
          // (/api/fr24-feed?airline=UAL), so the leg is United's: YX3568 reads UA3568, UAL3508
          // reads UA3508 (`starlinkInboundLabel`).
          <span className="text-[10px] text-muted-foreground">
            SCHED · inbound
            {inbound ? (
              <>
                {' on '}
                <FlightLink ident={inbound} tone="quiet" linkClassName="z-10" />
              </>
            ) : null}
          </span>
        ) : (
          <span className="text-[10px] text-muted-foreground">SCHED</span>
        )}
        {(row.airborne && row.icao24) || row.inbound?.icao24 ? (
          <button
            type="button"
            onClick={() => onTrack(row)}
            className="relative z-10 inline-flex min-h-11 shrink-0 items-center rounded-md border px-2 text-[10px] hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring pointer-fine:md:min-h-7"
            title={
              row.airborne
                ? `Track ${row.tail} on the live map`
                : `Track ${row.tail}'s inbound flight${inbound ? ` ${inbound}` : ''} on the live map`
            }
          >
            <Radio aria-hidden="true" className="mr-1 inline size-3 align-[-2px]" />
            {row.airborne ? 'Track' : 'Track inbound'}
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
  emptyText,
  footer,
  tzAbbrev,
  fleetByReg,
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
  /** `starlinkScheduleFreshness()`: "schedule synced 2h ago · airborne live" / "scheduled times". */
  freshness: string;
  /** `starlinkBoardEmptyText()`: what an empty window says — "the feed is offline" once the stored schedule has run out. */
  emptyText: string;
  /** `starlinkBoardFooter()`: the board's whole disclosure, with the schedule's real age. */
  footer: string;
  tzAbbrev: (hub: string) => string;
  /** The fleet database by registration: a mainline tail's type links by it. */
  fleetByReg: FleetByReg;
  onOpenAircraft: (reg: string) => void;
  onTrack: (row: BoardRow) => void;
}) {
  return (
    <Card className="gap-0 p-4" id="sl-board">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">Hub Departures Board</h3>
          <p className="text-[11px] text-muted-foreground">
            United Starlink aircraft departing the hubs · United flight numbers ·{' '}
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
              className="min-h-11 rounded-md border px-3 text-[11px] font-semibold aria-pressed:bg-accent aria-pressed:text-accent-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring pointer-fine:md:min-h-8"
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
          className="min-h-11 rounded-md border px-2.5 text-[11px] font-semibold aria-pressed:bg-accent aria-pressed:text-accent-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring pointer-fine:md:min-h-8"
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
              className={`min-h-11 rounded-md border px-2.5 text-[11px] font-semibold aria-pressed:bg-accent aria-pressed:text-accent-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring pointer-fine:md:min-h-8 ${count === 0 ? 'sl-board-pill-empty opacity-50' : ''}`}
            >
              {code} <span className="ml-1 font-mono tabular-nums opacity-70">{count}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-3" id="sl-board-body">
        {board.buckets.length === 0 ? (
          <p className="py-6 text-center text-xs text-balance text-muted-foreground">{emptyText}</p>
        ) : (
          <>
            {board.buckets.map((bucket) => (
              <div key={bucket.label}>
                <p className="mt-3 mb-1 text-[10px] font-semibold tracking-widest text-muted-foreground uppercase first:mt-0">
                  {bucket.label}{' '}
                  {/* No opacity: on the muted label it measured 4.0:1 (axe color-contrast). */}
                  <span className="ml-1 font-mono tabular-nums">
                    {bucket.rows.length}
                  </span>
                </p>
                <div className="rounded-md border">
                  {bucket.rows.map((row) => (
                    <Row
                      key={`${row.tail}-${row.departure_ts}-${row.flight_number}`}
                      row={row}
                      tzAbbrev={tzAbbrev}
                      fleetByReg={fleetByReg}
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

      <p className="mt-3 border-t pt-2 text-[10px] text-muted-foreground">{footer}</p>
    </Card>
  );
});

export default DeparturesBoard;
