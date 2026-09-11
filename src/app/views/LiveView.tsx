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

import { useCallback, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { computeLiveStats } from '@/lib/live-stats.js';
import { filterLiveFlights } from '@/lib/live-filters.js';
import { matchAircraft } from '@/lib/fleet-match.js';
import { HUB_ORDER } from '@/lib/hub-health.js';
import { AIRPORTS } from '@/lib/airports.js';
import { LiveMap } from '../map/LiveMap';
import type { Flight } from '../data/types';
import { useFeed } from '../state/feed';
import { useFleet } from '../state/fleet';
import { useMediaQuery } from '../state/hooks';
import { usePrefs } from '../state/prefs';
import { useUi } from '../state/ui';
import { useWatch } from '../state/watch';
import { LiveSidebar } from './live/LiveSidebar';
import { MapControls } from './live/MapControls';
import type { LayerKey } from './live/MapControls';
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
  const { selection, select, focus, focusOn, setTab } = useUi();
  const watch = useWatch();

  const [layers, setLayers] = useState<LayerKey[]>(['hubs']);
  const [hubFilter, setHubFilter] = useState('');
  const [phaseFilter, setPhaseFilter] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const desktop = useMediaQuery('(min-width: 1024px)');

  const starlinkAvailable = starlink.tails.size > 0 && !starlink.degraded;
  const isStarlinkFlight = useMemo(
    () => makeIsStarlinkFlight(starlink.tails, fleetByReg),
    [starlink.tails, fleetByReg],
  );

  // A Starlink filter that survives the roster going away would hide the entire fleet.
  const starlinkOnly = layers.includes('starlink') && starlinkAvailable;

  // The lib modules are JSDoc'd against `Object` (they predate this TSX layer and stay
  // framework-free), so the callbacks are widened here rather than loosening the modules.
  const filtered = useMemo(
    () =>
      filterLiveFlights(
        feed.flights,
        { hub: hubFilter, phaseGroup: phaseFilter, starlinkOnly },
        { hubs: HUB_AIRPORTS, isStarlink: isStarlinkFlight as LibPredicate },
      ) as Flight[],
    [feed.flights, hubFilter, phaseFilter, starlinkOnly, isStarlinkFlight],
  );

  const stats = useMemo(
    () =>
      computeLiveStats(feed.flights, filtered, fleetDb.length, starlink.tails, {
        matchAircraft: ((f: Flight) => matchAircraft(f, fleetByReg)) as LibMatcher,
        isFiltered: Boolean(hubFilter || phaseFilter || starlinkOnly),
      }) as LiveStats,
    [feed.flights, filtered, fleetDb.length, starlink.tails, fleetByReg, hubFilter, phaseFilter, starlinkOnly],
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

  const clearFilters = useCallback(() => {
    setHubFilter('');
    setPhaseFilter('');
    setLayers((current) => current.filter((key) => key !== 'starlink'));
  }, []);

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
        <div className="relative isolate z-0 min-h-0 flex-1">
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
            }}
            view={layers.includes('pacific') ? 'pacific' : 'us'}
            homeAirport={homeAirport}
          />

          <div className="pointer-events-none absolute inset-x-0 top-0 z-[500] flex flex-wrap items-start justify-between gap-2 p-2">
            <MapControls
              className="pointer-events-auto flex flex-wrap items-center gap-1.5"
              active={layers}
              onChange={setLayers}
              starlinkAvailable={starlinkAvailable}
              refreshing={feed.refreshing}
              onRefresh={feed.refresh}
            />
            {!desktop ? (
              <Button
                size="sm"
                variant="outline"
                className="pointer-events-auto h-8 bg-background/90 text-xs backdrop-blur"
                onClick={() => setSidebarOpen(true)}
              >
                🔍 Filters
              </Button>
            ) : null}
          </div>

          {starlinkAvailable ? (
            <p className="pointer-events-none absolute bottom-2 left-2 z-[500] hidden rounded-md border bg-background/90 px-2 py-1 text-[11px] backdrop-blur md:block">
              <span
                className="mr-1.5 inline-block size-2 rounded-full align-middle"
                style={{ background: '#A78BFA' }}
                aria-hidden="true"
              />
              Starlink-equipped
            </p>
          ) : null}

          {/* The overlay appears only when the feed has NEVER produced flights: one failed
              poll against three-minute-old data must not blank a working map. */}
          {feed.failed ? (
            <div className="absolute inset-0 z-[600] flex flex-col items-center justify-center gap-3 bg-background/85 p-6 text-center backdrop-blur">
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
            <SheetContent side="bottom" className="data-[side=bottom]:h-[80vh]">
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
