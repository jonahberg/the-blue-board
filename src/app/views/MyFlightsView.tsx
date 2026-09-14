/**
 * My Flights (inventory §19) — the watch list as a working itinerary.
 *
 * This view owns the STORES and the arithmetic that needs several of them at once; the
 * files under `myflight/` render what it decides, and every decision itself comes from
 * `src/lib`. Three cross-cutting rules shape the whole file:
 *
 *  1. The risk badge never defaults to LOW. With its own inputs it scores the flight;
 *     without them it reuses the Schedule board's score for the same flight; with
 *     neither it says "RISK N/A". A confident green badge derived from a dark feed,
 *     beside a board reading V.HIGH for that flight, is the failure this rule exists
 *     for (audit Jul 3 2026).
 *  2. The 1 s countdown runs only while this tab is the visible one. Views here are
 *     force-mounted and merely hidden, so "on mount" would mean a timer per tab for the
 *     life of the session.
 *  3. Nothing writes storage during a render. The shipped `buildMyFlightCard` backfilled
 *     `watched.route` inline; here the card model reports that a backfill is due and an
 *     effect performs it.
 *
 * The parallel preload the shipped `renderMyFlights()` did — weather, FAA and IROPS
 * before scoring — is now the providers' own eager load, so the risk model has real
 * inputs by the time anyone reaches this tab.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { cityFor } from '@/lib/airports.js';
import { findBoardRiskForFlight } from '@/lib/board-risk.js';
import {
  buildConnectionIndex,
  computeConnectionRisk,
  connectionContextStr,
  findWatchedConnections,
} from '@/lib/connection-pairing.js';
import { formatDelayExplainFAAStatus } from '@/lib/delay-explain-context.js';
import { HUB_COORDINATES, HUB_RISK_PROFILES, computeDelayRiskModel } from '@/lib/delay-risk.js';
import { resolveFlightStatus } from '@/lib/flight-status-resolve.js';
import { HUB_ORDER } from '@/lib/hub-health.js';
import { HUB_TZ } from '@/lib/hubTz.js';
import { buildJourneyContextStr, shapeJourney } from '@/lib/journey.js';
import { findInboundAircraft, findLiveFlight, resolveMyFlightRoute } from '@/lib/my-flights.js';
import type { Flight } from '../data/types';
import { useFeed } from '../state/feed';
import { useFleet } from '../state/fleet';
import { useIrops } from '../state/irops';
import { useHubHealth, useSchedule } from '../state/schedule';
import { useUi } from '../state/ui';
import { useWatch } from '../state/watch';
import { useWeather } from '../state/weather';
import { ConnectionCard, ManualConnectionCheck } from './myflight/ConnectionPanel';
import type { ConnectionPair, ConnectionRisk } from './myflight/ConnectionPanel';
import { FlightCard } from './myflight/FlightCard';
import type { MyFlightCardModel, RiskModel } from './myflight/FlightCard';
import { QuickAdd } from './myflight/QuickAdd';
import { useAircraftJourney } from './myflight/useAircraftJourney';
import { useFlightTimes } from './myflight/useFlightTimes';

const HUB_CODES = HUB_ORDER as string[];

export default function MyFlightsView() {
  const watch = useWatch();
  const { tab, select, focusOn, setTab, openAircraft, openDelayExplain, announce } = useUi();
  const { flights } = useFeed();
  const { fleetByReg, starlink } = useFleet();
  const { weatherOpsByHub, faaIndex, nas } = useWeather();
  const { hubRates } = useIrops();
  const { byHub: hubOtp } = useHubHealth();
  const { boards, nowSec } = useSchedule();

  const watched = watch.watched;
  const idents = useMemo(() => watched.map((entry) => entry.flight), [watched]);
  const { times } = useFlightTimes(idents);

  // ── The 1 s countdown, only while this tab is looked at (inventory §30) ──
  const active = tab === 'myflight';
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active || watched.length === 0) return undefined;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active, watched.length]);

  // ── Per-flight registration, and the journeys they key ──
  const regs = useMemo(
    () =>
      watched
        .map((entry) => {
          const td = times[entry.flight]?.data;
          const live = findLiveFlight(flights, entry.flight) as Flight | null;
          // F001: the live-feed tail first, then flight-times' `registration`.
          // `td.aircraft` is the TYPE string and is never a tail — deriving one from it
          // used to fail aircraft-history's own format check and kill the journey chain.
          return live?.reg?.replace('-', '') || (td?.registration || '').replace('-', '');
        })
        .filter(Boolean),
    [watched, times, flights],
  );
  const journeys = useAircraftJourney(regs);

  // ── Connections among the watch list, and the index the AI context reads ──
  const { connections, connRisks, connectionIndex } = useMemo(() => {
    const tds = watched.map((entry) => times[entry.flight]?.data ?? null);
    const found = findWatchedConnections(watched, tds, HUB_CODES) as unknown as ConnectionPair[];
    const risks = found.map((conn) => computeConnectionRisk(conn) as ConnectionRisk);
    return {
      connections: found,
      connRisks: risks,
      connectionIndex: buildConnectionIndex(found, risks) as Record<string, unknown>,
    };
  }, [watched, times]);

  // ── One model per card ──
  const cards = useMemo<MyFlightCardModel[]>(() => {
    return watched.map((entry) => {
      const record = times[entry.flight];
      const td = record?.data ?? null;
      const failures = record?.failures ?? 0;
      const { origCode, destCode } = resolveMyFlightRoute(entry.route, td) as {
        origCode: string;
        destCode: string;
      };
      const liveFlight = findLiveFlight(flights, entry.flight) as Flight | null;
      const resolvedStatus = td ? (resolveFlightStatus(td, liveFlight) as string) : '';
      const reg = liveFlight?.reg?.replace('-', '') || (td?.registration || '').replace('-', '');
      const ownFlightAirborne = Boolean(liveFlight && !liveFlight.onGround);
      const segments = reg ? (journeys[reg] ?? null) : null;

      // A journey summary is richer AI context than a bare "inbound is airborne" line,
      // so it wins when we have one.
      const journeyContext = reg && segments && segments.length > 0
        ? (buildJourneyContextStr(reg, shapeJourney(segments, entry.flight, origCode, destCode)) as string)
        : '';
      const inbound = findInboundAircraft(
        flights,
        reg,
        entry.flight,
        origCode,
        ownFlightAirborne,
      ) as Flight | null;
      const inboundStr =
        journeyContext ||
        (inbound
          ? `${inbound.flightIATA} from ${cityFor(inbound.origin) || inbound.origin} (${inbound.origin}), airborne`
          : '');

      // ── Risk, in the one order §19 allows ──
      const hasRiskInputs = Boolean(
        td &&
          td.success !== false &&
          (td.departure?.gate?.scheduled || td.departure?.gate?.estimated),
      );
      let risk: RiskModel | null = null;
      let riskNA = false;
      if (hasRiskInputs) {
        risk = computeDelayRiskModel({
          currentFlightNumber: entry.flight,
          nowMs: Date.now(),
          scheduledTime: td?.departure?.gate?.scheduled || td?.departure?.gate?.estimated || '',
          comparisonTime: td?.departure?.gate?.estimated || td?.departure?.gate?.actual || '',
          originHub: origCode,
          destinationHub: destCode,
          originFaa: faaIndex[origCode],
          destinationFaa: faaIndex[destCode],
          originWeather: weatherOpsByHub[origCode],
          destinationWeather: weatherOpsByHub[destCode],
          originOtp: hubOtp[origCode],
          timeZone: (HUB_TZ as Record<string, string>)[origCode] || 'America/Chicago',
          originCoordinates: (HUB_COORDINATES as Record<string, unknown>)[origCode],
          hubProfile: (HUB_RISK_PROFILES as Record<string, unknown>)[origCode],
          originIrops: hubRates[origCode],
          destinationIrops: hubRates[destCode],
          plannedTmis: nas?.planned || null,
        }) as unknown as RiskModel;
      } else {
        risk = findBoardRiskForFlight(entry.flight, boards, nowSec(), {
          faaIndex,
          weatherOpsByHub,
          hubOtp,
          iropsHubRates: hubRates,
          nas,
        }) as RiskModel | null;
        if (!risk) riskNA = true;
      }

      const connEntry = connectionIndex[entry.flight];
      // Mirrors the shipped `data-*` payload exactly (§19), so both callers of
      // `openDelayExplain` hand the dialog the same fields.
      const explainContext = risk
        ? {
            flight: entry.flight,
            route: `${origCode}→${destCode}`,
            status: resolvedStatus || 'scheduled',
            riskLabel: risk.label,
            riskScore: risk.score,
            factors: risk.factors,
            hub: origCode,
            otp: hubOtp[origCode],
            weather: weatherOpsByHub[origCode],
            destWeather: weatherOpsByHub[destCode],
            irops: hubRates[origCode],
            faaStatus: formatDelayExplainFAAStatus(origCode, destCode, faaIndex) as string,
            connection: connEntry ? (connectionContextStr(connEntry) as string) : '',
            inbound: inboundStr,
          }
        : null;

      return {
        entry,
        td,
        failures,
        origCode,
        destCode,
        origCity: cityFor(origCode) || origCode,
        destCity: cityFor(destCode) || destCode,
        resolvedStatus,
        reg,
        liveFlight,
        aircraft: reg ? fleetByReg[reg] : undefined,
        isStarlink: Boolean(reg) && starlink.tails.has(reg),
        inbound,
        journeySegments: segments,
        risk,
        riskNA,
        explainContext,
      };
    });
  }, [
    watched,
    times,
    flights,
    journeys,
    fleetByReg,
    starlink,
    faaIndex,
    weatherOpsByHub,
    hubOtp,
    hubRates,
    nas,
    boards,
    nowSec,
    connectionIndex,
  ]);

  // A route learned from the feed is written back to storage HERE, not during the render
  // that discovered it.
  useEffect(() => {
    for (const entry of watched) {
      const td = times[entry.flight]?.data;
      if (!td) continue;
      const { route, needsBackfill } = resolveMyFlightRoute(entry.route, td) as {
        route: string;
        needsBackfill: boolean;
      };
      if (needsBackfill) watch.updateRoute(entry.flight, route);
    }
  }, [watched, times, watch]);

  const onViewOnMap = useCallback(
    (flight: Flight) => {
      select({ kind: 'flight', flight });
      focusOn(flight.lat, flight.lon);
      setTab('live');
    },
    [select, focusOn, setTab],
  );

  const onAddFlight = useCallback(
    (flight: string) => {
      if (watch.isWatched(flight)) {
        announce(`${flight} is already on your watch list`);
        return;
      }
      watch.toggle(flight, '', '');
      announce(`👁️ Watching ${flight}`);
    },
    [watch, announce],
  );

  const onUnwatch = useCallback(
    (flight: string) => {
      watch.toggle(flight);
      announce(`✕ Removed ${flight} from watched flights`);
    },
    [watch, announce],
  );

  return (
    <div className="space-y-4 p-4 md:p-6">
      <QuickAdd
        showEmptyState={watched.length === 0}
        onAddFlight={onAddFlight}
        onOpenAircraft={openAircraft}
      />

      {cards.length > 0 ? (
        <>
          <div className="space-y-3">
            {cards.map((model) => (
              <FlightCard
                key={model.entry.flight}
                model={model}
                now={now}
                onViewOnMap={onViewOnMap}
                onAircraftDetail={openAircraft}
                onExplain={openDelayExplain}
                onUnwatch={onUnwatch}
              />
            ))}
          </div>

          {connections.length > 0 ? (
            <div className="space-y-2">
              {connections.map((conn, index) => (
                <ConnectionCard
                  key={`${conn.inbound.w.flight}-${conn.outbound.w.flight}`}
                  conn={conn}
                  risk={connRisks[index]}
                />
              ))}
            </div>
          ) : null}

          <Button
            size="sm"
            variant="ghost"
            className="min-h-11 text-xs md:min-h-0"
            onClick={() => {
              watch.clearAll();
              announce('Watch list cleared');
            }}
          >
            Clear all watched flights
          </Button>
        </>
      ) : null}

      <ManualConnectionCheck />
    </div>
  );
}
