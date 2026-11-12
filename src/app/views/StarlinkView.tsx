/**
 * Starlink — the rollout, in the order a reader actually asks about it (inventory §22).
 *
 *   Hero              how many are equipped, right now.
 *   Velocity + pace   how fast that number is moving, beside United's own stated target.
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
 * `UNITED_STARLINK_TARGET` (starlink-facts), `expressStarlinkScope` (starlink-roster),
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
import { matchAircraft } from '@/lib/fleet-match.js';
import { starlinkMainlineShare } from '@/lib/fleet-utils.js';
import { HUB_ORDER } from '@/lib/hub-health.js';
import { HUB_TZ } from '@/lib/hubTz.js';
import { scrollBehavior } from '@/lib/motion.js';
import { buildVelocityChart } from '@/lib/starlink-chart.js';
import {
  buildIndustryRows,
  expressStarlinkScope,
  filterRoster,
  latestScheduledDepartureTs,
  ledgerHasData,
  rolloutBars,
  rolloutBarsNote,
  rosterFiltersShowing,
  rosterOptions,
  sortRoster,
  starlinkBoardEmptyText,
  starlinkBoardFooter,
  starlinkScheduleFreshness,
  starlinkSourceFreshness,
} from '@/lib/starlink-roster.js';
import { UNITED_STARLINK_TARGET } from '@/lib/starlink-facts.js';
import {
  bucketInstallsByMonth,
  buildDeparturesBoard,
  computeInstallPace,
} from '@/lib/starlink-utils.js';
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
import { makeIsStarlinkFlight } from './live/starlink-match';
import { IndustryStrip } from './starlink/IndustryStrip';
import type { IndustryRow } from './starlink/IndustryStrip';
import { RosterControls } from './starlink/RosterControls';
import { useAskStarlink } from './starlink/useAskStarlink';
import { AskChips } from '../features/AskChips';
import { RosterTable } from './starlink/RosterTable';
import type { RosterSortCol } from './starlink/RosterTable';
import { SlHero } from './starlink/SlHero';
import type { RolloutBar, RosterFleet } from './starlink/SlHero';
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

/** How often the board's clock advances. The feed polls at the same cadence. */
const TICK_MS = 30000;

type MismatchState = { disputed: DisputedClaim[]; summary: VerifySummary | null };

