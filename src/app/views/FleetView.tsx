/**
 * Fleet — three zones, top to bottom, in decreasing abstraction (inventory §21).
 *
 *  Zone 1 "Fleet Pulse"  what is happening right now: how many are airborne, how much of the
 *                        fleet that is, and how much of it can fly at all today.
 *  Zone 2 "Composition"  what the fleet IS: families, delivery history, cabin layouts.
 *  Zone 3 "Lookup"       the database itself, searchable down to one airframe — plus the United
 *                        Express fleet as its own sub-tab, never mixed into the mainline rows.
 *
 * That order is the point of the tab. A visitor who arrives from a hub page wanting "how
 * old is United's fleet" gets an answer in Zone 2 without ever touching a filter; a spotter
 * chasing one tail scrolls past both to Zone 3. The cross-link between them — clicking a
 * variant card in Zone 2 filters Zone 3 and scrolls there — is what makes it one page rather
 * than three panels that happen to share a tab.
 *
 * Everything countable comes from `src/lib/fleet-utils.js`, `analytics.js` and the
 * `fleet-view.js` module this task added, so this file owns layout, state and nothing else.
 *
 * The sr-only crawlable fleet summary §21 opens with is rendered server-side by Astro in
 * `src/pages/index.astro` (the island is `client:only`, so nothing here is crawlable).
 */

import { Zap } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Card } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TYPE_ORDER, typeUtilization } from '@/lib/analytics.js';
import {
  FLEET_DB_AS_OF,
  filterFleetData,
  searchHiddenByFilters,
  searchHiddenMessage,
  fleetUtilization,
  formatFleetAsOf,
  sortFleetData,
  starlinkMainlineShare,
} from '@/lib/fleet-utils.js';
import { matchAircraft } from '@/lib/fleet-match.js';
import { EXPRESS_STALE_DAYS, summarizeExpressFleet } from '@/lib/express-fleet.js';
import { expressSearchChip, expressSearchChips } from '@/lib/express-fleet-chips.js';
import { filterExpressFleet, sortExpressFleet } from '@/lib/express-fleet-view.js';
import {
  buildAirborneRows,
  buildConfigGallery,
  buildDeliveryTimeline,
  buildSpecialRows,
  deliveryStats,
  fleetDeepLinkTarget,
  fleetHealthCounts,
  fleetStayTarget,
  heldFleetLinkStep,
  sortAirborneRows,
  typeCounts as countByType,
  wifiFilterOptions,
} from '@/lib/fleet-view.js';
import { isAirborne } from '@/lib/live-stats.js';
import { scrollBehavior } from '@/lib/motion.js';
import { listSpecialLiveries } from '@/lib/special-livery.js';
import { expressStarlinkScope } from '@/lib/starlink-roster.js';
import { isRecentlyFound } from '@/lib/starlink-view.js';
import type { ExpressAircraft, FleetAircraft } from '../data/types';
import type { FleetDeepLinks } from '../state/deep-links';
import type { FleetLink } from '../state/ui';
import { AskChips } from '../features/AskChips';
import { useAskFleet } from './fleet/useAskFleet';
import { useFeed } from '../state/feed';
import { useFleet } from '../state/fleet';
import { useUi } from '../state/ui';
import { AirborneTable } from './fleet/AirborneTable';
import type { AirborneRow, AirborneSortCol } from './fleet/AirborneTable';
import { DeliveryTimeline } from './fleet/DeliveryTimeline';
import { ExpressFleetPanel } from './fleet/ExpressFleetPanel';
import type { ExpressChips, ExpressSortCol, ExpressSummary } from './fleet/ExpressFleetPanel';
import type { TimelineModel, TimelineStats } from './fleet/DeliveryTimeline';
import { FleetComposition } from './fleet/FleetComposition';
import { FleetControls, STATUS_OPTIONS } from './fleet/FleetControls';
import { FleetHealth, FleetLoadError } from './fleet/FleetHealth';
import type { HealthModel, StarlinkChip } from './fleet/FleetHealth';
import { FleetPulse } from './fleet/FleetPulse';
import type { TypeUtilisation } from './fleet/FleetPulse';
import { FleetTable } from './fleet/FleetTable';
import type { FleetSortCol } from './fleet/FleetTable';
import { SeatConfigGallery } from './fleet/SeatConfigGallery';
import type { ConfigEntry } from './fleet/SeatConfigGallery';
import { SpecialPanel } from './fleet/SpecialPanel';
import type { SpecialRow } from './fleet/SpecialPanel';

