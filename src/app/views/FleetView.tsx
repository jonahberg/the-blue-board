/**
 * Fleet — three zones, top to bottom, in decreasing abstraction (inventory §21).
 *
 *  Zone 1 "Fleet Pulse"  what is happening right now: how many are airborne, how much of the
 *                        fleet that is, and how much of it can fly at all today.
 *  Zone 2 "Composition"  what the fleet IS: families, delivery history, cabin layouts.
 *  Zone 3 "Lookup"       the database itself, searchable down to one airframe.
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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Card } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TYPE_ORDER, typeUtilization } from '@/lib/analytics.js';
import { filterFleetData, sortFleetData } from '@/lib/fleet-utils.js';
import { matchAircraft } from '@/lib/fleet-match.js';
import {
  buildAirborneRows,
  buildConfigGallery,
  buildDeliveryTimeline,
  buildSpecialRows,
  deliveryStats,
  fleetHealthCounts,
  resolveFleetDeepLinkFilter,
  sortAirborneRows,
  typeCounts as countByType,
  wifiFilterOptions,
} from '@/lib/fleet-view.js';
import { isRecentlyFound } from '@/lib/starlink-view.js';
import type { FleetAircraft } from '../data/types';
import { readFleetDeepLinks } from '../state/deep-links';
import { useFeed } from '../state/feed';
import { useFleet } from '../state/fleet';
import { useUi } from '../state/ui';
import { AirborneTable } from './fleet/AirborneTable';
import type { AirborneRow, AirborneSortCol } from './fleet/AirborneTable';
import { DeliveryTimeline } from './fleet/DeliveryTimeline';
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

type SubView = 'all' | 'airborne' | 'special';

/** How long the `?view=`/`?type=` deep links wait for the fleet database before giving up. */
const DEEP_LINK_TIMEOUT_MS = 10000;