export default function StarlinkView() {
  const { starlink, fleetSummary, fleetDb, fleetByReg, loadStarlinkFlights } = useFleet();
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
  const rosterRef = useRef<HTMLElement>(null);

  const aircraft = starlink.aircraft;
  const flightsByTail = starlink.flightsByTail as FlightsByTail;

  // ── The verification ledger: one lazy, non-blocking fetch when the tab first opens ──────
  // The ledger changes on the hour, not on the poll, so it is fetched once. A failure or an
  // unrecognised shape leaves the guard CLEAR rather than latching an empty panel: the next
  // tab open tries again, which is how the shipped dashboard recovered from a cold upstream.
  //
  // Two refs, not one, and the difference is the whole point. `ledgerDone` means "we have the
  // data" and is set ONLY on success; `ledgerPending` means "a request is in flight" and is
  // what stops a second one while the visitor flicks between tabs. Setting a single
  // fetched-once flag before the request and bailing out of the handlers when the tab had
  // changed left the flag `true` with nothing behind it — the ledger was then never fetched
  // again for the life of the page, and it is the one panel on this tab that audits all the
  // others.
  //
  // A result that lands while the tab is off screen is ACCEPTED rather than discarded: views
  // stay mounted after their first visit (`Dashboard.tsx` renders every visited tab with
  // `forceMount`), so there is nothing to throw it away for — the panel is simply ready when
  // the visitor comes back.
  const ledgerDone = useRef(false);
  const ledgerPending = useRef(false);
  useEffect(() => {
    if (!active || ledgerDone.current || ledgerPending.current) return;
    ledgerPending.current = true;
    void fetchStarlinkMismatches().then(
      (data) => {
        ledgerPending.current = false;
        if (data && Array.isArray(data.disputed)) {
          ledgerDone.current = true;
          setMismatches({
            disputed: data.disputed as DisputedClaim[],
            summary: (data.summary as VerifySummary) ?? null,
          });
        } else {
          setMismatches({ disputed: [], summary: null });
        }
      },
      () => {
        ledgerPending.current = false;
        setMismatches({ disputed: [], summary: null });
      },
    );
  }, [active]);

  // ── Per-tail schedules: fetched the first time the tab opens, not at dashboard boot (F58) ──
  useEffect(() => {
    if (active && !starlink.degraded) loadStarlinkFlights();
  }, [active, starlink.degraded, loadStarlinkFlights]);
  const flightsLoading =
    !starlink.degraded && (starlink.flightsStatus === 'idle' || starlink.flightsStatus === 'loading');

  // ── Live picture ───────────────────────────────────────────────────────────────────────
  // Keyed on the feed's array identity, which changes once per successful poll — NOT on the
  // per-second countdown that also re-renders this tree.
  // The same Starlink predicate as the map and the stat bar (F101), keyed by the fleet-matched
  // registration so a row with no reg but a known ICAO24 still counts.
  const airborneByTail = useMemo(
    () =>
      buildAirborneByTail(
        feed.flights,
        makeIsStarlinkFlight(starlink.tails, fleetByReg),
        (f: Flight) => (matchAircraft(f, fleetByReg) as { r?: string } | null)?.r,
      ) as Record<string, Flight>,
    [feed.flights, starlink.tails, fleetByReg],
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
  // The Mainline bar is the Fleet tab's figure, from the same function and the same inputs:
  // the fleet database's mainline total, never the tracker's own (stale) census.
  const mainlineShare = useMemo(
    () =>
      starlinkMainlineShare(starlink.stats, fleetDb, starlink.tails) as {
        count: number;
        total: number;
        pct: number;
        source?: string;
      } | null,
    [starlink.stats, fleetDb, starlink.tails],
  );
  // The Express bar is the two-cabin regional fleet, both numbers from ONE fleet-summary snapshot
  // (the payload the industry strip reads). Null while that endpoint is down: the row then shows
  // the tracker's equipped count with no bar, never a share of the tracker's own Express total.
  const expressScope = useMemo(
    () =>
      expressStarlinkScope(fleetSummary?.airlines ?? null) as {
        installed: number;
        total: number;
        pct: number;
        leftOut: number;
        leftOutFamilies: string[];
      } | null,
    [fleetSummary],
  );
  const bars = useMemo(
    () => rolloutBars(starlink.stats, mainlineShare, expressScope) as RolloutBar[] | null,
    [starlink.stats, mainlineShare, expressScope],
  );
  const barsNote = useMemo(
    () => rolloutBarsNote(mainlineShare, expressScope) as string,
    [mainlineShare, expressScope],
  );
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
    type Pace = { pace: number; paceWeeks: number; dated: number };
    // The "~N/wk" tile is the whole fleet's pace.
    const model = computeInstallPace(aircraft, new Date(nowMs)) as Pace;
    // The static fallback roster carries no dateFound at all — the same guard the chart uses.
    if (model.dated === 0) return null;
    const paceStr =
      model.pace >= 10 ? String(Math.round(model.pace)) : String(Math.round(model.pace * 10) / 10);
    return {
      pace: model.pace > 0 ? `~${paceStr}` : '—',
      paceNote: model.paceWeeks > 0 ? `${model.paceWeeks}-wk trailing pace` : 'no complete weeks',
      // United's own stated target, not a date of ours (Nov 12 2026). The tile used to divide the
      // Express backlog by the Express pace and print "~Sep '31"; 145 of that backlog were
      // single-cabin jets outside United's stated plan, and the date contradicted United's.
      target: UNITED_STARLINK_TARGET,
    };
  }, [aircraft, nowMs]);

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

  // How old the board's rows really are (v1.28.0): OUR sync of the schedules and the tier they were
  // served from — the schedules' own response first, the boot roster's when it did not say. Never
  // the tracker's `lastUpdated`, frozen since Oct 27 2026 ("updated 16d ago" above live rows).
  const boardSyncedAt = starlink.flightsSyncedAt ?? starlink.syncedAt;
  const boardServedFrom = starlink.flightsServedFrom ?? starlink.servedFrom;
  const latestDepartureTs = useMemo(
    () => latestScheduledDepartureTs(flightsByTail) as number | null,
    [flightsByTail],
  );
  const boardFreshness = useMemo(
    () => starlinkScheduleFreshness({ syncedAt: boardSyncedAt, servedFrom: boardServedFrom, nowMs }) as string,
    [boardSyncedAt, boardServedFrom, nowMs],
  );
  const boardFooter = useMemo(
    () => starlinkBoardFooter({ syncedAt: boardSyncedAt, servedFrom: boardServedFrom, nowMs }) as string,
    [boardSyncedAt, boardServedFrom, nowMs],
  );
  const boardEmptyText = useMemo(
    () =>
      starlinkBoardEmptyText({
        hub: boardHub,
        windowH: boardWindow,
        latestDepartureTs,
        nowSec,
        syncedAt: boardSyncedAt,
        servedFrom: boardServedFrom,
      }) as string,
    [boardHub, boardWindow, latestDepartureTs, nowSec, boardSyncedAt, boardServedFrom],
  );

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

  // "Ask the board" (⌘K): a hub picks the departures board's hub, a tail goes into the roster search.
  const ask = useAskStarlink({ boardHub, onBoardHub, search, onSearch });

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

  // A future departure whose aircraft is still flying its inbound leg tracks that inbound.
  const onBoardTrack = useCallback(
    (row: BoardRow) => trackByIcao(row.icao24 || row.inbound?.icao24 || ''),
    [trackByIcao],
  );

  const onShowOnMap = useCallback(() => {
    setStarlinkFilter(true);
    setTab('live');
  }, [setStarlinkFilter, setTab]);

  const jumpToLedger = useCallback(() => {
    ledgerRef.current?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
  }, []);

  // The hero's bars and "+N NEW THIS WEEK" set the roster to show what they name, every other
  // filter back at rest (`rosterFiltersShowing`), and bring the roster into view the way
  // "N disputed" brings the ledger. A type, operator or search left from before would otherwise
  // land the click on "No aircraft match your filters".
  const showInRoster = useCallback((filters: ReturnType<typeof rosterFiltersShowing>) => {
    setSearch(filters.search);
    setFleetFilter(filters.fleet);
    setTypeFilter(filters.type);
    setOperatorFilter(filters.operator);
    setNewOnly(filters.newOnly);
    setExpanded(null);
    rosterRef.current?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
  }, []);
  const onShowFleet = useCallback(
    (fleet: RosterFleet) => showInRoster(rosterFiltersShowing(fleet)),
    [showInRoster],
  );
  const onShowNew = useCallback(() => showInRoster(rosterFiltersShowing('new')), [showInRoster]);

  // The source line is about the roster this tab's count comes from, so it reads the roster's sync.
  // Without a sync time it states no freshness at all (it used to say "live").
  const sourceFreshness = useMemo(
    () =>
      starlinkSourceFreshness({
        syncedAt: starlink.syncedAt,
        servedFrom: starlink.servedFrom,
        nowMs,
      }) as string | null,
    [starlink.syncedAt, starlink.servedFrom, nowMs],
  );

  const canFilterMap = starlink.tails.size > 0 && !starlink.degraded;

  return (
    <div className="space-y-4 p-3 md:p-4">
      <SlHero
        equipped={equipped}
        bars={bars}
        barsNote={barsNote}
        newThisWeek={newTails.size}
        airborneCount={airborneCount}
        canFilterMap={canFilterMap}
        verified={showLedger ? (mismatches.summary?.verifiedStarlink ?? null) : null}
        checked={mismatches.summary?.totalPlanes ?? null}
        disputed={
          mismatches.summary?.disputed != null
            ? mismatches.summary.disputed
            : mismatches.disputed.length
        }
        onJumpToLedger={jumpToLedger}
        onShowOnMap={onShowOnMap}
        onShowFleet={onShowFleet}
        onShowNew={onShowNew}
      />

      {chart ? <VelocityChart model={chart} pace={pace} /> : null}

      {industry ? <IndustryStrip rows={industry} /> : null}

      {ask.target === 'board' ? (
        <AskChips
          view="starlink"
          count={board ? board.totalInWindow : null}
          singular="Starlink departure"
          where={boardHub ? `from ${boardHub} in the next ${boardWindow} hours` : undefined}
          onRemove={ask.onRemove}
          onClear={ask.onClear}
        />
      ) : null}

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
          emptyText={boardEmptyText}
          footer={boardFooter}
          tzAbbrev={tzAbbrev}
          fleetByReg={fleetByReg}
          onOpenAircraft={openAircraft}
          onTrack={onBoardTrack}
        />
      ) : (
        <p className="text-xs text-muted-foreground" id="sl-board-note" aria-live="polite">
          {flightsLoading ? 'Loading the hub departures board…' : BOARD_UNAVAILABLE_NOTE}
        </p>
      )}

      <section ref={rosterRef} aria-labelledby="sl-roster-title" className="space-y-3">
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
        {ask.target === 'roster' ? (
          <AskChips
            view="starlink"
            count={aircraft.length ? rows.length : null}
            singular="Starlink aircraft"
            pluralNoun="Starlink aircraft"
            onRemove={ask.onRemove}
            onClear={ask.onClear}
          />
        ) : null}
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
          fleetByReg={fleetByReg}
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
          {sourceFreshness ? (
            <>
              · <span id="sl-updated">{sourceFreshness}</span>{' '}
            </>
          ) : null}
          · <span id="sl-count">{aircraft.length}</span> aircraft
        </p>
      </Card>
    </div>
  );
}
