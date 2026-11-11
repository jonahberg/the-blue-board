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
import { BriefSidebarPanel } from '../features/BriefPanel';
import { AskChips } from '../features/AskChips';
import { cn } from '@/lib/utils';
import { AirborneHistoryDialog, useAirborneHistory } from './live/AirborneHistory';
import { LiveSidebar } from './live/LiveSidebar';
import { ICON_ONLY, LABEL, MAP_BUTTON, MapControls } from './live/MapControls';
import type { LayerKey } from './live/MapControls';
import { MapLegend } from './live/MapLegend';
import { AirborneChip, StatsBar } from './live/StatsBar';
import type { LiveStats } from './live/stats';
import { makeIsStarlinkFlight } from './live/starlink-match';
import { useAskLive } from './live/useAskLive';

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
  // The 24-hour airborne graph: one poll and one dialog, behind the map chip and the stat bar.
  const airborneHistory = useAirborneHistory();
  const [graphOpen, setGraphOpen] = useState(false);

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

  // "Ask the board" (⌘K): sets the controls above where they exist; `ask.apply` filters the rest.
  const ask = useAskLive({
    hubFilter,
    setHubFilter,
    setPhaseFilter,
    starlinkFilter,
    setStarlinkFilter,
    regionId: regionRequest?.id ?? null,
    onRegion,
    isStarlink: isStarlinkFlight,
  });

  // The lib modules are JSDoc'd against `Object` (they predate this TSX layer and stay
  // framework-free), so the callbacks are widened here rather than loosening the modules.
  const filtered = useMemo(
    () =>
      ask.apply(
        filterLiveFlights(
          feed.flights,
          { hub: hubFilter, phaseGroup: phaseFilter, starlinkOnly: false },
          { hubs: HUB_AIRPORTS, isStarlink: isStarlinkFlight as LibPredicate },
        ) as Flight[],
      ),
    [feed.flights, hubFilter, phaseFilter, isStarlinkFlight, ask.apply],
  );

  const stats = useMemo(
    () =>
      // The same predicate as the Starlink filter, so the stat and the filtered map agree.
      computeLiveStats(feed.flights, filtered, fleetDb.length, isStarlinkFlight as LibPredicate, {
        matchAircraft: ((f: Flight) => matchAircraft(f, fleetByReg)) as LibMatcher,
        isFiltered: Boolean(hubFilter || phaseFilter || ask.active),
      }) as LiveStats,
    [feed.flights, filtered, fleetDb.length, isStarlinkFlight, fleetByReg, hubFilter, phaseFilter, ask.active],
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
    ask.clear();
  }, [setStarlinkFilter, ask.clear]);

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
      // The brief sits open in the desktop sidebar only; below `lg` the header row opens it
      // as a sheet, and the phone Filters sheet stays filters.
      lead={desktop ? <BriefSidebarPanel /> : null}
    />
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <AskChips
        view="live"
        count={feed.lastGoodTs ? filtered.length : null}
        singular="flight"
        where="on the map"
        onRemove={ask.onRemove}
        onClear={ask.onClear}
        className="shrink-0 border-b bg-background px-2 py-1"
      />
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
              // One row rather than a wrapping block: at 400 px a second row of controls costs
              // ~45 px of map, and the map is the point of this tab. It scrolls only if a long
              // region name overflows it; `p-1 -m-1` keeps the 44 px hit boxes inside the
              // scroller's clip (shell/touch-target).
              className="pointer-events-auto -m-1 flex min-w-0 items-center gap-2 overflow-x-auto p-1 [scrollbar-width:none]"
              active={activeLayers}
              onChange={onLayersChange}
              region={regionRequest?.id ?? DEFAULT_REGION_ID}
              onRegion={onRegion}
              starlinkAvailable={starlinkAvailable}
              refreshing={feed.refreshing}
              onRefresh={feed.refresh}
            />
            {/* Pinned outside the scroller, so nothing can slide under it. An icon on a phone
                (below `sm`, or on its side), like the layer toggles, with its name kept for
                assistive tech. */}
            {!desktop ? (
              <Button
                variant="outline"
                className={cn(MAP_BUTTON, 'pointer-events-auto shrink-0 gap-1.5 px-2.5', ICON_ONLY)}
                onClick={() => setSidebarOpen(true)}
              >
                <SlidersHorizontal aria-hidden="true" /> <span className={LABEL}>Filters</span>
              </Button>
            ) : null}
          </div>

          {/* Bottom-left: the map key and, below 1081 px, the airborne count with its 24-hour
              sparkline (Nov 2026: it was a 45 px row under the map). Leaflet's attribution owns
              the bottom-right corner, and its zoom buttons too wherever the pointer is fine.
              Below `sm` the pair sits one attribution line higher: on a 375 px map the chip
              reached the start of the OpenStreetMap/CARTO credit, which must stay legible. */}
          {/* The map key replaces the old desktop-only "Starlink-equipped" chip. */}
          <MapLegend
            className="pointer-events-none absolute bottom-2 left-2 z-[500] max-sm:bottom-6"
            longhaulLayer={layers.includes('longhaul')}
            starlinkLayer={starlinkHighlight}
            hubsLayer={layers.includes('hubs')}
            aside={
              <AirborneChip
                className="pointer-events-auto min-[1081px]:hidden"
                airborne={stats.airborneAll}
                history={airborneHistory.data}
                onOpen={() => setGraphOpen(true)}
              />
            }
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

      <StatsBar stats={stats} history={airborneHistory.data} onOpenGraph={() => setGraphOpen(true)} />
      {/* One graph, opened from the map chip below 1081 px or the stat bar's "24h" above it. */}
      <AirborneHistoryDialog
        open={graphOpen}
        onOpenChange={setGraphOpen}
        history={airborneHistory}
        liveAirborne={stats.airborneAll}
        liveFresh={feed.freshness === 'live' && feed.flights.length > 0}
      />
    </div>
  );
}
