/**
 * One watched flight (inventory §19).
 *
 * Purely presentational: every decision on the model handed in was made by
 * `src/lib/my-flights.js`, `flight-status-resolve.js`, `delay-risk.js` or the view that
 * owns the stores. This file chooses layout and nothing else.
 *
 * Two honesty rules drive most of what looks like defensive code here:
 *  - the risk badge NEVER defaults to LOW. With no inputs of its own it reuses the
 *    Schedule board's score, and with neither it says "RISK N/A" out loud. A green badge
 *    derived from a dark feed, beside a board reading V.HIGH for the same flight, is the
 *    failure this rule exists for (audit Jul 3 2026).
 *  - a card that cannot get a status says so after two misses instead of showing
 *    "LOADING…" forever, and points at united.com (F008).
 */

import { Zap } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  myFlightCountdown,
  myFlightGateLabels,
  myFlightPendingChip,
  myFlightStatusChip,
  myFlightTimes,
  seatConfigString,
} from '@/lib/my-flights.js';
import { STARLINK_TAB_HREF, routeEndLabel } from '@/lib/name-links.js';
import type { FleetAircraft, Flight, FlightTimes, WatchedFlight } from '../../data/types';
import { DashLink } from '../../features/DashLink';
import { HubLink, TailLink, TypeLink } from '../../features/EntityLinks';
import { FlightLink } from '../../features/FlightLink';
import { JargonTerm } from '../../features/JargonTerm';
import { JourneyChain } from './JourneyChain';
import { StarlinkBadge } from './StarlinkBadge';
import type { JourneySegment } from './useAircraftJourney';
import { COUNTDOWN_TONE, MY_FLIGHT_STATUS_TONE } from './tone';

/** `computeDelayRiskModel()`'s public shape. */
export type RiskModel = { score: number; label: string; color: string; factors: string[] };

export type MyFlightCardModel = {
  entry: WatchedFlight;
  td: FlightTimes | null;
  failures: number;
  origCode: string;
  destCode: string;
  origCity: string;
  destCity: string;
  /** As `resolveFlightStatus()` returns it; '' when there is no payload. */
  resolvedStatus: string;
  reg: string;
  liveFlight: Flight | null;
  aircraft: FleetAircraft | undefined;
  /**
   * The fleet type the card's aircraft type links to (`fleetTypeCodeFor`): by the tail when there
   * is one, otherwise only a provider string that is exactly a fleet type (`providerTypeText`).
   */
  typeCode: string | null;
  isStarlink: boolean;
  /** The same tail, inbound to our origin, while we are still on the ground. */
  inbound: Flight | null;
  journeySegments: JourneySegment[] | null;
  risk: RiskModel | null;
  /** No inputs and no board score: say so rather than guessing (never a default LOW). */
  riskNA: boolean;
  explainContext: Record<string, unknown> | null;
};

/**
 * One end of the card's route: "Chicago (ORD)", or the code alone. A hub code links to its
 * Schedule board; it is 44 px tall on touch (`hit="inline"`) rather than carrying a box that would
 * reach up over the flight number's.
 */
function RouteEnd({ code, city }: { code: string; city: string }) {
  const label = routeEndLabel(code, city);
  return label.city ? (
    <>
      {label.city} (<HubLink code={label.code} hit="inline" />)
    </>
  ) : (
    <HubLink code={label.code} hit="inline" />
  );
}

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-mono text-sm">{children}</dd>
    </div>
  );
}

