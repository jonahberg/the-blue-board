/**
 * Live Ops — the map, its layer controls, the filter sidebar and the stat strip.
 *
 * The map is the page here, so the layout is a flex row that fills the view area rather
 * than the old fixed full-bleed background map. `isolate` on the map wrapper is not
 * cosmetic: Leaflet's panes sit at z-index 400+, and without a fresh stacking context they
 * paint straight over the flight Sheet (z-50) and the ⌘K dialog.
 *
 * Every filter is one piece of state read by both the map and the sidebar, so what the
 * sidebar counts is exactly what the map draws.
 */

import { SlidersHorizontal } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { focusContentOnOpen } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { computeLiveStats } from '@/lib/live-stats.js';
import { filterLiveFlights } from '@/lib/live-filters.js';
import { matchAircraft } from '@/lib/fleet-match.js';
import { HUB_ORDER } from '@/lib/hub-health.js';
import { AIRPORTS } from '@/lib/airports.js';
import { DEFAULT_REGION_ID, resolveRegionId } from '@/lib/map-regions.js';
import { LiveMap } from '../map/LiveMap';
import type { RegionRequest } from '../map/LiveMap';
import type { Flight } from '../data/types';
import { readLiveHubDeepLink } from '../state/deep-links';
import { useFeed } from '../state/feed';
import { useFleet } from '../state/fleet';
import { useMediaQuery } from '../state/hooks';
import { usePrefs } from '../state/prefs';
import { useUi } from '../state/ui';
import { useWatch } from '../state/watch';
import { LiveSidebar } from './live/LiveSidebar';
import { MapControls } from './live/MapControls';
import type { LayerKey } from './live/MapControls';
import { MapLegend } from './live/MapLegend';
import { StatsBar } from './live/StatsBar';
import type { LiveStats } from './live/stats';
import { makeIsStarlinkFlight } from './live/starlink-match';

type Airport = { iata: string; lat: number; lon: number; hub?: boolean };

/** The callback shapes `src/lib/*.js` declares via JSDoc (`@param {Object}`). */
type LibPredicate = (f: Object) => boolean;
type LibMatcher = (f: Object) => { r: string } | null;

const HUB_AIRPORTS: Airport[] = (AIRPORTS as Airport[]).filter((a) => a.hub);
const HUB_CODES: string[] = HUB_ORDER as string[];

