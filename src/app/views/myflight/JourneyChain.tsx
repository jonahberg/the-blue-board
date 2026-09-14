/**
 * "Aircraft Journey" — where this tail has been today (inventory §19).
 *
 * The shaping (drop our own flight, keep three, oldest first) and the delay severity are
 * `src/lib/journey.js`; this file is layout.
 *
 * Three distinct states, and telling them apart is the point. `null` segments means the
 * history request has not answered yet — a loading line. An EMPTY array means it
 * answered and there is nothing usable, which is an answer and says so. The shipped card
 * showed the loading line for both, so a credit-blocked upstream produced a spinner that
 * never resolved.
 */

import { journeyDelayClass, shapeJourney } from '@/lib/journey.js';
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
      <h4 className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        Aircraft Journey ({reg})
      </h4>
      <ol className="space-y-1">
        {prior.map((segment, index) => {
          const delay = segment.delayMin;
          const delayText = delay === null || delay === undefined ? '' : delay <= 0 ? 'On time' : `+${delay}min`;
          const status = segmentStatus(segment.status);
          return (
            <li
              key={`${segment.flightNumber}-${index}`}
              className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[11px]"
            >
              <span className="font-mono font-medium">{segment.flightNumber}</span>
              <span className="font-mono text-muted-foreground">
                {segment.origin} → {segment.destination}
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
          <span className="font-mono font-medium text-primary">{flight}</span>
          <span className="font-mono text-muted-foreground">
            {origCode} → {destCode}
          </span>
          <span className="ml-auto text-[10px] text-primary">Your flight</span>
        </li>
      </ol>
    </div>
  );
}
