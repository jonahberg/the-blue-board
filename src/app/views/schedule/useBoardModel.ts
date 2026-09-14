/**
 * One board, from raw provider rows to the exact things the table paints.
 *
 * The whole pipeline is a single memo chain so that ONE server-anchored "now" drives the
 * filter, the sort, every row badge and the stat strip. The shipped dashboard called
 * `schedNow()` per classify — per row and per sort comparison — which could straddle a
 * one-second tick and disagree with itself inside a single frame.
 *
 * Two caches do real work here rather than being micro-optimisation. `matchesScheduleFilters`
 * calls `ctx.classify` up to three times per row and `ctx.computeRisk` once, and the risk
 * model is a few hundred lines of signal collection; on a 700-row ORD board that is the
 * difference between a filter change being instant and being visibly laggy.
 *
 * The live-feed overlay is applied INSIDE this chain (inventory §20): every consumer — the
 * visible rows, the stat counts, the filters — funnels through here, so what the viewer sees
 * and what the strip counts are reconciled by construction. The RAW rows stay un-overlaid in
 * the store, because hub health, IROPS and swap detection must read provider truth.
 */

import { useMemo } from 'react';

import { INTL_AIRPORTS } from '@/lib/airport-metadata.js';
import { computeScheduleStatCounts } from '@/lib/board-stats.js';
import { effectiveRowTime, firstFutureIndex, nowDividerIndex } from '@/lib/board-now.js';
import { formatDelayMinutes } from '@/lib/delay-format.js';
import { getScheduleRiskContext } from '@/lib/delay-explain-context.js';
import { HUB_COORDINATES, HUB_RISK_PROFILES, computeDelayRiskModel } from '@/lib/delay-risk.js';
import { ICAO_TO_FLEET_TYPE, getTypicalFleetStats } from '@/lib/equipment-swaps.js';
import { getFAADelayContext } from '@/lib/faa-context.js';
import { normalizeWifi } from '@/lib/fleet-utils.js';
import { getUnitedTerminal } from '@/lib/hub-terminals.js';
import { HUB_TZ } from '@/lib/hubTz.js';
import { applySightingsToBoard } from '@/lib/reg-overlay.js';
import { normalizeFlightNum } from '@/lib/reg-ledger.js';
import { matchesScheduleFilters } from '@/lib/schedule-board-filters.js';
import { getScheduleFleetFamily } from '@/lib/schedule-filters.js';
import { classifySchedStatus } from '@/lib/schedule-status.js';
import { displayScheduleStatus } from '@/lib/status-display.js';
import { analyzeSwapImpact } from '@/lib/swap-impact.js';
import type { EquipmentSwap } from '../../state/schedule';
import type { FaaIndex, FleetAircraft, Flight, NasData } from '../../data/types';
import type { WeatherOps } from '../../state/weather';
import type { IropsHubRate } from '../../state/irops';

export type ScheduleRow = Record<string, unknown>;

export type SortColumn = 'time' | 'flight' | 'route' | 'aircraft' | 'reg' | 'status';

export type BoardFilters = {
  status: string;
  aircraft: string;
  fleetFamily: string;
  routeType: string;
  starlink: string;
  timeRange: string;
  risk: string;
  search: string;
};

export const EMPTY_FILTERS: BoardFilters = {
  status: '',
  aircraft: '',
  fleetFamily: '',
  routeType: '',
  starlink: '',
  timeRange: '',
  risk: '',
  search: '',
};

/** The delay-risk model's public shape, as `computeDelayRiskModel()` returns it. */
export type RiskModel = {
  score: number;
  label: string;
  color: string;
  /** Human-readable factor sentences, in the order the model scored them. */
  factors: string[];
  components: { points: number }[];
};

export type StatusModel = {
  key: string;
  cls: string;
  text: string;
  presumed: boolean;
  asOf: boolean;
  live: boolean;
};

export type SwapModel = {
  oldType: string;
  newType: string;
  reg: string;
  impacts: { text: string; cls: string }[];
  tone: 'downgrade' | 'upgrade' | 'lateral';
};

export type DelayCell =
  | { kind: 'none' }
  | { kind: 'delta'; text: string; minutes: number; title: string }
  | { kind: 'risk'; risk: RiskModel; context: Record<string, unknown> };