export default function LiveView() {
  const feed = useFeed();
  const { fleetDb, fleetByReg, starlink } = useFleet();
  const { homeAirport } = usePrefs();
  const { selection, select, focus, focusOn, setTab, starlinkFilter, setStarlinkFilter } = useUi();
  const watch = useWatch();

  // Every layer except Starlink is local. Starlink's toggle is shared state because the
  // Starlink tab's "● N AIRBORNE NOW" chip switches to this tab with the filter already on.
  const [layers, setLayers] = useState<LayerKey[]>(['hubs']);
  // The region preset last picked. Local, like the layers (neither has ever been persisted);
  // null until a pick, so the map keeps the home-hub / US opening view it was built with.
  const [regionRequest, setRegionRequest] = useState<RegionRequest | null>(null);
  const onRegion = useCallback((id: string) => {
    // A fresh key per pick: re-picking the same region after panning away still recentres.
    setRegionRequest((prev) => ({ id: resolveRegionId(id) as string, key: (prev?.key ?? 0) + 1 }));
  }, []);
  // `?hub=den` (hub guides, the hub strip's share links) opens the map filtered to that hub.
  const [deepLinkHub] = useState(() => readLiveHubDeepLink(HUB_CODES));
  const [hubFilter, setHubFilter] = useState(deepLinkHub ?? '');
  const [phaseFilter, setPhaseFilter] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const desktop = useMediaQuery('(min-width: 1024px)');

  const starlinkAvailable = starlink.tails.size > 0 && !starlink.degraded;
  const isStarlinkFlight = useMemo(
    () => makeIsStarlinkFlight(starlink.tails, fleetByReg),
    [starlink.tails, fleetByReg],
  );

  // v1.16.0: the Starlink control HIGHLIGHTS Starlink aircraft violet, like Long-haul highlights
  // amber; it no longer filters the map. By default the map draws two things only: mainline and
  // United Express (owner, Oct 4 2026: "mainline and Express colors different, with no other
  // filters, and then people can click for Starlink or long haul"). The shared `starlinkFilter`
  // state keeps its name because the Starlink tab's "● N AIRBORNE NOW" chip still switches here
  // with it on. A highlight that survives the roster going away would light nothing, so it reads
  // as on only while the roster is usable.
  const starlinkHighlight = starlinkFilter && starlinkAvailable;

  const activeLayers = useMemo<LayerKey[]>(
    () => (starlinkHighlight ? [...layers, 'starlink'] : layers),
    [layers, starlinkHighlight],
  );

  const onLayersChange = useCallback(
    (next: LayerKey[]) => {
      setStarlinkFilter(next.includes('starlink'));
      setLayers(next.filter((key) => key !== 'starlink'));
    },
    [setStarlinkFilter],
  );

  // The lib modules are JSDoc'd against `Object` (they predate this TSX layer and stay
  // framework-free), so the callbacks are widened here rather than loosening the modules.
  const filtered = useMemo(
    () =>
      filterLiveFlights(
        feed.flights,
        { hub: hubFilter, phaseGroup: phaseFilter, starlinkOnly: false },
        { hubs: HUB_AIRPORTS, isStarlink: isStarlinkFlight as LibPredicate },
      ) as Flight[],
    [feed.flights, hubFilter, phaseFilter, isStarlinkFlight],
  );

  const stats = useMemo(
    () =>
      // The same predicate as the Starlink filter, so the stat and the filtered map agree.
      computeLiveStats(feed.flights, filtered, fleetDb.length, isStarlinkFlight as LibPredicate, {
        matchAircraft: ((f: Flight) => matchAircraft(f, fleetByReg)) as LibMatcher,
        isFiltered: Boolean(hubFilter || phaseFilter),
      }) as LiveStats,
    [feed.flights, filtered, fleetDb.length, isStarlinkFlight, fleetByReg, hubFilter, phaseFilter],
  );

  const watchedIdents = useMemo(
    () => new Set(watch.watched.map((entry) => entry.flight)),
    [watch.watched],
  );

  const onSelect = useCallback(
    (flight: Flight) => {
      select({ kind: 'flight', flight });
      setSidebarOpen(false);
    },
    [select],
  );

  const onHubFilter = useCallback(
    (hub: string) => {
      setHubFilter(hub);
      const airport = HUB_AIRPORTS.find((a) => a.iata === hub);
      if (airport) focusOn(airport.lat, airport.lon);
      setSidebarOpen(false);
    },
    [focusOn],
  );

  // Centre on a deep-linked hub once, on mount.
  useEffect(() => {
    if (!deepLinkHub) return;
    const airport = HUB_AIRPORTS.find((a) => a.iata === deepLinkHub);
    if (airport) focusOn(airport.lat, airport.lon);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only by design
  }, []);

  const clearFilters = useCallback(() => {
    setHubFilter('');
    setPhaseFilter('');
    setStarlinkFilter(false);
  }, [setStarlinkFilter]);

  const sidebar = (
    <LiveSidebar
      flights={feed.flights}
      filtered={filtered}
      hubCodes={HUB_CODES}
      hubFilter={hubFilter}
      phaseFilter={phaseFilter}
      phaseCounts={stats.phaseGroups}
      onHubFilter={onHubFilter}
      onPhaseFilter={setPhaseFilter}
      onClearFilters={clearFilters}
      onSelect={onSelect}
      onGoToSchedule={() => setTab('schedule')}
    />
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-0 flex-1">
        {/* isolate: keeps Leaflet's z-400 panes out of the page's stacking order. */}
        <div
          className="relative isolate z-0 min-h-0 flex-1"
          // The flight panel is a non-modal sheet pinned to the right: it overlaps the map's
          // bottom-right corner, which is where Leaflet puts the zoom control. global.css
          // slides that control stack clear while the panel is open.
          data-flight-panel={selection ? 'open' : undefined}
        >
          <LiveMap
            className="absolute inset-0 bg-background"
            flights={feed.flights}
            filtered={filtered}
            selectedId={selection?.kind === 'flight' ? selection.flight.fr24id : null}
            onSelect={onSelect}
            watchedIdents={watchedIdents}
            starlinkTails={starlink.tails}
            focus={focus}
            layers={{
              hubs: layers.includes('hubs'),
              wx: layers.includes('wx'),
              longhaul: layers.includes('longhaul'),
              starlink: starlinkHighlight,
            }}
            regionRequest={regionRequest}
            homeAirport={homeAirport}
          />

          <div className="pointer-events-none absolute inset-x-0 top-0 z-[500] flex items-start justify-between gap-2 p-2">
            <MapControls
              // One scrollable row rather than a wrapping block: at 400 px a second row of
              // controls costs ~45 px of map, and the map is the point of this tab.
              className="pointer-events-auto flex min-w-0 items-center gap-1.5 overflow-x-auto [scrollbar-width:none]"
              active={activeLayers}
              onChange={onLayersChange}
              region={regionRequest?.id ?? DEFAULT_REGION_ID}
              onRegion={onRegion}
              starlinkAvailable={starlinkAvailable}
              refreshing={feed.refreshing}
              onRefresh={feed.refresh}
            />
            {!desktop ? (
              <Button
                size="sm"
                variant="outline"
                className="pointer-events-auto min-h-11 bg-background text-xs"
                onClick={() => setSidebarOpen(true)}
              >
                <SlidersHorizontal aria-hidden="true" /> Filters
              </Button>
            ) : null}
          </div>

          {/* The map key replaces the old desktop-only "Starlink-equipped" chip. Bottom-left:
              Leaflet's zoom and attribution controls own the bottom-right corner. */}
          <MapLegend
            className="pointer-events-none absolute bottom-2 left-2 z-[500]"
            longhaulLayer={layers.includes('longhaul')}
            starlinkLayer={starlinkHighlight}
          />

          {/* The overlay appears only when the feed has NEVER produced flights: one failed
              poll against three-minute-old data must not blank a working map. */}
          {feed.failed ? (
            <div className="absolute inset-0 z-[600] flex flex-col items-center justify-center gap-3 bg-background/95 p-6 text-center">
              <p className="text-sm font-medium">Live flight feed unavailable</p>
              <p className="text-xs text-muted-foreground">
                Retrying automatically{feed.countdown !== null ? ` in ${feed.countdown}s` : ''}…
              </p>
              <Button size="sm" variant="outline" onClick={feed.refresh}>
                Retry now
              </Button>
            </div>
          ) : null}
        </div>

        {desktop ? (
          <aside className="hidden w-80 shrink-0 overflow-hidden border-l bg-background p-3 lg:block">
            {sidebar}
          </aside>
        ) : (
          <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
            <SheetContent
              side="bottom"
              className="data-[side=bottom]:h-[80vh]"
              // Radix focuses the first tabbable element on open, which is the search input:
              // on a phone that raises the soft keyboard over the sheet the visitor opened to
              // tap filters. Focus the sheet itself instead — still inside the focus trap,
              // announced by its title, no keyboard.
              onOpenAutoFocus={focusContentOnOpen}
            >
              <SheetHeader>
                <SheetTitle>Filters</SheetTitle>
              </SheetHeader>
              <div className="min-h-0 flex-1 overflow-hidden px-4 pb-4">{sidebar}</div>
            </SheetContent>
          </Sheet>
        )}
      </div>

      <StatsBar stats={stats} />
    </div>
  );
}
