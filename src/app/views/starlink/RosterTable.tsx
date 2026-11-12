/**
 * The Starlink roster — every equipped tail, filterable, sortable, and expandable one row at
 * a time (inventory §22, `renderSlTable()` + `renderSlExpand()`).
 *
 * Two columns are CONDITIONAL rather than empty: Status needs the live feed and Next Flight
 * needs the schedule feed, and a column of em-dashes reads as "this aircraft isn't flying"
 * rather than "we can't see it right now". When the data behind a column is absent, so is the
 * column.
 *
 * Three row-level signals, none of them colour alone:
 *  - NEW — a text badge, with the detection date in its title.
 *  - the red `!` — a disputed tail that upstream is STILL serving. The glyph carries a title
 *    and an sr-only sentence, because this one is a data-integrity claim and must survive
 *    greyscale, a screen reader and a printout.
 *  - Airborne — a dot AND the word.
 *
 * Expanding is a per-row disclosure, so the control is a real button inside the first cell
 * rather than a click handler on the `<tr>`: a whole table row acting as a button steals every
 * text selection and hands a screen reader one enormous, unlabelled control. The tail stays that
 * button; the aircraft dialog is one step on, in the expansion.
 *
 * Names with a home link to it (links everywhere, Nov 12 2026): the type by the fleet database's
 * type for the tail (`fleetTypeCodeForTail`, never the tracker's string), the next flight's number
 * (quiet: the row is about the tail) and its hub ends, and in the expansion each upcoming number
 * and its hub ends. Every United number prints as the ident of the page it links to
 * (`starlinkFlightLabel`): UAL576 reads UA576, an Express leg the feed marks United its United
 * number; a number with no page prints as sent.
 */

import { Radio } from 'lucide-react';
import { Fragment, memo } from 'react';

import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { fleetTypeCodeForTail } from '@/lib/fleet-type-link.js';
import { nextFlight, starlinkFlightLabel, starlinkSinceLabel, upcomingFlights } from '@/lib/starlink-roster.js';
import { formatFlightTime } from '@/lib/starlink-view.js';
import type { StarlinkAircraft } from '../../data/types';
import { HubLink, TypeLink } from '../../features/EntityLinks';
import { FlightLink } from '../../features/FlightLink';
import { SortableHeader } from '../fleet/SortableHeader';
import type { SortState } from '../fleet/SortableHeader';
import type { FleetByReg, FlightsByTail, StarlinkFlight } from './types';

export type RosterSortCol = 'tail' | 'fleet' | 'type' | 'operator';

const COLUMNS: { col: RosterSortCol; label: string }[] = [
  { col: 'tail', label: 'Tail' },
  { col: 'fleet', label: 'Fleet' },
  { col: 'type', label: 'Type' },
  { col: 'operator', label: 'Operator' },
];

export const ROSTER_EMPTY = 'Starlink fleet data unavailable — try refreshing the page.';
export const ROSTER_NO_MATCH = 'No aircraft match your filters.';

/** `formatFlightTime` is JSDoc'd against a plain string; the schedule's fields are optional. */
function depTime(
  ts: number | undefined,
  iata: string | undefined,
  tzAbbrev: (hub: string) => string,
): string {
  return formatFlightTime(ts, iata ?? '', tzAbbrev) as string;
}

/** The number a leg prints, which is what it links: UA576 for UAL576, UA5415 for a marked SKW5415. */
function legNumber(flight: StarlinkFlight): string {
  return starlinkFlightLabel(flight.flight_number, flight);
}

/** A route end: its Schedule board when it is a hub, plain text otherwise. */
function RouteEnd({ code }: { code: string | undefined }) {
  return code ? <HubLink code={code} /> : <>???</>;
}