export type RowModel = {
  ident: string;
  key: string;
  raw: ScheduleRow;
  timeText: string;
  /** A row carried over from a previous hub-local date — "06:52" must not read as today's. */
  dateChip: string | null;
  actualLine: { text: string; early: boolean } | null;
  /** The provider had no scheduled time and the board derived one from the actual. */
  derivedActual: boolean;
  routeLine: string;
  routeSub: string | null;
  acCode: string;
  acText: string;
  acShort: string;
  reg: string;
  /** The tail came from live tracking, not the schedule feed — the row says so. */
  regFromLive: boolean;
  gate: string;
  status: StatusModel;
  fleet: { badge: string; starlink: boolean; enrich: string } | null;
  swap: SwapModel | null;
  special: string | null;
  faaContext: string | null;
  delay: DelayCell;
  watchRoute: string;
  effectiveTime: number;
};

export type BoardModel = {
  rows: RowModel[];
  /** Index the NOW divider is spliced in at, or -1 when it does not belong on this board. */
  dividerIndex: number;
  dividerLabel: string;
  /** Index of the first future row — what "Jump to now" targets when there is no divider. */
  firstFutureIndex: number;
  stats: {
    total: number;
    operated: number;
    otp: number | null;
    onTime: number;
    late: number;
    canceled: number;
    canceledUncertain: number;
    upcoming: number;
    presumed: number;
    uncategorized: number;
  };
  hubTz: string;
  tzAbbrev: string;
  nowSec: number;
};

export type BoardModelInput = {
  rows: ScheduleRow[];
  hub: string;
  dir: 'departures' | 'arrivals';
  day: number;
  dayStartSec: number;
  nowSec: number;
  meta: { hubDisruptionMinutes?: number } | null;
  filters: BoardFilters;
  sort: { column: SortColumn; asc: boolean };
  swaps: EquipmentSwap[];
  liveFlights: Flight[];
  liveFeedTs: number | null;
  lookupReg: (flight: string, depSec?: number, arrSec?: number) => string | null;
  fleetDb: FleetAircraft[];
  fleetByReg: Record<string, FleetAircraft>;
  starlinkTails: Set<string>;
  special: Map<string, { name: string }>;
  faaIndex: FaaIndex;
  weatherOpsByHub: Record<string, WeatherOps>;
  nas: NasData | null;
  hubOtp: Record<string, number>;
  iropsHubRates: Record<string, IropsHubRate>;
};

/** Hub-local `HH:MM`, 24-hour — the board's one time format. */
export function formatSchedTime(seconds: number | undefined | null, timeZone: string): string {
  if (!seconds) return '—';
  try {
    return new Date(seconds * 1000).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone,
    });
  } catch {
    return '—';
  }
}

type FlightShape = {
  identification?: { number?: { default?: string }; callsign?: string };
  aircraft?: { model?: { code?: string; text?: string }; registration?: string; regSource?: string };
  airport?: {
    origin?: { code?: { iata?: string }; name?: string; info?: { terminal?: string; gate?: string } };
    destination?: {
      code?: { iata?: string };
      name?: string;
      info?: { terminal?: string; gate?: string };
    };
  };
  time?: {
    scheduled?: { departure?: number; arrival?: number };
    real?: { departure?: number; arrival?: number };
    estimated?: { departure?: number; arrival?: number };
  };
  _source?: { scheduleTimeDerivedFromActual?: { departure?: unknown; arrival?: unknown } };
};

function shortAirportName(airport: { name?: string } | undefined): string {
  if (!airport?.name) return '';
  return airport.name.replace(/ Airport| International/g, '').substring(0, 30);
}

