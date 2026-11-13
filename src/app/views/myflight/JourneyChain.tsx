/**
 * "Aircraft Journey" — where this tail has been today (inventory §19).
 *
 * The shaping (drop our own flight, keep three, oldest first) and the delay severity are
 * `src/lib/journey.js`; this file is layout.
 *
 * Each earlier leg links its flight number to the flight page (a United number; an operating
 * callsign stays plain) and its hub ends to their Schedule boards, and the heading's tail opens the
 * aircraft dialog. The last line is the card's own flight, whose links are the card's header.
 *
 * Three distinct states, and telling them apart is the point. `null` segments means the
 * history request has not answered yet — a loading line. An EMPTY array means it
 * answered and there is nothing usable, which is an answer and says so. The shipped card
 * showed the loading line for both, so a credit-blocked upstream produced a spinner that
 * never resolved.
 */

import { journeyDelayClass, shapeJourney } from '@/lib/journey.js';
import { HubLink, TailLink } from '../../features/EntityLinks';
import { FlightLink } from '../../features/FlightLink';
import type { JourneySegment } from './useAircraftJourney';
import { JOURNEY_DELAY_TONE } from './tone';

function segmentStatus(status: string | undefined): { text: string; airborne: boolean; landed: boolean } {
  const value = (status || '').toLowerCase();
  const airborne = value === 'en-route' || value === 'airborne' || value === 'en route';
  const landed = value === 'landed' || value === 'arrived';
  return { text: airborne ? 'Airborne' : landed ? 'Landed' : status || '', airborne, landed };
}

export function JourneyChain({
  reg,
  segments,
  flight,
  origCode,
  destCode,
}: {
  reg: string;
  segments: JourneySegment[] | null;
  flight: string;
  origCode: string;
  destCode: string;
}) {
  if (segments === null) {
    return (
      <p className="rounded-md border border-dashed px-2.5 py-2 text-[11px] text-muted-foreground">
        Loading aircraft journey…
      </p>
    );
  }

  const prior = (shapeJourney(segments, flight, origCode, destCode) as { prior: JourneySegment[] })
    .prior;

  if (prior.length === 0) {
    return (
      <p className="rounded-md border border-dashed px-2.5 py-2 text-[11px] text-muted-foreground">
        Flight history unavailable
      </p>
    );
  }

  return (
    <div className="rounded-md border p-2.5">
      {/* The tail is 44 px tall on touch (`hit="inline"`): a box would reach down over the first
          leg's links. */}
      <h3 className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        Aircraft Journey (<TailLink reg={reg} tone="quiet" hit="inline" />)
      </h3>
      {/* Each leg is one line: its number in link colour, its hub ends quiet. Wherever the 44 px
          touch boxes are drawn (every pointer below `md`, a coarse one at any width) a line is 44 px
          tall and its names sit far apart (gap and the arrow's margin), so no box covers another; a
          mouse at `md`+ gets the tight line (the Starlink roster's Upcoming Flights). */}
      <ol className="space-y-1">
        {prior.map((segment, index) => {
          const delay = segment.delayMin;
          const delayText = delay === null || delay === undefined ? '' : delay <= 0 ? 'On time' : `+${delay}min`;
          const status = segmentStatus(segment.status);
          return (
            <li
              key={`${segment.flightNumber}-${index}`}
              className="flex min-h-11 flex-wrap items-center gap-x-7 gap-y-0.5 text-[11px] pointer-fine:md:min-h-0 pointer-fine:md:items-baseline pointer-fine:md:gap-x-2"
            >
              <FlightLink ident={segment.flightNumber} className="font-mono font-medium" />
              <span className="font-mono text-muted-foreground">
                <HubLink code={segment.origin} />
                <span className="mx-3 pointer-fine:md:mx-1">→</span>
                <HubLink code={segment.destination} />
              </span>
              {delayText ? (
                <span
                  className={`font-mono tabular-nums ${
                    JOURNEY_DELAY_TONE[journeyDelayClass(delay) as string] ?? JOURNEY_DELAY_TONE['']
                  }`}
                >
                  {delayText}
                </span>
              ) : null}
              <span className="ml-auto text-[10px] text-muted-foreground">{status.text}</span>
            </li>
          );
        })}
        <li className="flex flex-wrap items-baseline gap-x-2 border-t pt-1 text-[11px]">
          {/* Body colour: the card's header above is this flight's link to its page. */}
          <span className="font-mono font-semibold">{flight}</span>
          {/* Its route only once known: before that the line read "UA318 →". */}
          {origCode || destCode ? (
            <span className="font-mono text-muted-foreground">
              {origCode || '?'} → {destCode || '?'}
            </span>
          ) : null}
          {/* Not link colour: nothing here links, and blue words read as one (Nov 2026). */}
          <span className="ml-auto text-[10px] font-medium text-foreground">Your flight</span>
        </li>
      </ol>
    </div>
  );
}