function Expansion({
  aircraft,
  flights,
  icao24,
  nowMs,
  nowSec,
  colSpan,
  tzAbbrev,
  typeCode,
  onTrack,
  onOpenAircraft,
}: {
  aircraft: StarlinkAircraft;
  flights: StarlinkFlight[];
  icao24: string | null;
  nowMs: number;
  nowSec: number;
  colSpan: number;
  tzAbbrev: (hub: string) => string;
  /** The fleet database's type for this tail (`fleetTypeCodeForTail`), or null. */
  typeCode: string | null;
  onTrack: (icao24: string) => void;
  onOpenAircraft: (reg: string) => void;
}) {
  const upcoming = upcomingFlights(flights, nowSec) as StarlinkFlight[];
  return (
    <TableRow className="bg-muted/30 hover:bg-muted/30">
      <TableCell colSpan={colSpan} className="p-4">
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div>
            <dt className="text-[10px] tracking-wider text-muted-foreground uppercase">
              Starlink Since
            </dt>
            <dd className="font-mono text-xs">
              {starlinkSinceLabel(aircraft.dateFound, nowMs) as string}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] tracking-wider text-muted-foreground uppercase">Operator</dt>
            <dd className="text-xs">{aircraft.operator || '—'}</dd>
          </div>
          <div>
            <dt className="text-[10px] tracking-wider text-muted-foreground uppercase">Airframe</dt>
            <dd className="text-xs">
              {aircraft.type ? <TypeLink typeCode={typeCode}>{aircraft.type}</TypeLink> : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] tracking-wider text-muted-foreground uppercase">Fleet</dt>
            <dd className="text-xs">{aircraft.fleet || '—'}</dd>
          </div>
        </dl>

        <p className="mt-4 text-[10px] tracking-wider text-muted-foreground uppercase">
          Upcoming Flights
        </p>
        {upcoming.length ? (
          // Each line is one flight: its number in link colour, its hub ends quiet, all three live
          // on touch. Wherever the 44 px touch boxes are drawn (every pointer below `md`, a coarse
          // one at any width) a line is 44 px tall, so one line's boxes never cover the next line's,
          // and the number, the hub ends and the arrow sit far apart (gap and margin) so the boxes
          // in a line never overlap side to side: a box reaches about 12 px past a three-letter hub
          // code. Only a mouse at `md`+, where the boxes are gone, gets the tight line
          // (`pointer-fine:md:`).
          <ul className="mt-1 space-y-0.5">
            {upcoming.map((flight, index) => {
              const dep = depTime(flight.departure_ts, flight.origin, tzAbbrev);
              const arrMs = flight.arrival_time ? Date.parse(flight.arrival_time) : NaN;
              const arr = isNaN(arrMs) ? '' : depTime(arrMs / 1000, flight.destination, tzAbbrev);
              return (
                <li
                  key={`${flight.flight_number ?? ''}-${flight.departure_ts ?? 0}-${index}`}
                  data-link-row=""
                  className="flex min-h-11 flex-wrap items-center gap-x-7 text-[11px] pointer-fine:md:min-h-0 pointer-fine:md:items-baseline pointer-fine:md:gap-x-2"
                >
                  <FlightLink ident={legNumber(flight) || '—'} className="font-mono font-semibold" />
                  <span className="font-mono text-muted-foreground">
                    <RouteEnd code={flight.origin} />
                    <span aria-hidden="true" className="mx-3 pointer-fine:md:mx-1">
                      →
                    </span>
                    <RouteEnd code={flight.destination} />
                  </span>
                  <span className="font-mono tabular-nums text-muted-foreground">
                    {dep}
                    {arr ? ` – ${arr}` : ''}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-1 text-[11px] text-muted-foreground">No upcoming flights in the feed</p>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          {icao24 ? (
            <Button size="sm" className="min-h-11 pointer-fine:md:min-h-8" onClick={() => onTrack(icao24)}>
              <Radio aria-hidden="true" /> Track on Live Map
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="outline"
            className="min-h-11 pointer-fine:md:min-h-8"
            onClick={() => onOpenAircraft(aircraft.tail)}
          >
            Aircraft Details
          </Button>
          <Button asChild size="sm" variant="outline" className="min-h-11 pointer-fine:md:min-h-8">
            <a
              href={`https://www.planespotters.net/search?q=${encodeURIComponent(aircraft.tail)}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Planespotters ↗
            </a>
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

export const RosterTable = memo(function RosterTable({
  rows,
  totalRows,
  sort,
  onSort,
  expanded,
  onToggleExpand,
  airborneByTail,
  conflictTails,
  newTails,
  flightsByTail,
  hasLive,
  hasFlights,
  nowMs,
  nowSec,
  tzAbbrev,
  fleetByReg,
  onTrack,
  onOpenAircraft,
}: {
  rows: StarlinkAircraft[];
  /** The unfiltered roster size — zero means "no data", not "no matches". */
  totalRows: number;
  sort: SortState<RosterSortCol>;
  onSort: (col: RosterSortCol) => void;
  expanded: string | null;
  onToggleExpand: (tail: string) => void;
  airborneByTail: Record<string, { icao24?: string }>;
  conflictTails: Set<string>;
  newTails: Set<string>;
  flightsByTail: FlightsByTail;
  hasLive: boolean;
  hasFlights: boolean;
  nowMs: number;
  nowSec: number;
  tzAbbrev: (hub: string) => string;
  /** The fleet database by registration: a mainline tail's type links by it. */
  fleetByReg: FleetByReg;
  onTrack: (icao24: string) => void;
  onOpenAircraft: (reg: string) => void;
}) {
  const colSpan = COLUMNS.length + (hasLive ? 1 : 0) + (hasFlights ? 1 : 0);

  if (totalRows === 0) {
    return (
      <div className="rounded-lg border border-dashed p-6 text-center">
        <p className="text-sm">{ROSTER_EMPTY}</p>
      </div>
    );
  }

  return (
    <div
      tabIndex={0}
      aria-label="Starlink fleet table, scrollable region"
      className="max-h-[60svh] overflow-auto rounded-lg border focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
    >
      <Table>
        <TableHeader className="sticky top-0 z-10 bg-card">
          <TableRow>
            {COLUMNS.map(({ col, label }) => (
              <SortableHeader key={col} col={col} label={label} sort={sort} onSort={onSort} />
            ))}
            {hasLive ? <TableHead scope="col">Status</TableHead> : null}
            {hasFlights ? <TableHead scope="col">Next Flight</TableHead> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={colSpan} className="py-6 text-center text-sm">
                {ROSTER_NO_MATCH}
              </TableCell>
            </TableRow>
          ) : null}
          {rows.map((aircraft) => {
            const live = airborneByTail[aircraft.tail];
            const isOpen = expanded === aircraft.tail;
            const flights = flightsByTail[aircraft.tail] ?? [];
            const nextLeg = hasFlights
              ? (nextFlight(flights, nowSec) as StarlinkFlight | null)
              : null;
            const typeCode = fleetTypeCodeForTail(aircraft.tail, fleetByReg);
            return (
              <Fragment key={aircraft.tail}>
                <TableRow data-state={isOpen ? 'selected' : undefined}>
                  <TableCell className="font-mono">
                    <button
                      type="button"
                      onClick={() => onToggleExpand(aircraft.tail)}
                      aria-expanded={isOpen}
                      className="inline-flex min-h-11 items-center gap-1 text-left underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring pointer-fine:md:min-h-0"
                    >
                      <span aria-hidden="true" className="text-[9px] opacity-60">
                        {isOpen ? '▾' : '▸'}
                      </span>
                      {aircraft.tail}
                    </button>
                    {newTails.has(aircraft.tail) ? (
                      <span
                        className="ml-1 rounded border px-1 py-0.5 text-[9px] font-semibold text-bb-warn"
                        title={`Starlink equipment first seen ${aircraft.dateFound ?? 'recently'}`}
                      >
                        NEW
                      </span>
                    ) : null}
                    {conflictTails.has(aircraft.tail) ? (
                      <span
                        className="ml-1 inline-flex size-4 items-center justify-center rounded-full bg-destructive text-[9px] font-bold text-white"
                        title="Disputed by official verification — should not be served. See the Verification Ledger below."
                      >
                        <span aria-hidden="true">!</span>
                        <span className="sr-only">
                          Integrity conflict: disputed by official verification
                        </span>
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-xs">{aircraft.fleet}</TableCell>
                  <TableCell className="text-xs">
                    {aircraft.type ? <TypeLink typeCode={typeCode}>{aircraft.type}</TypeLink> : null}
                  </TableCell>
                  <TableCell className="text-[11px] text-muted-foreground">
                    {aircraft.operator}
                  </TableCell>
                  {hasLive ? (
                    <TableCell>
                      {live ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold">
                          <span aria-hidden="true" className="size-1.5 rounded-full bg-bb-ok" />
                          Airborne
                        </span>
                      ) : (
                        <span className="text-[10px] text-muted-foreground">Scheduled</span>
                      )}
                    </TableCell>
                  ) : null}
                  {hasFlights ? (
                    <TableCell className="text-[10px] text-muted-foreground">
                      {/* One muted run: the number and the hub ends are quiet links (the row is about
                          the tail); hubs as on the departures board, any other airport plain. */}
                      {nextLeg ? (
                        <>
                          <FlightLink ident={legNumber(nextLeg)} tone="quiet" className="font-mono" />{' '}
                          {nextLeg.origin ? <HubLink code={nextLeg.origin} finePointerOnly /> : null}→
                          {nextLeg.destination ? <HubLink code={nextLeg.destination} finePointerOnly /> : null}{' '}
                          <span className="font-mono tabular-nums">
                            {depTime(nextLeg.departure_ts, nextLeg.origin, tzAbbrev)}
                          </span>
                        </>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                  ) : null}
                </TableRow>
                {isOpen ? (
                  <Expansion
                    aircraft={aircraft}
                    flights={flights}
                    icao24={live?.icao24 || null}
                    nowMs={nowMs}
                    nowSec={nowSec}
                    colSpan={colSpan}
                    tzAbbrev={tzAbbrev}
                    typeCode={typeCode}
                    onTrack={onTrack}
                    onOpenAircraft={onOpenAircraft}
                  />
                ) : null}
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
});

export default RosterTable;