export function FlightCard({
  model,
  now,
  onViewOnMap,
  onAircraftDetail,
  onExplain,
  onUnwatch,
}: {
  model: MyFlightCardModel;
  now: number;
  onViewOnMap: (flight: Flight) => void;
  onAircraftDetail: (reg: string) => void;
  onExplain: (context: Record<string, unknown>) => void;
  onUnwatch: (flight: string) => void;
}) {
  const {
    entry,
    td,
    failures,
    origCode,
    destCode,
    origCity,
    destCity,
    resolvedStatus,
    reg,
    liveFlight,
    aircraft,
    typeCode,
    isStarlink,
    inbound,
    journeySegments,
    risk,
    riskNA,
    explainContext,
  } = model;

  const hasPayload = Boolean(td && td.success !== false);
  const chip = hasPayload
    ? (myFlightStatusChip(resolvedStatus) as { text: string; tone: string })
    : (myFlightPendingChip(failures) as { text: string; tone: string; terminal: boolean });
  const terminalFailure = !hasPayload && (chip as { terminal?: boolean }).terminal === true;

  const { depISO, arrISO } = myFlightTimes(td) as { depISO: string; arrISO: string };
  const countdown = myFlightCountdown({ status: resolvedStatus, depISO, arrISO, now }) as {
    text: string;
    tone: string;
  };
  const gates = myFlightGateLabels(td) as { origin: string; destination: string };

  // The badge is only meaningful before the flight goes: once it is airborne or down,
  // a PREDICTION of lateness is noise beside the facts above it.
  const showRisk =
    resolvedStatus === 'scheduled' || resolvedStatus === 'delayed' || !resolvedStatus;

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className="flex flex-wrap items-start justify-between gap-2 border-b bg-muted/30 px-3 py-2.5">
        <div className="min-w-0">
          {/* The flight number is a link to its flight page (src/lib/flight-link.js), and the
              card's heading: its "Where's My Plane?" and journey headings are h3 under it (axe
              heading-order found them as h4 with nothing above). */}
          <h2 className="font-mono text-base font-bold">
            <FlightLink ident={entry.flight} />
          </h2>
          {/* Until the route is known (a watch added by flight number, times still loading)
              the line printed "() → ()"; it waits as a skeleton instead, and says nothing once
              the lookup has given up. */}
          {origCode || destCode ? (
            // A city we have no name for falls back to its code: "EUG", not "EUG (EUG)". Not
            // `truncate`: its clip would cut the hub links' focus rings; a long route wraps.
            <div className="text-[11px] text-muted-foreground">
              <RouteEnd code={origCode} city={origCity} /> → <RouteEnd code={destCode} city={destCity} />
            </div>
          ) : !hasPayload && !terminalFailure ? (
            <Skeleton className="mt-1 h-3 w-36" />
          ) : null}
        </div>
        <div className="text-right">
          {countdown.text ? (
            <div
              className={`font-mono text-sm tabular-nums ${COUNTDOWN_TONE[countdown.tone] ?? COUNTDOWN_TONE['']}`}
            >
              {countdown.text}
            </div>
          ) : null}
          {countdown.text && td?.arrival?.etaSource === 'live' ? (
            // Say where the number came from: the provider's own estimate disagreed with the
            // aircraft's position by more than half an hour, so this one is ours (D1).
            <div className="text-[10px] text-muted-foreground">
              ETA from live position
            </div>
          ) : null}
          <div className="mt-1 flex flex-wrap justify-end gap-1">
            <Badge
              variant="outline"
              className={`text-[9px] font-semibold ${MY_FLIGHT_STATUS_TONE[chip.tone] ?? MY_FLIGHT_STATUS_TONE.unavailable}`}
            >
              {chip.text}
            </Badge>
            {showRisk && risk && explainContext ? (
              // The chip stays 9 px, but the TARGET does not: the button itself carries
              // the 44 px floor below `md:` and the coloured chip sits in an inner span,
              // so a thumb gets a real target without the badge growing into a slab.
              <button
                type="button"
                onClick={() => onExplain(explainContext)}
                title="Click for AI analysis"
                className="inline-flex min-h-11 min-w-11 items-center justify-center pointer-fine:md:min-h-0 pointer-fine:md:min-w-0"
              >
                <span
                  className="rounded-md border px-1.5 py-0.5 text-[9px] font-semibold"
                  style={{
                    backgroundColor: `${risk.color}20`,
                    color: risk.color,
                    borderColor: `${risk.color}66`,
                  }}
                >
                  {risk.label} RISK
                </span>
              </button>
            ) : null}
            {showRisk && riskNA ? (
              // A term, not a title=: a touch screen never shows a title (Nov 2026).
              <JargonTerm description="Not enough live data to score this flight" className="text-muted-foreground">
                <Badge variant="outline" className="text-[9px] font-semibold text-muted-foreground">
                  RISK N/A
                </Badge>
              </JargonTerm>
            ) : null}
          </div>
        </div>
      </div>

      <div className="space-y-3 px-3 py-3">
        {terminalFailure ? (
          <p className="text-[11px] text-muted-foreground">
            Live status is unavailable right now — check{' '}
            <a
              href="https://www.united.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline underline-offset-2"
            >
              united.com
            </a>{' '}
            for the latest. We&rsquo;ll keep retrying.
          </p>
        ) : null}

        {hasPayload ? (
          <dl className="grid grid-cols-2 gap-3">
            <Cell label="Origin Gate">{gates.origin}</Cell>
            <Cell label="Dest Gate">{gates.destination}</Cell>
          </dl>
        ) : null}

        {aircraft ? (
          <dl className="grid grid-cols-2 gap-3">
            <Cell label="Aircraft">
              {/* The type links to the Fleet tab filtered to it, by this tail's fleet type; the tail
                  to its aircraft dialog. Both quiet (the card is about the flight) and 44 px tall on
                  touch (`hit="inline"`), side by side without boxes that could overlap. */}
              <TypeLink typeCode={typeCode} hit="inline">
                {aircraft.t}
              </TypeLink>{' '}
              <TailLink reg={reg} tone="quiet" hit="inline" className="text-[10px]" />
            </Cell>
            <Cell label="Config">
              <span className="text-xs">{seatConfigString(aircraft)}</span>
              {isStarlink ? (
                // A quiet link to the Starlink tab: the badge is not a control of its own, so the
                // badge itself is the link. `overflow-visible` keeps its touch box from being clipped.
                <Badge
                  asChild
                  variant="outline"
                  className="ml-1 overflow-visible border-bb-starlink/40 bg-bb-starlink/15 text-[9px] font-normal text-bb-starlink"
                >
                  <DashLink href={STARLINK_TAB_HREF}>
                    <Zap aria-hidden="true" /> Starlink Confirmed
                  </DashLink>
                </Badge>
              ) : (
                <StarlinkBadge flight={entry.flight} forecast={false} />
              )}
            </Cell>
          </dl>
        ) : td?.aircraft ? (
          <div>
            <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Aircraft</dt>
            <dd className="mt-0.5 font-mono text-sm">
              {/* The provider's own type text: it links only by a tail the fleet database knows, or
                  when it is exactly a fleet type (never an ICAO code such as A320 or B739). */}
              <TypeLink typeCode={typeCode} hit="inline">
                {td.aircraft}
              </TypeLink>
              <StarlinkBadge flight={entry.flight} forecast />
            </dd>
            {/* Say honestly that we do not know the metal, rather than implying a lookup. */}
            {!reg ? (
              <p className="mt-0.5 text-[9px] text-muted-foreground">Tail not yet assigned</p>
            ) : null}
          </div>
        ) : null}

        {hasPayload && td?.source?.startsWith('schedule-cache') ? (
          // The two-tier fallback behind /api/flight-times (schedule snapshot, then FR24) is
          // otherwise invisible: a snapshot-sourced card would look exactly as authoritative as a
          // live one.
          <p className="text-[10px] text-muted-foreground">
            {td.source === 'schedule-cache+fr24'
              ? 'via schedule snapshot + Flightradar24 live'
              : 'via schedule snapshot'}
          </p>
        ) : hasPayload && td?.timesUnavailable ? (
          // FR24-only answer: a live leg with no published times, not a flight without a schedule.
          <p className="text-[10px] text-muted-foreground">Live tracking only — no schedule times yet</p>
        ) : null}

        {reg ? (
          journeySegments && journeySegments.length > 0 ? (
            <JourneyChain
              reg={reg}
              segments={journeySegments}
              flight={entry.flight}
              origCode={origCode}
              destCode={destCode}
            />
          ) : inbound ? (
            <div className="rounded-md border border-primary/40 bg-primary/5 p-2.5 text-[11px] leading-relaxed">
              {/* Body colour: a heading, not a link. */}
              <h3 className="mb-1 text-[10px] font-medium uppercase tracking-wide text-foreground">
                Where&rsquo;s My Plane?
              </h3>
              {/* The inbound number links to its flight page when it is a United number (an
                  operating callsign stays plain), and its hub ends to their boards. Quiet, a second
                  name in a card about your flight; 44 px tall on touch, since a sentence that wraps
                  would stack touch boxes over each other. */}
              Your aircraft is currently operating{' '}
              <strong>
                <FlightLink ident={inbound.flightIATA} tone="quiet" hit="inline" />
              </strong>{' '}
              from <HubLink code={inbound.origin} hit="inline" /> → <HubLink code={origCode} hit="inline" /> at{' '}
              {Math.round(inbound.alt * 3.28084).toLocaleString()} ft
            </div>
          ) : (
            <JourneyChain
              reg={reg}
              segments={journeySegments}
              flight={entry.flight}
              origCode={origCode}
              destCode={destCode}
            />
          )
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2 border-t px-3 py-2">
        {liveFlight ? (
          <Button
            size="sm"
            variant="outline"
            className="min-h-11 text-xs pointer-fine:md:h-8 pointer-fine:md:min-h-0"
            onClick={() => onViewOnMap(liveFlight)}
          >
            View on Map
          </Button>
        ) : null}
        {reg ? (
          <Button
            size="sm"
            variant="outline"
            className="min-h-11 text-xs pointer-fine:md:h-8 pointer-fine:md:min-h-0"
            onClick={() => onAircraftDetail(reg)}
          >
            Aircraft Details
          </Button>
        ) : null}
        {risk && explainContext ? (
          <Button
            size="sm"
            variant="outline"
            className="min-h-11 text-xs pointer-fine:md:h-8 pointer-fine:md:min-h-0"
            onClick={() => onExplain(explainContext)}
          >
            Explain Delay Risk
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto min-h-11 text-xs pointer-fine:md:h-8 pointer-fine:md:min-h-0"
          onClick={() => onUnwatch(entry.flight)}
        >
          Unwatch
        </Button>
      </div>
    </Card>
  );
}