export function useBoardModel(input: BoardModelInput): BoardModel {
  const {
    rows,
    hub,
    dir,
    day,
    dayStartSec,
    nowSec,
    meta,
    filters,
    sort,
    swaps,
    liveFlights,
    liveFeedTs,
    lookupReg,
    fleetDb,
    fleetByReg,
    starlinkTails,
    special,
    faaIndex,
    weatherOpsByHub,
    nas,
    hubOtp,
    iropsHubRates,
  } = input;

  const hubTz = (HUB_TZ as Record<string, string>)[hub] || 'America/Chicago';

  return useMemo(() => {
    const classifyOpts = {
      hubDisruptionMinutes:
        Number.isFinite(Number(meta?.hubDisruptionMinutes)) && Number(meta?.hubDisruptionMinutes) > 0
          ? Number(meta?.hubDisruptionMinutes)
          : 0,
    };

    // The board's rows are re-applied against the browser's OWN live feed. A clean board can
    // sit on the CDN for hours, so the server's live flags are usually past the status
    // engine's recency gate by the time they reach this tab — but the feed here is 30 s old.
    let boardRows = rows;
    if (rows.length && liveFlights.length && liveFeedTs) {
      const sightings = new Map<string, { reg: string; origin: string; dest: string; seenAtMs: number }>();
      for (const flight of liveFlights) {
        if (!flight?.reg) continue;
        const key =
          (normalizeFlightNum(flight.flightIATA) as string) ||
          (normalizeFlightNum(flight.callsign) as string);
        if (!key) continue;
        sightings.set(key, {
          reg: flight.reg,
          origin: flight.origin || '',
          dest: flight.dest || '',
          seenAtMs: liveFeedTs,
        });
      }
      if (sightings.size) {
        const out = applySightingsToBoard({ flights: rows }, sightings, Date.now()) as {
          flights: ScheduleRow[];
        };
        boardRows = out.flights;
      }
    }

    const statusCache = new Map<ScheduleRow, StatusModel>();
    const classify = (row: ScheduleRow): StatusModel => {
      const hit = statusCache.get(row);
      if (hit) return hit;
      const computed = classifySchedStatus(row, dir, nowSec, classifyOpts) as StatusModel;
      statusCache.set(row, computed);
      return computed;
    };

    const regCache = new Map<ScheduleRow, string>();
    const regFor = (row: ScheduleRow): string => {
      const hit = regCache.get(row);
      if (hit !== undefined) return hit;
      const flight = row as FlightShape;
      const provider = flight.aircraft?.registration || '';
      const value =
        provider ||
        lookupReg(
          flight.identification?.number?.default || '',
          flight.time?.scheduled?.departure,
          flight.time?.scheduled?.arrival,
        ) ||
        '';
      regCache.set(row, value);
      return value;
    };

    const riskCache = new Map<ScheduleRow, RiskModel | null>();
    const computeRisk = (row: ScheduleRow): RiskModel | null => {
      if (riskCache.has(row)) return riskCache.get(row) ?? null;
      const flight = row as FlightShape;
      const status = classify(row);
      // Only not-yet-departed rows get a prediction: a flight that has operated has facts.
      if (status.key !== 'scheduled' && status.key !== 'estimated' && status.key !== 'delayed') {
        riskCache.set(row, null);
        return null;
      }
      const { depHub, arrHub } = getScheduleRiskContext(row, hub, dir) as {
        depHub: string;
        arrHub: string;
      };
      const schedTime = flight.time?.scheduled?.departure || flight.time?.scheduled?.arrival;
      const estTime = flight.time?.estimated?.departure || flight.time?.estimated?.arrival;
      const actTime = flight.time?.real?.departure || flight.time?.real?.arrival;
      const result = computeDelayRiskModel({
        currentFlightNumber: flight.identification?.number?.default || '',
        nowMs: Date.now(),
        scheduledTime: schedTime || '',
        comparisonTime: actTime || estTime || '',
        originHub: depHub,
        destinationHub: arrHub,
        originFaa: faaIndex[depHub],
        destinationFaa: faaIndex[arrHub],
        originWeather: weatherOpsByHub[depHub],
        destinationWeather: weatherOpsByHub[arrHub],
        originOtp: hubOtp[depHub],
        timeZone: (HUB_TZ as Record<string, string>)[depHub] || 'America/Chicago',
        originCoordinates: (HUB_COORDINATES as Record<string, unknown>)[depHub],
        hubProfile: (HUB_RISK_PROFILES as Record<string, unknown>)[depHub],
        originIrops: iropsHubRates[depHub],
        destinationIrops: iropsHubRates[arrHub],
        plannedTmis: nas?.planned || null,
      }) as unknown as RiskModel;
      const value = result.score === 0 ? null : result;
      riskCache.set(row, value);
      return value;
    };

    const filtered = boardRows.filter((row) =>
      matchesScheduleFilters(
        row,
        {
          statusFilter: filters.status,
          aircraftFilter: filters.aircraft,
          fleetFamilyFilter: filters.fleetFamily,
          routeTypeFilter: filters.routeType,
          starlinkFilter: filters.starlink,
          timeRangeFilter: filters.timeRange,
          riskFilter: filters.risk,
          searchFilter: filters.search.toLowerCase().trim(),
        },
        {
          dir,
          hubTz,
          intlAirports: INTL_AIRPORTS,
          starlinkTails,
          classify,
          fleetFamily: getScheduleFleetFamily,
          regFor,
          computeRisk,
        },
      ),
    );

    const direction = sort.asc ? 1 : -1;
    const isDep = dir === 'departures';
    const sorted = [...filtered].sort((a, b) => {
      const fa = a as FlightShape;
      const fb = b as FlightShape;
      switch (sort.column) {
        case 'time': {
          const ta = (isDep ? fa.time?.scheduled?.departure : fa.time?.scheduled?.arrival) || 0;
          const tb = (isDep ? fb.time?.scheduled?.departure : fb.time?.scheduled?.arrival) || 0;
          return (ta - tb) * direction;
        }
        case 'flight':
          return (
            (fa.identification?.number?.default || '').localeCompare(
              fb.identification?.number?.default || '',
            ) * direction
          );
        case 'route': {
          const ra = isDep
            ? fa.airport?.destination?.code?.iata || ''
            : fa.airport?.origin?.code?.iata || '';
          const rb = isDep
            ? fb.airport?.destination?.code?.iata || ''
            : fb.airport?.origin?.code?.iata || '';
          return ra.localeCompare(rb) * direction;
        }
        case 'aircraft':
          return (
            (fa.aircraft?.model?.code || '').localeCompare(fb.aircraft?.model?.code || '') * direction
          );
        case 'reg':
          return regFor(a).localeCompare(regFor(b)) * direction;
        case 'status':
          return classify(a).key.localeCompare(classify(b).key) * direction;
        default:
          return 0;
      }
    });

    const swapByFlight = new Map(swaps.map((swap) => [swap.flight, swap]));
    const impactDeps = {
      getTypicalFleetStats: (code: string) => getTypicalFleetStats(code, fleetDb, starlinkTails),
      fleetByReg,
      starlinkTails,
    };

    const models: RowModel[] = sorted.map((row, index) => {
      const flight = row as FlightShape;
      const ident = flight.identification?.number?.default || '—';
      const schedTime = isDep ? flight.time?.scheduled?.departure : flight.time?.scheduled?.arrival;
      const actualTime = isDep
        ? flight.time?.real?.departure || flight.time?.estimated?.departure
        : flight.time?.real?.arrival || flight.time?.estimated?.arrival;
      const derivedActual = Boolean(
        isDep
          ? flight._source?.scheduleTimeDerivedFromActual?.departure
          : flight._source?.scheduleTimeDerivedFromActual?.arrival,
      );

      let dateChip: string | null = null;
      if (schedTime && dayStartSec && schedTime < dayStartSec) {
        try {
          dateChip = new Date(schedTime * 1000).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            timeZone: hubTz,
          });
        } catch {
          dateChip = null;
        }
      }

      let actualLine: RowModel['actualLine'] = null;
      if (!derivedActual && actualTime && schedTime && actualTime !== schedTime) {
        const diff = Math.round((actualTime - schedTime) / 60);
        if (diff > 5) {
          actualLine = { text: `→ ${formatSchedTime(actualTime, hubTz)} (+${diff}m)`, early: false };
        } else if (diff < -5) {
          actualLine = { text: `→ ${formatSchedTime(actualTime, hubTz)} (${diff}m)`, early: true };
        }
      }

      const origin = flight.airport?.origin;
      const destination = flight.airport?.destination;
      // Some provider rows carry a city name but no IATA code, which rendered as a bare
      // "ORD → ?" with the city stranded underneath. Promote the name rather than show a
      // question mark.
      const endpoint = isDep ? destination : origin;
      const code = endpoint?.code?.iata;
      const name = shortAirportName(endpoint);
      const primary = code || name || '—';
      const routeLine = isDep ? `${hub} → ${primary}` : `${primary} → ${hub}`;
      const routeSub = code && name ? name : null;

      const acCode = flight.aircraft?.model?.code || '—';
      const acText = flight.aircraft?.model?.text || '';
      const acShort = acText ? acText.replace(/Boeing |Airbus |Embraer /g, '').substring(0, 20) : '';

      const reg = regFor(row);
      // A server-merged tail arrives IN `aircraft.registration` tagged `regSource:'live_feed'`;
      // a client-ledger fill leaves that field empty. Both earn the honesty tooltip.
      const regFromLive = Boolean(
        reg && (!flight.aircraft?.registration || flight.aircraft?.regSource === 'live_feed'),
      );

      const oIata = origin?.code?.iata || '';
      const dIata = destination?.code?.iata || '';
      const endpointInfo = isDep ? origin : destination;
      const terminal =
        endpointInfo?.info?.terminal ||
        (getUnitedTerminal(isDep ? oIata : dIata, oIata, dIata) as string | undefined);
      const gateValue = endpointInfo?.info?.gate;
      const gate =
        terminal && gateValue
          ? `T${terminal} · ${gateValue}`
          : terminal
            ? `T${terminal}`
            : gateValue
              ? `Gate ${gateValue}`
              : '—';

      const rawStatus = classify(row);
      const status = displayScheduleStatus(rawStatus) as StatusModel;
      status.key = rawStatus.key;

      let fleet: RowModel['fleet'] = null;
      if (reg) {
        const regClean = reg.replace('-', '');
        const match = fleetByReg[regClean] || fleetByReg[reg];
        if (match) {
          const isStarlink = starlinkTails.has(regClean) || starlinkTails.has(reg);
          const parts: string[] = [];
          if (match.seats && typeof match.seats === 'object') {
            parts.push(
              Object.entries(match.seats)
                .map(([cabin, count]) => `${count}${cabin}`)
                .join('/'),
            );
          }
          if (match.w) parts.push(normalizeWifi(match.w) as string);
          if (isStarlink) parts.push('⚡ Starlink');
          if (match.i) parts.push(match.i);
          if (match.d) parts.push(`Del ${match.d}`);
          fleet = {
            badge: String(match.c || match.t),
            starlink: isStarlink,
            enrich: parts.join(' · '),
          };
        }
      }

      let swap: SwapModel | null = null;
      const change = swapByFlight.get(ident);
      if (change) {
        const impacts = analyzeSwapImpact(change.oldAc, change.newAc, reg, impactDeps) as {
          text: string;
          cls: string;
        }[];
        swap = {
          oldType: (ICAO_TO_FLEET_TYPE as Record<string, string>)[change.oldAc] || change.oldAc,
          newType: (ICAO_TO_FLEET_TYPE as Record<string, string>)[change.newAc] || change.newAc,
          reg,
          impacts,
          tone: impacts.some((i) => i.cls === 'downgrade')
            ? 'downgrade'
            : impacts.some((i) => i.cls === 'upgrade')
              ? 'upgrade'
              : 'lateral',
        };
      }

      const specialEntry = reg ? (special.get(reg.replace('-', '')) ?? special.get(reg)) : undefined;

      let faaContext: string | null = null;
      if (status.cls === 'delayed') {
        faaContext =
        (getFAADelayContext(faaIndex as Record<string, object>, oIata, dIata) as string) || null;
      }

      // DELAY / RISK — facts beat predictions. A row with a known delta shows the REAL
      // delay; only a future row without one shows a prediction, worded "RISK: …" so it can
      // never read as a fact. (A flight with a known +140m delay once displayed "V.HIGH".)
      const isTerminal =
        status.key === 'canceled' || status.key === 'canceled_uncertain' || status.key === 'diverted';
      const hasOperated =
        status.key === 'departed' || status.key === 'enroute' || status.key === 'landed';
      const deltaMin =
        actualTime && schedTime ? Math.round((actualTime - schedTime) / 60) : null;
      let delay: DelayCell = { kind: 'none' };
      if (isTerminal) {
        delay = { kind: 'none' };
      } else if (deltaMin !== null && ((hasOperated && !status.presumed) || deltaMin > 5)) {
        const source =
          flight.time?.real?.departure || flight.time?.real?.arrival ? 'Actual' : 'Estimated';
        delay = {
          kind: 'delta',
          minutes: deltaMin,
          text: formatDelayMinutes(deltaMin) as string,
          title: `${source} vs scheduled ${isDep ? 'departure' : 'arrival'}`,
        };
      } else {
        const risk = computeRisk(row);
        if (risk) {
          const { origCode, destCode, depHub, arrHub } = getScheduleRiskContext(row, hub, dir) as {
            origCode: string;
            destCode: string;
            depHub: string;
            arrHub: string;
          };
          delay = {
            kind: 'risk',
            risk,
            // Mirrors the shipped `data-*` payload the delay-explain dialog reads.
            context: {
              flight: ident,
              route: `${origCode}→${destCode}`,
              status: status.text,
              riskLabel: risk.label,
              riskScore: risk.score,
              riskFactors: risk.factors,
              hub: depHub,
              otp: hubOtp[depHub],
              weather: weatherOpsByHub[depHub],
              destWeather: weatherOpsByHub[arrHub],
              irops: iropsHubRates[depHub],
            },
          };
        }
      }

      const { origCode, destCode } = getScheduleRiskContext(row, hub, dir) as {
        origCode: string;
        destCode: string;
      };

      return {
        ident,
        key: `${ident}-${schedTime ?? index}`,
        raw: row,
        timeText: formatSchedTime(schedTime, hubTz),
        dateChip,
        actualLine,
        derivedActual,
        routeLine,
        routeSub,
        acCode,
        acText,
        acShort,
        reg,
        regFromLive,
        gate,
        status,
        fleet,
        swap,
        special: specialEntry?.name ?? null,
        faaContext,
        delay,
        watchRoute: `${origCode}→${destCode}`,
        effectiveTime: effectiveRowTime({
          scheduled: isDep ? flight.time?.scheduled?.departure : flight.time?.scheduled?.arrival,
          real: isDep ? flight.time?.real?.departure : flight.time?.real?.arrival,
          estimated: isDep ? flight.time?.estimated?.departure : flight.time?.estimated?.arrival,
        }) as number,
      };
    });

    // The NOW divider belongs on today's board under the default time-ascending sort only —
    // it is meaningless halfway down a list sorted by flight number.
    let dividerIndex = -1;
    let futureIndex = -1;
    let dividerLabel = '';
    if (day === 0 && sort.column === 'time' && sort.asc) {
      const times = models.map((model) => model.effectiveTime);
      futureIndex = firstFutureIndex(times, nowSec) as number;
      dividerIndex = nowDividerIndex(times, nowSec) as number;
      if (dividerIndex >= 0) {
        let abbrev = '';
        try {
          abbrev =
            new Date().toLocaleTimeString('en-US', { timeZone: hubTz, timeZoneName: 'short' }).split(' ').pop() ||
            '';
        } catch {
          abbrev = '';
        }
        dividerLabel = `${formatSchedTime(nowSec, hubTz)} ${abbrev}`.trim();
      }
    }

    const counts = computeScheduleStatCounts(filtered, {
      dir,
      nowSec,
      classify: (flight: object) => classify(flight as ScheduleRow),
    }) as BoardModel['stats'];

    let tzAbbrev = '';
    try {
      tzAbbrev =
        new Date().toLocaleTimeString('en-US', { timeZone: hubTz, timeZoneName: 'short' }).split(' ').pop() || '';
    } catch {
      tzAbbrev = '';
    }

    return {
      rows: models,
      dividerIndex,
      dividerLabel,
      firstFutureIndex: futureIndex,
      stats: counts,
      hubTz,
      tzAbbrev,
      nowSec,
    };
  }, [
    rows,
    hub,
    dir,
    day,
    dayStartSec,
    nowSec,
    meta,
    filters,
    sort,
    swaps,
    liveFlights,
    liveFeedTs,
    lookupReg,
    fleetDb,
    fleetByReg,
    starlinkTails,
    special,
    faaIndex,
    weatherOpsByHub,
    nas,
    hubOtp,
    iropsHubRates,
    hubTz,
  ]);
}

/** Every aircraft type present on the board, for the Aircraft select. */
export function aircraftOptions(rows: ScheduleRow[]): { code: string; label: string }[] {
  const types: Record<string, string> = {};
  for (const row of rows) {
    const model = (row as FlightShape).aircraft?.model;
    if (model?.code) types[model.code] = model.text || model.code;
  }
  return Object.entries(types)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([code, label]) => ({ code, label: `${code} — ${label}` }));
}
