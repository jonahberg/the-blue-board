/**
 * Starlink — the rollout, in the order a reader actually asks about it (inventory §22).
 *
 *   Hero              how many are equipped, right now.
 *   Velocity + pace   how fast that number is moving, and when Express finishes at this rate.
 *   Industry          how that compares to everyone else.
 *   Departures board  which of them you could get on today.
 *   Roster            the database itself, down to one tail.
 *   Verification      what we are NOT sure about — and whether the pipeline is lying.
 *
 * The tab ends on the ledger deliberately. Every panel above it makes a claim; the ledger is
 * where the claims get audited, and burying it would be the dishonest layout.
 *
 * ── What this file owns ──────────────────────────────────────────────────────────────────
 * State and derivation only. Every number comes from a tested module in `src/lib`:
 * `bucketInstallsByMonth` / `computeInstallPace` / `buildDeparturesBoard` (starlink-utils),
 * `isRecentlyFound` / `getServedConflictTails` / `airborneByTail` / `boardCapPolicy` /
 * `formatFlightTime` (starlink-view), `buildVelocityChart` (starlink-chart) and the roster,
 * board-label and ledger helpers (starlink-roster).
 *
 * ── Why the clock is a prop ──────────────────────────────────────────────────────────────
 * `useFeed()` re-renders this subtree once a SECOND (its countdown ticks), while the data
 * under it changes once every thirty. So `now` comes from one 30 s ticker that only runs
 * while this tab is on screen, and every derivation is memoised against it — never against
 * `Date.now()` read during render, which would invalidate every memo on every tick and
 * reconcile a 400-row table sixty times a minute.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Card } from '@/components/ui/card';
import { HUB_ORDER } from '@/lib/hub-health.js';
import { HUB_TZ } from '@/lib/hubTz.js';
import { buildVelocityChart } from '@/lib/starlink-chart.js';
import {
  buildIndustryRows,
  filterRoster,
  freshnessAgo,
  ledgerHasData,
  rolloutBars,
  rosterOptions,
  sortRoster,
} from '@/lib/starlink-roster.js';
import { bucketInstallsByMonth, buildDeparturesBoard, computeInstallPace } from '@/lib/starlink-utils.js';
import {
  airborneByTail as buildAirborneByTail,
  boardCapPolicy,
  getServedConflictTails,
  isRecentlyFound,
} from '@/lib/starlink-view.js';
import { getTzAbbrev } from '@/lib/time-format.js';
import { fetchStarlinkMismatches } from '../data/api';
import type { Flight, StarlinkAircraft } from '../data/types';
import { useFeed } from '../state/feed';
import { useFleet } from '../state/fleet';
import { useNow } from '../state/hooks';
import { usePrefs } from '../state/prefs';
import { useUi } from '../state/ui';
import { DeparturesBoard, BOARD_UNAVAILABLE_NOTE } from './starlink/DeparturesBoard';
import type { WindowHours } from './starlink/DeparturesBoard';
import { IndustryStrip } from './starlink/IndustryStrip';
import type { IndustryRow } from './starlink/IndustryStrip';
import { RosterControls } from './starlink/RosterControls';
import { RosterTable } from './starlink/RosterTable';
import type { RosterSortCol } from './starlink/RosterTable';
import { SlHero } from './starlink/SlHero';
import type { RolloutBar } from './starlink/SlHero';
import { VelocityChart } from './starlink/VelocityChart';
import type { PaceModel, VelocityModel } from './starlink/VelocityChart';
import { VerificationLedger } from './starlink/VerificationLedger';
import type {
  BoardModel,
  BoardRow,
  DisputedClaim,
  FlightsByTail,
  VerifySummary,
} from './starlink/types';

const HUB_CODES: string[] = HUB_ORDER as string[];
const LEDGER_ID = 'sl-verification';
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** How often the board's clock advances. The feed polls at the same cadence. */
const TICK_MS = 30000;

type MismatchState = { disputed: DisputedClaim[]; summary: VerifySummary | null };

