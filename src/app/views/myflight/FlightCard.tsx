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

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  myFlightCountdown,
  myFlightGateLabels,
  myFlightPendingChip,
  myFlightStatusChip,
  myFlightTimes,
  seatConfigString,
} from '@/lib/my-flights.js';
import type { FleetAircraft, Flight, FlightTimes, WatchedFlight } from '../../data/types';
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
  isStarlink: boolean;
  /** The same tail, inbound to our origin, while we are still on the ground. */
  inbound: Flight | null;
  journeySegments: JourneySegment[] | null;
  risk: RiskModel | null;
  /** No inputs and no board score: say so rather than guessing (never a default LOW). */
  riskNA: boolean;
  explainContext: Record<string, unknown> | null;
};

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
          <div className="font-mono text-base font-bold text-primary">{entry.flight}</div>
          <div className="truncate text-[11px] text-muted-foreground">
            {origCity} ({origCode}) → {destCity} ({destCode})
          </div>
        </div>
        <div className="text-right">
          {countdown.text ? (
            <div
              className={`font-mono text-sm tabular-nums ${COUNTDOWN_TONE[countdown.tone] ?? COUNTDOWN_TONE['']}`}
            >
              {countdown.text}
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
              <button
                type="button"
                onClick={() => onExplain(explainContext)}
                title="Click for AI analysis"
                className="rounded-md border px-1.5 py-0.5 text-[9px] font-semibold"
                style={{
                  backgroundColor: `${risk.color}20`,
                  color: risk.color,
                  borderColor: `${risk.color}66`,
                }}
              >
                {risk.label} RISK
              </button>
            ) : null}
            {showRisk && riskNA ? (
              <Badge
                variant="outline"
                className="text-[9px] font-semibold text-muted-foreground"
                title="Not enough live data to score this flight"
              >
                RISK N/A
              </Badge>
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
              {aircraft.t}{' '}
              <button
                type="button"
                className="text-[10px] underline decoration-dotted underline-offset-2 hover:text-primary"
                onClick={() => onAircraftDetail(reg)}
              >
                {reg}
              </button>
            </Cell>
            <Cell label="Config">
              <span className="text-xs">{seatConfigString(aircraft)}</span>
              {isStarlink ? (
                <Badge
                  variant="outline"
                  className="ml-1 border-emerald-500/40 bg-emerald-500/15 text-[9px] font-normal text-emerald-400"
                >
                  ⚡ Starlink Confirmed
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
              {td.aircraft}
              <StarlinkBadge flight={entry.flight} forecast />
            </dd>
            {/* Say honestly that we do not know the metal, rather than implying a lookup. */}
            {!reg ? (
              <p className="mt-0.5 text-[9px] text-muted-foreground">Tail not yet assigned</p>
            ) : null}
          </div>
        ) : null}

        {hasPayload && td?.source === 'schedule-cache' ? (
          // The three-tier fallback behind /api/flight-times is otherwise invisible: a
          // snapshot-sourced card would look exactly as authoritative as a live one.
          <p className="text-[10px] text-muted-foreground">via schedule snapshot</p>
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
              <h4 className="mb-1 text-[10px] font-medium uppercase tracking-wide text-primary">
                Where&rsquo;s My Plane?
              </h4>
              Your aircraft is currently operating <strong>{inbound.flightIATA}</strong> from{' '}
              {inbound.origin} → {origCode} at{' '}
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
            className="min-h-11 text-xs md:h-8 md:min-h-0"
            onClick={() => onViewOnMap(liveFlight)}
          >
            View on Map
          </Button>
        ) : null}
        {reg ? (
          <Button
            size="sm"
            variant="outline"
            className="min-h-11 text-xs md:h-8 md:min-h-0"
            onClick={() => onAircraftDetail(reg)}
          >
            Aircraft Details
          </Button>
        ) : null}
        {risk && explainContext ? (
          <Button
            size="sm"
            variant="outline"
            className="min-h-11 text-xs md:h-8 md:min-h-0"
            onClick={() => onExplain(explainContext)}
          >
            Explain Delay Risk
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto min-h-11 text-xs md:h-8 md:min-h-0"
          onClick={() => onUnwatch(entry.flight)}
        >
          Unwatch
        </Button>
      </div>
    </Card>
  );
}