type SubView = 'all' | 'airborne' | 'special' | 'express';

/** How long the `?view=`/`?type=` deep links wait for the fleet database before giving up. */
const DEEP_LINK_TIMEOUT_MS = 10000;

/**
 * The opening addresses (`useUi().coldFleetLink`, one object per page load) this view has already
 * applied or given up on. A remount (the error boundary's "Try again") must not apply the address
 * the page was opened on a second time, long after the reader changed the filters.
 */
const SPENT_COLD_FLEET_LINKS = new WeakSet<FleetDeepLinks>();

/**
 * The followed links (`useUi().fleetLink`, a new object per follow) this view has applied or
 * dropped. Held outside the component for the same reason: a remount must not apply the last
 * followed link again, or give a dropped one a fresh budget from the new mount.
 */
const SPENT_FLEET_LINKS = new WeakSet<FleetLink>();

export default function FleetView() {
  const {
    fleetDb,
    fleetByReg,
    starlink,
    fleetSummary,
    special,
    loading,
    loadFailed,
    retry,
    expressDb,
    expressStatus,
  } = useFleet();
  const { flights, lastGoodTs } = useFeed();
  const { setTab, fleetLink, coldFleetLink } = useUi();

  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [wifiFilter, setWifiFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [subView, setSubView] = useState<SubView>('all');
  const [fleetSort, setFleetSort] = useState<{ col: FleetSortCol; asc: boolean }>({
    col: 'r',
    asc: true,
  });
  const [airborneSort, setAirborneSort] = useState<{ col: AirborneSortCol; asc: boolean }>({
    col: 'type',
    asc: true,
  });
  const [expressSearch, setExpressSearch] = useState('');
  const [expressSort, setExpressSort] = useState<{ col: ExpressSortCol; asc: boolean }>({
    col: 'r',
    asc: true,
  });

  const lookupRef = useRef<HTMLDivElement>(null);

  // ── Derived fleet models ────────────────────────────────────────────────────────────
  const counts = useMemo(() => countByType(fleetDb) as Record<string, number>, [fleetDb]);
  const typeOptions = useMemo(
    () =>
      (TYPE_ORDER as string[])
        .filter((type) => counts[type])
        .map((type) => ({ value: type, count: counts[type] })),
    [counts],
  );
  const wifiOptions = useMemo(() => wifiFilterOptions(fleetDb) as string[], [fleetDb]);
  const health = useMemo(() => fleetHealthCounts(fleetDb) as HealthModel | null, [fleetDb]);
  const timeline = useMemo(() => buildDeliveryTimeline(fleetDb) as TimelineModel, [fleetDb]);
  const timelineStats = useMemo(() => deliveryStats(fleetDb) as TimelineStats, [fleetDb]);
  const gallery = useMemo(
    () => (typeFilter ? (buildConfigGallery(fleetDb, typeFilter) as ConfigEntry[]) : []),
    [fleetDb, typeFilter],
  );

  // ── Zone 1: the live picture ────────────────────────────────────────────────────────
  // `isAirborne` and `fleetUtilization` are the definitions the Live bar and the Stats card
  // use too, so the three tabs quote one utilisation figure (F8/F92).
  const airborneFlights = useMemo(() => flights.filter(isAirborne), [flights]);
  const util = useMemo(
    () =>
      fleetUtilization(airborneFlights, fleetDb.length, (f: unknown) =>
        matchAircraft(f, fleetByReg),
      ) as { matched: number; notInDb: number; regional: number; pct: number | null },
    [airborneFlights, fleetDb.length, fleetByReg],
  );

  const utilisation = useMemo(
    () =>
      typeUtilization(airborneFlights, fleetDb, {
        matchAircraft: (f: unknown) => matchAircraft(f, fleetByReg),
      }) as TypeUtilisation[],
    [airborneFlights, fleetDb, fleetByReg],
  );

  // The shipped panel stamped wall-clock time here. `lastGoodTs` is closer: the time the last
  // good poll arrived, backdated by the server's `X-BB-Feed-Stale` and the CDN's `Age`
  // (`fetchFr24Feed`, F102). Only the server's own 15 s in-memory cache is not subtracted, so
  // it can read up to ~15 s fresh.
  const updatedAt = useMemo(
    () => (lastGoodTs ? new Date(lastGoodTs).toISOString().slice(11, 19) : null),
    [lastGoodTs],
  );

  // ONE Starlink % for the ring, the "Mainline Fleet" chip (F93) and the Starlink tab's
  // Mainline bar: see starlinkMainlineShare.
  const starlinkShare = useMemo(
    () =>
      starlinkMainlineShare(starlink.stats, fleetDb, starlink.tails) as {
        count: number;
        total: number;
        pct: number;
        source?: string;
      } | null,
    [starlink.stats, fleetDb, starlink.tails],
  );

  // ONE Express % for the "Express Fleet" chip and the Starlink tab's Express bar (Nov 12 2026):
  // the two-cabin regional jets in the fleet-summary payload, see expressStarlinkScope. Without
  // that payload there is no chip: the tracker's expressTotal / expressPct (69% of 513 on Nov 12,
  // beside 96% on the Starlink tab) counts single-cabin jets and is never printed as a share.
  const expressScope = useMemo(
    () => expressStarlinkScope(fleetSummary?.airlines ?? null) as { pct: number } | null,
    [fleetSummary],
  );

  const chips = useMemo<StarlinkChip[]>(() => {
    const stats = starlink.stats;
    if (!stats) return [];
    const mainlinePct = starlinkShare ? starlinkShare.pct : null;
    const expressPct = expressScope ? expressScope.pct : null;
    const newThisWeek = starlink.aircraft.filter((a) => isRecentlyFound(a.dateFound)).length;
    // "Total" is every equipped aircraft, which the Starlink tab lists: a quiet link there.
    // "Mainline" (the tracker's own census) and "New (7d)" have no list that shows exactly them
    // here, so they are text, in body colour (link colour means link).
    const rows: StarlinkChip[] = [
      { label: 'Total', value: String(stats.total), tone: 'ok', href: '/#starlink' },
      { label: 'Mainline', value: String(stats.mainline), tone: 'neutral' },
      { label: 'Express', value: String(stats.express), tone: 'express' },
    ];
    if (mainlinePct != null) {
      rows.push({ label: 'Mainline Fleet', value: `${mainlinePct}%`, tone: 'neutral' });
    }
    if (expressPct != null) {
      rows.push({ label: 'Express Fleet', value: `${expressPct}%`, tone: 'neutral' });
    }
    if (newThisWeek > 0) rows.push({ label: 'New (7d)', value: `+${newThisWeek}`, tone: 'neutral' });
    return rows;
  }, [starlink.stats, starlink.aircraft, starlinkShare, expressScope]);

  // ── Zone 3: the three panels ────────────────────────────────────────────────────────
  const filtersActive = Boolean(typeFilter || wifiFilter || statusFilter || search);

  const tableRows = useMemo(() => {
    const filtered = filterFleetData(fleetDb, {
      type: typeFilter,
      wifi: wifiFilter,
      status: statusFilter,
      search,
      starlinkTails: starlink.tails,
      specialAircraftSet: special,
    }) as FleetAircraft[];
    return sortFleetData(filtered, fleetSort.col, fleetSort.asc) as FleetAircraft[];
  }, [fleetDb, typeFilter, wifiFilter, statusFilter, search, starlink.tails, special, fleetSort]);

  const airborneRows = useMemo(() => {
    const rows = buildAirborneRows(flights, {
      fleetByReg,
      starlinkTails: starlink.tails,
      special,
      type: typeFilter,
      search,
    }) as AirborneRow[];
    return sortAirborneRows(rows, airborneSort.col, airborneSort.asc) as AirborneRow[];
  }, [flights, fleetByReg, starlink.tails, special, typeFilter, search, airborneSort]);

  // The United Express sub-tab: its own list, search and sort. The summary is of the whole
  // Express fleet, so a search never makes the fleet look smaller than it is.
  const expressSummary = useMemo(
    () => summarizeExpressFleet(expressDb) as ExpressSummary,
    [expressDb],
  );
  // The summary's counts as buttons that set the Express search (ruling 7), each only when its
  // word lists exactly the rows it counts; decided over the whole fleet, like the summary.
  const expressChips = useMemo<ExpressChips>(
    () => ({
      operators: expressSearchChips(expressSummary.byOperator, expressDb),
      types: expressSearchChips(expressSummary.byType, expressDb),
      starlink: expressSearchChip('Starlink', expressSummary.starlink, expressDb),
    }),
    [expressSummary, expressDb],
  );
  const expressRows = useMemo(
    () =>
      sortExpressFleet(
        filterExpressFleet(expressDb, expressSearch),
        expressSort.col,
        expressSort.asc,
      ) as ExpressAircraft[],
    [expressDb, expressSearch, expressSort],
  );
  const expressHasCabin = useMemo(() => expressDb.some((entry) => entry.c), [expressDb]);

  // Curated special liveries lead the panel; the fleet site's named/sticker entries follow.
  const specialRows = useMemo(
    () => buildSpecialRows(special, fleetByReg, flights, listSpecialLiveries()) as SpecialRow[],
    [special, fleetByReg, flights],
  );

  const subTabCounts = {
    all: fleetDb.length,
    airborne: util.matched,
    starlink: starlink.aircraft.length,
    // A tail with a name AND a livery is two cards, so count the cards.
    special: specialRows.length,
    express: expressDb.length,
  };

  // Stable, so the memoised All Aircraft table (about 1,150 rows of links) skips the re-render
  // every feed poll and UI store change gives this view.
  const sortFleetTable = useCallback(
    (col: FleetSortCol) =>
      setFleetSort((current) => (current.col === col ? { col, asc: !current.asc } : { col, asc: true })),
    [],
  );

  // ── Cross-zone: a variant card IS the type filter ───────────────────────────────────
  const selectTypeFromCard = useCallback((type: string) => {
    setTypeFilter((current) => {
      const next = current === type ? '' : type;
      // Selecting brings the table into view; deselecting leaves you where you are, because
      // a scroll on "I changed my mind" is disorienting.
      if (next) {
        requestAnimationFrame(() =>
          lookupRef.current?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' }),
        );
      }
      return next;
    });
  }, []);

  // "Ask the board" (⌘K): the table's own search and status filter carry the answer.
  const ask = useAskFleet({
    search,
    setSearch,
    setTypeFilter,
    setWifiFilter,
    statusFilter,
    setStatusFilter,
    showAll: useCallback(() => {
      setSubView('all');
      requestAnimationFrame(() =>
        lookupRef.current?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' }),
      );
    }, []),
  });
  const clearFilters = useCallback(() => {
    setTypeFilter('');
    setWifiFilter('');
    setStatusFilter('');
    setSearch('');
    ask.clear();
  }, [ask.clear]);

  // A search that finds a plane the other filters hide says so, and "Show it" drops those
  // filters but keeps the search (reader email Oct 5 2026: "N666UA is missing" with Wi-Fi =
  // Starlink still on — the 767 was in the database all along).
  const hiddenHint = useMemo(() => {
    const hint = searchHiddenByFilters(fleetDb, {
      type: typeFilter,
      wifi: wifiFilter,
      status: statusFilter,
      search,
      starlinkTails: starlink.tails,
      specialAircraftSet: special,
    });
    return hint ? { message: searchHiddenMessage(hint, search) as string, plural: hint.count > 1 } : null;
  }, [fleetDb, typeFilter, wifiFilter, statusFilter, search, starlink.tails, special]);
  const showHidden = useCallback(() => {
    setTypeFilter('');
    setWifiFilter('');
    setStatusFilter('');
  }, []);

  // ── Deep links: ?type= / ?filter= / ?view=airborne|special|express ──────────────────
  // One way in for an address, opened cold or followed in place (`fleetDeepLinkTarget`): a known
  // status or type sets that filter (a type clears the status) and, with no sub-view of its own,
  // opens All Aircraft; a sub-view opens; an unmatched value (`?type=B789`, an ICAO code the
  // controls never offered) is ignored rather than applied, and with no sub-view the address
  // changes nothing — filtering the table to nothing would read as "United has no 787-9s".
  // "Known" is what the type select offers, which needs the fleet database.
  //
  // A followed link first puts the tab back where a cold load starts — search, Wi-Fi, status and
  // type filters, the Express search, and a Fleet "Ask the board" answer, through the store's own
  // clear — so the same address lands in the same place either way. The sort order is the
  // reader's and stays; it is not part of an address.
  //
  // Then it brings the reader to what it set (`target.scrollTo`, below): without that a link
  // opened the tab on the pulse cards, with the filtered table a long scroll down, and read as if
  // nothing had happened (found by the reviewer on the preview build, Nov 12 2026).
  const { active: askActive, clear: clearAsk } = ask;
  const [linkScroll, setLinkScroll] = useState<{ to: 'controls' | 'panel' } | null>(null);
  //
  // A link followed while this tab is already showing (`fleetLink.arriving` false, the links plan's
  // ruling 2) is not an arrival: it sets only the filter or sub-view it names (`fleetStayTarget`),
  // resets nothing and scrolls nowhere.
  const applyFleetDeepLink = useCallback(
    (link: FleetDeepLinks, how: 'cold' | 'arrive' | 'stay') => {
      const options = {
        statusValues: STATUS_OPTIONS.map((option) => option.value),
        typeValues: typeOptions.map((option) => option.value),
      };
      if (how === 'stay') {
        const stay = fleetStayTarget(link, options, subView) as {
          filter: { status: string } | { type: string } | null;
          subView: SubView;
        } | null;
        if (!stay) return;
        if (stay.filter && 'type' in stay.filter) setTypeFilter(stay.filter.type);
        else if (stay.filter) setStatusFilter(stay.filter.status);
        setSubView(stay.subView);
        return;
      }
      const target = fleetDeepLinkTarget(link, options) as {
        filter: { status: string; type: string } | null;
        subView: SubView;
        scrollTo: 'controls' | 'panel';
      } | null;
      if (!target) return;
      if (how === 'arrive') {
        setSearch('');
        setWifiFilter('');
        setStatusFilter('');
        setTypeFilter('');
        setExpressSearch('');
        if (askActive) clearAsk();
      }
      if (target.filter) {
        setStatusFilter(target.filter.status);
        setTypeFilter(target.filter.type);
      }
      setSubView(target.subView);
      // A new object each time, so the same link followed twice scrolls twice.
      setLinkScroll({ to: target.scrollTo });
    },
    [typeOptions, askActive, clearAsk, subView],
  );

  // The Fleet Pulse's utilization line opens the Airborne Now list. It lands where a cold load of
  // `?view=airborne` lands (ruling 9): the filters are put back first, so the list shows every
  // mainline aircraft flying, the "m" of "m/total", then the tab scrolls to it. A button, not a
  // link: on this tab a followed link is a stay and would keep a type filter that hides most of the
  // aircraft counted.
  const showAirborne = useCallback(
    () => applyFleetDeepLink({ filter: null, view: 'airborne' }, 'arrive'),
    [applyFleetDeepLink],
  );

  // A type link followed in place from the Pulse or a Special card sets the type filter and nothing
  // else (ruling 2, the 'stay' above), and the table it filters is far below them: bring the
  // controls row into view, as a Composition variant card does, through the scroll a link asks for.
  const scrollToControls = useCallback(() => setLinkScroll({ to: 'controls' }), []);

  // The scroll a link asked for, once the filter and sub-view it set have rendered: the controls
  // row for a filter, the open sub-view's panel for a view alone, top of the tab's scroller (the
  // header and tab bar sit outside it; `scroll-mt-2` keeps a little air). A frame later, as the
  // Weather tab does, because a followed link may have just shown this panel. Respects reduced
  // motion (`scrollBehavior`) and leaves focus where it is.
  useEffect(() => {
    if (!linkScroll) return undefined;
    const frame = requestAnimationFrame(() => {
      const zone = lookupRef.current;
      const element =
        linkScroll.to === 'controls'
          ? zone?.querySelector('#fleet-controls')
          : zone?.querySelector('[role="tabpanel"][data-state="active"]');
      element?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
    });
    return () => cancelAnimationFrame(frame);
  }, [linkScroll]);

  // A cold load. The shipped dashboard polled every 200 ms for up to 10 s because the fleet
  // database arrives after the URL is read. Here the same wait is an effect that latches the
  // first time `fleetDb` is non-empty — and gives up on the same 10 s budget so a failed load
  // does not leave a filter pending forever (`heldFleetLinkStep`). The address is the one the
  // page was opened on, held by the UI store at startup (`coldFleetLink`): a link followed to
  // another tab before the database arrived has taken it out of the address bar by now.
  const deepLinkDone = useRef(false);
  const deepLinkDeadline = useRef(Date.now() + DEEP_LINK_TIMEOUT_MS);
  useEffect(() => {
    if (deepLinkDone.current) return;
    if (SPENT_COLD_FLEET_LINKS.has(coldFleetLink)) {
      deepLinkDone.current = true;
      return;
    }
    const step = heldFleetLinkStep({
      loaded: fleetDb.length > 0,
      loadFailed,
      now: Date.now(),
      deadline: deepLinkDeadline.current,
    });
    if (step === 'wait') return;
    deepLinkDone.current = true;
    SPENT_COLD_FLEET_LINKS.add(coldFleetLink);
    if (step === 'apply') applyFleetDeepLink(coldFleetLink, 'cold');
  }, [fleetDb.length, loadFailed, applyFleetDeepLink, coldFleetLink]);

  // A link followed in place (`useUi().followFleetLink`, from a DashLink anywhere in the
  // dashboard). Each follow is a new object, so the same link clicked again after the visitor
  // cleared the filter applies again. A link already in the store when this view mounts is
  // applied: the view mounts on the first visit to the tab, which is often the follow itself. A
  // link followed before the database arrives is held until it does, on the cold load's budget:
  // 10 s from the follow (`fleetLink.at`), or from this view's mount when that is later (a first
  // visit spends part of the wait loading the tab's own code). Later than that it is dropped.
  // Applied or dropped, it is spent (`SPENT_FLEET_LINKS`), so a remount (the error boundary's
  // "Try again") neither applies it again nor restarts its budget.
  // Declared after the cold load's effect so that, when both apply in one commit, the link the
  // visitor just clicked wins over an address the page was opened on.
  useEffect(() => {
    if (!fleetLink || SPENT_FLEET_LINKS.has(fleetLink)) return;
    const step = heldFleetLinkStep({
      loaded: fleetDb.length > 0,
      loadFailed,
      now: Date.now(),
      deadline: Math.max(fleetLink.at + DEEP_LINK_TIMEOUT_MS, deepLinkDeadline.current),
    });
    if (step === 'wait') return;
    SPENT_FLEET_LINKS.add(fleetLink);
    if (step === 'apply') applyFleetDeepLink(fleetLink, fleetLink.arriving ? 'arrive' : 'stay');
  }, [fleetLink, fleetDb.length, loadFailed, applyFleetDeepLink]);

  // ── Load failure ────────────────────────────────────────────────────────────────────
  // Only the panels that READ the fleet database go away. The airborne count, the
  // mainline/regional split and the timestamp come from the live feed, which is a different
  // endpoint with a different failure mode — blanking them too would report a fleet-file
  // outage as "the whole tab is broken", and would throw away the one number on this tab
  // that is still true. The shipped `renderFleetLoadError()` kept the pulse running for the
  // same reason; what it could not do, and this does, is say plainly which half is missing.
  //
  // `fleetFailed` suppresses the mainline/regional split: with an empty database nothing
  // matches, and reporting every airborne aircraft as "regional/partner" would be the same
  // false claim as "0 aircraft". The per-type bars and the utilisation line are
  // fleetDb-dependent and suppress themselves.
  if (loadFailed && !fleetDb.length) {
    return (
      <div className="space-y-4 p-3 md:p-4">
        <Card className="gap-0 p-4">
          <h3 className="mb-3 text-sm font-semibold">Live Fleet Status</h3>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <FleetPulse
              airborne={airborneFlights.length}
              matched={util.matched}
              notInDb={util.notInDb}
              regional={util.regional}
              fleetTotal={0}
              utilPct={null}
              utilisation={[]}
              updatedAt={updatedAt}
              loading={false}
              fleetFailed
            />
            <FleetLoadError onRetry={retry} />
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-3 md:p-4">
      {/* ═══ ZONE 1 — FLEET PULSE ═══ */}
      <Card className="gap-0 p-4">
        <h3 className="mb-3 text-sm font-semibold">Live Fleet Status</h3>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <FleetPulse
            airborne={airborneFlights.length}
            matched={util.matched}
            notInDb={util.notInDb}
            regional={util.regional}
            fleetTotal={fleetDb.length}
            utilPct={util.pct}
            utilisation={utilisation}
            updatedAt={updatedAt}
            loading={loading}
            onShowAirborne={showAirborne}
            typeFilter={typeFilter}
            onTypeFollowed={scrollToControls}
          />
          <FleetHealth
            health={health}
            starlinkShare={starlinkShare}
            chips={chips}
            loading={loading}
          />
        </div>
      </Card>

      {/* ═══ ZONE 2 — COMPOSITION ═══ */}
      <section aria-labelledby="fleet-overview-title" className="space-y-3">
        <h3 id="fleet-overview-title" className="text-sm font-semibold">
          {fleetDb.length
            ? `Fleet Overview — ${fleetDb.length} Mainline Aircraft`
            : 'Fleet Overview'}
        </h3>

        <FleetComposition
          counts={counts}
          activeType={typeFilter}
          onSelectType={selectTypeFromCard}
        />

        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          <Card className="gap-0 p-4">
            <h4 className="text-sm font-semibold">Fleet Delivery Timeline</h4>
            <p className="mb-2 text-[11px] text-muted-foreground">
              Aircraft deliveries by year, colored by family
            </p>
            <DeliveryTimeline model={timeline} stats={timelineStats} loading={loading} />
          </Card>

          <Card className="gap-0 p-4">
            <h4 className="mb-2 text-sm font-semibold">Seat Configuration</h4>
            <SeatConfigGallery
              type={typeFilter}
              configs={gallery}
              loading={loading}
              onSelectType={selectTypeFromCard}
            />
          </Card>
        </div>
      </section>

      {/* ═══ ZONE 3 — AIRCRAFT LOOKUP ═══ */}
      <section ref={lookupRef} id="fleet-lookup-zone" className="space-y-3 scroll-mt-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold">Aircraft Lookup</h3>
          {subView === 'express' ? (
            <p className="text-[11px] text-muted-foreground">
              United Express aircraft seen flying United flights, from the live feed and hub boards
            </p>
          ) : (
            <p className="text-[11px] text-muted-foreground">
              Fleet data via{' '}
              <a
                href="https://unitedfleetsite.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2 hover:text-foreground"
              >
                United Fleet Site
              </a>
              {/* A hand-maintained snapshot with no refresh job — say how old it is (F86). */}
              , as of <time dateTime={FLEET_DB_AS_OF}>{formatFleetAsOf()}</time>
            </p>
          )}
        </div>

        <Tabs
          value={subView}
          // Manual activation, because one of these "tabs" navigates away. Radix's default
          // activates whatever an arrow key focuses, so arrowing past 🛰️ Starlink would
          // switch to the Starlink TAB mid-keystroke and drop focus into a panel that no
          // longer exists. Arrows move, Enter/Space/click commit.
          activationMode="manual"
          onValueChange={(value) => {
            // Starlink is a top-level tab of its own now; the sub-tab is a signpost to it
            // and must not become a fourth panel here.
            if (value === 'starlink') setTab('starlink');
            else setSubView(value as SubView);
          }}
          className="gap-3"
        >
          {/* `h-auto!` and `h-full!` are deliberate: TabsList's own variant sets a fixed
              32 px height and TabsTrigger sets `h-[calc(100%-1px)]`, both of which assume a
              single row. Four labels carrying counts wrap below ~500 px, and without these
              the wrapped row overflows the list and lands on top of the search box. */}
          {/* `justify-start`: wrapped onto three rows on a phone, centred labels read as a
              ragged block. */}
          <TabsList aria-label="Aircraft lookup views" className="h-auto! flex-wrap justify-start gap-1">
            <TabsTrigger value="all" className="h-full! min-h-11 grow-0 pointer-fine:md:min-h-0">
              All Aircraft <span className="text-muted-foreground">({subTabCounts.all})</span>
            </TabsTrigger>
            <TabsTrigger value="airborne" className="h-full! min-h-11 grow-0 pointer-fine:md:min-h-0">
              Airborne Now{' '}
              <span className="text-muted-foreground">({subTabCounts.airborne})</span>
            </TabsTrigger>
            <TabsTrigger value="starlink" className="h-full! min-h-11 grow-0 pointer-fine:md:min-h-0">
              <Zap aria-hidden="true" /> Starlink{' '}
              <span className="text-muted-foreground">({subTabCounts.starlink})</span>
            </TabsTrigger>
            <TabsTrigger value="special" className="h-full! min-h-11 grow-0 pointer-fine:md:min-h-0">
              Special <span className="text-muted-foreground">({subTabCounts.special})</span>
            </TabsTrigger>
            <TabsTrigger value="express" className="h-full! min-h-11 grow-0 pointer-fine:md:min-h-0">
              United Express <span className="text-muted-foreground">({subTabCounts.express})</span>
            </TabsTrigger>
          </TabsList>

          {/* The mainline controls filter the mainline database; the Express panel has its own
              search, and these type/Wi-Fi/status values would do nothing there. */}
          {subView === 'all' ? (
            <AskChips
              view="fleet"
              count={fleetDb.length ? tableRows.length : null}
              singular="aircraft"
              pluralNoun="aircraft"
              where="in the fleet list"
              onRemove={ask.onRemove}
              onClear={ask.onClear}
            />
          ) : null}

          {subView !== 'express' ? (
            <FleetControls
              search={search}
              onSearchChange={setSearch}
              type={typeFilter}
              onTypeChange={setTypeFilter}
              typeOptions={typeOptions}
              wifi={wifiFilter}
              onWifiChange={setWifiFilter}
              wifiOptions={wifiOptions}
              status={statusFilter}
              onStatusChange={setStatusFilter}
            />
          ) : null}

          <TabsContent value="all" className="scroll-mt-2">
            <FleetTable
              rows={tableRows}
              sort={fleetSort}
              onSort={sortFleetTable}
              starlinkTails={starlink.tails}
              special={special}
              filtersActive={filtersActive}
              onClearFilters={clearFilters}
              hiddenHint={hiddenHint}
              onShowHidden={showHidden}
              fleetByReg={fleetByReg}
              typeFilter={typeFilter}
            />
          </TabsContent>

          <TabsContent value="airborne" className="scroll-mt-2">
            <AirborneTable
              rows={airborneRows}
              sort={airborneSort}
              onSort={(col) =>
                setAirborneSort((current) =>
                  current.col === col ? { col, asc: !current.asc } : { col, asc: true },
                )
              }
              feedLoading={flights.length === 0}
            />
          </TabsContent>

          <TabsContent value="special" className="scroll-mt-2">
            <SpecialPanel rows={specialRows} loading={loading} onTypeFollowed={scrollToControls} />
          </TabsContent>

          <TabsContent value="express" className="scroll-mt-2">
            <ExpressFleetPanel
              rows={expressRows}
              showCabin={expressHasCabin}
              summary={expressSummary}
              chips={expressChips}
              staleDays={EXPRESS_STALE_DAYS}
              status={expressStatus}
              search={expressSearch}
              onSearchChange={setExpressSearch}
              sort={expressSort}
              onSort={(col) =>
                setExpressSort((current) =>
                  current.col === col ? { col, asc: !current.asc } : { col, asc: true },
                )
              }
              nowMs={Date.now()}
            />
          </TabsContent>
        </Tabs>
      </section>
    </div>
  );
}