export default function FleetView() {
  const { fleetDb, fleetByReg, starlink, special, loading, loadFailed, retry } = useFleet();
  const { flights, lastGoodTs } = useFeed();
  const { openAircraft, setTab } = useUi();

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
  const airborneFlights = useMemo(() => flights.filter((f) => !f.onGround), [flights]);
  const { matched, unmatched } = useMemo(() => {
    let hit = 0;
    airborneFlights.forEach((f) => {
      if (matchAircraft(f, fleetByReg)) hit++;
    });
    return { matched: hit, unmatched: airborneFlights.length - hit };
  }, [airborneFlights, fleetByReg]);

  const utilisation = useMemo(
    () =>
      typeUtilization(airborneFlights, fleetDb, {
        matchAircraft: (f: unknown) => matchAircraft(f, fleetByReg),
      }) as TypeUtilisation[],
    [airborneFlights, fleetDb, fleetByReg],
  );

  // The shipped panel stamped wall-clock time here. The payload's own timestamp is the
  // honest one: on a stale serve the two differ, and this line claims freshness.
  const updatedAt = useMemo(
    () => (lastGoodTs ? new Date(lastGoodTs).toISOString().slice(11, 19) : null),
    [lastGoodTs],
  );

  const starlinkInstalled = starlink.stats
    ? starlink.stats.mainline
    : starlink.aircraft.filter((a) => a.fleet === 'Mainline').length;

  const chips = useMemo<StarlinkChip[]>(() => {
    const stats = starlink.stats;
    if (!stats) return [];
    const mainlinePct =
      stats.mainlinePct ??
      (stats.mainlineTotal ? Math.round((stats.mainline / stats.mainlineTotal) * 100) : null);
    const expressPct =
      stats.expressPct ??
      (stats.expressTotal ? Math.round((stats.express / stats.expressTotal) * 100) : null);
    const newThisWeek = starlink.aircraft.filter((a) => isRecentlyFound(a.dateFound)).length;
    const rows: StarlinkChip[] = [
      { label: 'Total', value: String(stats.total), tone: 'ok' },
      { label: 'Mainline', value: String(stats.mainline), tone: 'primary' },
      { label: 'Express', value: String(stats.express), tone: 'express' },
    ];
    if (mainlinePct != null) {
      rows.push({ label: 'Mainline Fleet', value: `${mainlinePct}%`, tone: 'neutral' });
    }
    if (expressPct != null) {
      rows.push({ label: 'Express Fleet', value: `${expressPct}%`, tone: 'neutral' });
    }
    if (newThisWeek > 0) rows.push({ label: 'New (7d)', value: `+${newThisWeek}`, tone: 'new' });
    return rows;
  }, [starlink.stats, starlink.aircraft]);

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

  const specialRows = useMemo(
    () => buildSpecialRows(special, fleetByReg, flights) as SpecialRow[],
    [special, fleetByReg, flights],
  );

  const subTabCounts = {
    all: fleetDb.length,
    airborne: airborneFlights.filter((f) => matchAircraft(f, fleetByReg)).length,
    starlink: starlink.aircraft.length,
    special: special.size,
  };

  // ── Cross-zone: a variant card IS the type filter ───────────────────────────────────
  const selectTypeFromCard = useCallback((type: string) => {
    setTypeFilter((current) => {
      const next = current === type ? '' : type;
      // Selecting brings the table into view; deselecting leaves you where you are, because
      // a scroll on "I changed my mind" is disorienting.
      if (next) {
        requestAnimationFrame(() =>
          lookupRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
        );
      }
      return next;
    });
  }, []);

  const clearFilters = useCallback(() => {
    setTypeFilter('');
    setWifiFilter('');
    setStatusFilter('');
    setSearch('');
  }, []);

  // ── Deep links: ?type= / ?filter= / ?view=airborne|special ──────────────────────────
  // The shipped dashboard polled every 200 ms for up to 10 s because the fleet database
  // arrives after the URL is read. Here the same wait is an effect that latches the first
  // time `fleetDb` is non-empty — and gives up on the same 10 s budget so a failed load does
  // not leave a filter pending forever.
  const deepLinkDone = useRef(false);
  const deepLinkDeadline = useRef(Date.now() + DEEP_LINK_TIMEOUT_MS);
  useEffect(() => {
    if (deepLinkDone.current) return;
    if (loadFailed || Date.now() > deepLinkDeadline.current) {
      deepLinkDone.current = true;
      return;
    }
    if (!fleetDb.length) return;
    deepLinkDone.current = true;

    const { filter, view } = readFleetDeepLinks();
    if (filter) {
      const resolved = resolveFleetDeepLinkFilter(filter, {
        statusValues: STATUS_OPTIONS.map((option) => option.value),
        typeValues: Object.keys(counts),
      }) as { status: string; type: string } | null;
      // An unmatched value (`?type=B789`, an ICAO code the controls never offered) is
      // ignored rather than applied — filtering the table to nothing would read as
      // "United has no 787-9s".
      if (resolved) {
        setStatusFilter(resolved.status);
        setTypeFilter(resolved.type);
      }
    }
    if (view) setSubView(view);
  }, [fleetDb.length, loadFailed, counts]);

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
              matched={matched}
              unmatched={unmatched}
              fleetTotal={0}
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
            matched={matched}
            unmatched={unmatched}
            fleetTotal={fleetDb.length}
            utilisation={utilisation}
            updatedAt={updatedAt}
            loading={loading}
          />
          <FleetHealth
            health={health}
            starlinkInstalled={starlinkInstalled}
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
            , updated daily
          </p>
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
          <TabsList aria-label="Aircraft lookup views" className="h-auto! flex-wrap gap-1">
            <TabsTrigger value="all" className="h-full! min-h-11 grow-0 md:min-h-0">
              All Aircraft <span className="text-muted-foreground">({subTabCounts.all})</span>
            </TabsTrigger>
            <TabsTrigger value="airborne" className="h-full! min-h-11 grow-0 md:min-h-0">
              Airborne Now{' '}
              <span className="text-muted-foreground">({subTabCounts.airborne})</span>
            </TabsTrigger>
            <TabsTrigger value="starlink" className="h-full! min-h-11 grow-0 md:min-h-0">
              🛰️ Starlink{' '}
              <span className="text-muted-foreground">({subTabCounts.starlink})</span>
            </TabsTrigger>
            <TabsTrigger value="special" className="h-full! min-h-11 grow-0 md:min-h-0">
              Special <span className="text-muted-foreground">({subTabCounts.special})</span>
            </TabsTrigger>
          </TabsList>

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

          <TabsContent value="all">
            <FleetTable
              rows={tableRows}
              sort={fleetSort}
              onSort={(col) =>
                setFleetSort((current) =>
                  current.col === col ? { col, asc: !current.asc } : { col, asc: true },
                )
              }
              starlinkTails={starlink.tails}
              special={special}
              filtersActive={filtersActive}
              onClearFilters={clearFilters}
              onOpenAircraft={openAircraft}
            />
          </TabsContent>

          <TabsContent value="airborne">
            <AirborneTable
              rows={airborneRows}
              sort={airborneSort}
              onSort={(col) =>
                setAirborneSort((current) =>
                  current.col === col ? { col, asc: !current.asc } : { col, asc: true },
                )
              }
              feedLoading={flights.length === 0}
              onOpenAircraft={openAircraft}
            />
          </TabsContent>

          <TabsContent value="special">
            <SpecialPanel rows={specialRows} loading={loading} onOpenAircraft={openAircraft} />
          </TabsContent>
        </Tabs>
      </section>
    </div>
  );
}