export default function StarlinkView() {
  const { starlink, fleetSummary } = useFleet();
  const feed = useFeed();
  const { homeAirport } = usePrefs();
  const { tab, setTab, select, focusOn, openAircraft, setStarlinkFilter } = useUi();

  const active = tab === 'starlink';
  // The ticker stops while the tab is off screen, so its value can be an hour old when the
  // visitor comes back. `resumedAt` refreshes the clock on the way in; both halves are stable
  // between renders, which is the point — `Date.now()` read during render would invalidate
  // every memo below on every one of the feed's per-second re-renders.
  const tick = useNow(TICK_MS, active);
  const [resumedAt, setResumedAt] = useState(() => Date.now());
  useEffect(() => {
    if (active) setResumedAt(Date.now());
  }, [active]);
  const nowMs = Math.max(tick, resumedAt);
  const nowSec = nowMs / 1000;

  const [boardHub, setBoardHub] = useState<string | null>(() =>
    HUB_CODES.includes(homeAirport) ? homeAirport : null,
  );
  const [boardWindow, setBoardWindow] = useState<WindowHours>(12);
  const [boardShowAll, setBoardShowAll] = useState(false);

  const [search, setSearch] = useState('');
  const [fleetFilter, setFleetFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [operatorFilter, setOperatorFilter] = useState('');
  const [newOnly, setNewOnly] = useState(false);
  const [sort, setSort] = useState<{ col: RosterSortCol; asc: boolean }>({ col: 'tail', asc: true });
  const [expanded, setExpanded] = useState<string | null>(null);

  const [mismatches, setMismatches] = useState<MismatchState>({ disputed: [], summary: null });

  const ledgerRef = useRef<HTMLDivElement>(null);

  const aircraft = starlink.aircraft;
  const flightsByTail = starlink.flightsByTail as FlightsByTail;

  // ── The verification ledger: one lazy, non-blocking fetch when the tab first opens ──────
  // The ledger changes on the hour, not on the poll, so it is fetched once. A failure or an
  // unrecognised shape RESETS the guard rather than latching an empty panel: the next tab
  // open tries again, which is how the shipped dashboard recovered from a cold upstream.
  const ledgerFetched = useRef(false);
  useEffect(() => {
    if (!active || ledgerFetched.current) return;
    ledgerFetched.current = true;
    let cancelled = false;
    fetchStarlinkMismatches().then(
      (data) => {
        if (cancelled) return;
        if (data && Array.isArray(data.disputed)) {
          setMismatches({
            disputed: data.disputed as DisputedClaim[],
            summary: (data.summary as VerifySummary) ?? null,
          });
        } else {
          setMismatches({ disputed: [], summary: null });
          ledgerFetched.current = false;
        }
      },
      () => {
        if (cancelled) return;
        setMismatches({ disputed: [], summary: null });
        ledgerFetched.current = false;
      },
    );
    return () => {
      cancelled = true;
    };
  }, [active]);

  // ── Live picture ───────────────────────────────────────────────────────────────────────
  // Keyed on the feed's array identity, which changes once per successful poll — NOT on the
  // per-second countdown that also re-renders this tree.
  const airborneByTail = useMemo(
    () => buildAirborneByTail(feed.flights, starlink.tails) as Record<string, Flight>,
    [feed.flights, starlink.tails],
  );
  const airborneCount = Object.keys(airborneByTail).length;
  const hasLive = feed.flights.length > 0;
  const hasFlights = Object.keys(flightsByTail).length > 0;

  /** Hub-local abbreviation for `formatFlightTime()`; non-hubs fall back inside that helper. */
  const tzAbbrev = useCallback(
    (hub: string) =>
      getTzAbbrev(
        new Date(nowMs),
        (HUB_TZ as Record<string, string>)[hub] ?? 'America/Chicago',
      ) as string,
    [nowMs],
  );

  // ── Hero ───────────────────────────────────────────────────────────────────────────────
  const equipped = starlink.stats ? starlink.stats.total : aircraft.length || null;
  const bars = useMemo(() => rolloutBars(starlink.stats) as RolloutBar[] | null, [starlink.stats]);
  const newTails = useMemo(() => {
    const set = new Set<string>();
    for (const a of aircraft) if (isRecentlyFound(a.dateFound, nowMs)) set.add(a.tail);
    return set;
  }, [aircraft, nowMs]);

  // ── Velocity chart + install pace ──────────────────────────────────────────────────────
  const chart = useMemo(() => {
    const { months, undated } = bucketInstallsByMonth(aircraft, new Date(nowMs));
    return buildVelocityChart(months, undated) as VelocityModel | null;
  }, [aircraft, nowMs]);

  const pace = useMemo<PaceModel>(() => {
    const stats = starlink.stats;
    // Express remaining only. Much of the mainline widebody fleet is ageing out and may never
    // be equipped, so counting it would produce a completion date nobody has committed to.
    const expressRemaining =
      stats && stats.expressTotal && stats.express != null
        ? Math.max(0, stats.expressTotal - stats.express)
        : null;
    const model = computeInstallPace(
      aircraft,
      new Date(nowMs),
      expressRemaining != null ? { remaining: expressRemaining } : {},
    ) as {
      pace: number;
      paceWeeks: number;
      dated: number;
      etaDate: Date | null;
    };
    // The static fallback roster carries no dateFound at all — the same guard the chart uses.
    if (model.dated === 0) return null;
    const paceStr =
      model.pace >= 10 ? String(Math.round(model.pace)) : String(Math.round(model.pace * 10) / 10);
    return {
      pace: model.pace > 0 ? `~${paceStr}` : '—',
      paceNote: model.paceWeeks > 0 ? `${model.paceWeeks}-wk trailing pace` : 'no complete weeks',
      eta: model.etaDate
        ? `~${MONTHS[model.etaDate.getUTCMonth()]} '${String(model.etaDate.getUTCFullYear()).slice(2)}`
        : '—',
      etaNote: model.etaDate
        ? 'Express · at current pace'
        : expressRemaining == null
          ? 'Express fleet n/a'
          : 'pace too low',
    };
  }, [aircraft, starlink.stats, nowMs]);

  // ── Industry strip ─────────────────────────────────────────────────────────────────────
  const industry = useMemo(
    () => buildIndustryRows(fleetSummary?.airlines ?? null) as IndustryRow[] | null,
    [fleetSummary],
  );

  // ── Departures board ───────────────────────────────────────────────────────────────────
  const aircraftByTail = useMemo(() => {
    const index: Record<string, StarlinkAircraft> = {};
    for (const a of aircraft) index[a.tail] = a;
    return index;
  }, [aircraft]);

  const board = useMemo(() => {
    if (!hasFlights || aircraft.length === 0) return null;
    const capPerHub = boardCapPolicy({
      showAll: boardShowAll,
      hub: boardHub,
      windowH: boardWindow,
    }) as number;
    return buildDeparturesBoard(flightsByTail, aircraftByTail, airborneByTail, HUB_CODES, {
      now: nowSec,
      windowSec: boardWindow * 3600,
      graceSec: 1800,
      hub: boardHub,
      capPerHub,
    }) as BoardModel;
  }, [
    hasFlights,
    aircraft.length,
    flightsByTail,
    aircraftByTail,
    airborneByTail,
    boardHub,
    boardWindow,
    boardShowAll,
    nowSec,
  ]);

  const boardFreshness = useMemo(() => {
    const ago = freshnessAgo(starlink.lastUpdated, nowMs) as string | null;
    return ago ? `updated ${ago}` : 'scheduled times';
  }, [starlink.lastUpdated, nowMs]);

  // ── Roster ─────────────────────────────────────────────────────────────────────────────
  const options = useMemo(
    () => rosterOptions(aircraft) as { types: string[]; operators: string[] },
    [aircraft],
  );

  const rows = useMemo(() => {
    const filtered = filterRoster(
      aircraft,
      { search, fleet: fleetFilter, type: typeFilter, operator: operatorFilter, newOnly },
      nowMs,
    ) as StarlinkAircraft[];
    return sortRoster(filtered, sort.col, sort.asc) as StarlinkAircraft[];
  }, [aircraft, search, fleetFilter, typeFilter, operatorFilter, newOnly, nowMs, sort]);

  // ── Verification ───────────────────────────────────────────────────────────────────────
  const conflicts = useMemo(
    () =>
      getServedConflictTails(
        mismatches.disputed,
        starlink.tails,
        starlink.syncedAt,
      ) as Set<string>,
    [mismatches.disputed, starlink.tails, starlink.syncedAt],
  );
  const showLedger = ledgerHasData(mismatches.disputed, mismatches.summary) as boolean;

  // ── Actions ────────────────────────────────────────────────────────────────────────────
  /**
   * Any filter or sort change collapses the open row — it would otherwise be orphaned.
   *
   * Five separate `useCallback`s rather than one closure factory: a factory returns a FRESH
   * function on every render, and this subtree renders once a second, so every memoised panel
   * below would see changed props and reconcile anyway. The point of `memo` here is that a
   * 573-row table and a 357-row board sit underneath.
   */
  const collapse = useCallback(() => setExpanded(null), []);
  const onSearch = useCallback((value: string) => {
    setSearch(value);
    setExpanded(null);
  }, []);
  const onFleet = useCallback((value: string) => {
    setFleetFilter(value);
    setExpanded(null);
  }, []);
  const onType = useCallback((value: string) => {
    setTypeFilter(value);
    setExpanded(null);
  }, []);
  const onOperator = useCallback((value: string) => {
    setOperatorFilter(value);
    setExpanded(null);
  }, []);
  const onNewOnly = useCallback((value: boolean) => {
    setNewOnly(value);
    setExpanded(null);
  }, []);

  const onSort = useCallback(
    (col: RosterSortCol) => {
      setSort((current) => (current.col === col ? { col, asc: !current.asc } : { col, asc: true }));
      collapse();
    },
    [collapse],
  );

  const toggleExpand = useCallback(
    (tail: string) => setExpanded((current) => (current === tail ? null : tail)),
    [],
  );

  const onBoardHub = useCallback((hub: string | null) => {
    setBoardHub(hub);
    // A new hub selection is a new scope, so the per-hub cap comes back with it.
    setBoardShowAll(false);
  }, []);

  const onBoardWindow = useCallback((hours: WindowHours) => {
    setBoardWindow(hours);
    setBoardShowAll(false);
  }, []);

  const onBoardShowAll = useCallback(() => setBoardShowAll(true), []);

  /** Track: select the aircraft, point the map at it, then switch to Live. */
  const trackByIcao = useCallback(
    (icao24: string) => {
      const flight = feed.flights.find((f) => f.icao24 === icao24);
      if (!flight) return;
      select({ kind: 'flight', flight });
      focusOn(flight.lat, flight.lon);
      setTab('live');
    },
    [feed.flights, select, focusOn, setTab],
  );

  const onBoardTrack = useCallback((row: BoardRow) => trackByIcao(row.icao24), [trackByIcao]);

  const onShowOnMap = useCallback(() => {
    setStarlinkFilter(true);
    setTab('live');
  }, [setStarlinkFilter, setTab]);

  const jumpToLedger = useCallback(() => {
    ledgerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const sourceUpdated = useMemo(() => {
    const ago = freshnessAgo(starlink.lastUpdated, nowMs) as string | null;
    return ago ? `Updated ${ago}` : 'live';
  }, [starlink.lastUpdated, nowMs]);

  const canFilterMap = starlink.tails.size > 0 && !starlink.degraded;

  return (
    <div className="space-y-4 p-3 md:p-4">
      <SlHero
        equipped={equipped}
        bars={bars}
        newThisWeek={newTails.size}
        airborneCount={airborneCount}
        canFilterMap={canFilterMap}
        verified={showLedger ? (mismatches.summary?.verifiedStarlink ?? null) : null}
        disputed={
          mismatches.summary?.disputed != null
            ? mismatches.summary.disputed
            : mismatches.disputed.length
        }
        onJumpToLedger={jumpToLedger}
        onShowOnMap={onShowOnMap}
      />

      {chart ? <VelocityChart model={chart} pace={pace} /> : null}

      {industry ? <IndustryStrip rows={industry} /> : null}

      {board ? (
        <DeparturesBoard
          board={board}
          hubCodes={HUB_CODES}
          hub={boardHub}
          onHub={onBoardHub}
          windowH={boardWindow}
          onWindow={onBoardWindow}
          onShowAll={onBoardShowAll}
          freshness={boardFreshness}
          tzAbbrev={tzAbbrev}
          onOpenAircraft={openAircraft}
          onTrack={onBoardTrack}
        />
      ) : (
        <p className="text-xs text-muted-foreground" id="sl-board-note">
          {BOARD_UNAVAILABLE_NOTE}
        </p>
      )}

      <section aria-labelledby="sl-roster-title" className="space-y-3">
        <h3 id="sl-roster-title" className="text-sm font-semibold">
          Starlink Roster
        </h3>
        <RosterControls
          search={search}
          onSearch={onSearch}
          fleet={fleetFilter}
          onFleet={onFleet}
          type={typeFilter}
          onType={onType}
          typeOptions={options.types}
          operator={operatorFilter}
          onOperator={onOperator}
          operatorOptions={options.operators}
          newOnly={newOnly}
          onNewOnly={onNewOnly}
          shown={rows.length}
          total={aircraft.length}
        />
        <RosterTable
          rows={rows}
          totalRows={aircraft.length}
          sort={sort}
          onSort={onSort}
          expanded={expanded}
          onToggleExpand={toggleExpand}
          airborneByTail={airborneByTail}
          conflictTails={conflicts}
          newTails={newTails}
          flightsByTail={flightsByTail}
          hasLive={hasLive}
          hasFlights={hasFlights}
          nowMs={nowMs}
          nowSec={nowSec}
          tzAbbrev={tzAbbrev}
          onTrack={trackByIcao}
          onOpenAircraft={openAircraft}
        />
      </section>

      <div ref={ledgerRef}>
        {showLedger ? (
          <VerificationLedger
            id={LEDGER_ID}
            disputed={mismatches.disputed}
            summary={mismatches.summary}
            conflicts={conflicts}
          />
        ) : null}
      </div>

      <Card className="gap-0 p-3">
        <p className="text-[11px] text-muted-foreground" id="sl-source">
          Starlink data via{' '}
          <a
            href="https://unitedstarlinktracker.com"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2 hover:text-foreground"
          >
            unitedstarlinktracker.com
          </a>{' '}
          · <span id="sl-updated">{sourceUpdated}</span> · <span id="sl-count">{aircraft.length}</span>{' '}
          aircraft
        </p>
      </Card>
    </div>
  );
}
