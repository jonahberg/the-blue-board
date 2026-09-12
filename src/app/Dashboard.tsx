/**
 * The dashboard island's root.
 *
 * Mounted from `src/pages/index.astro` with `client:only="react"`: the page's crawlable
 * content is rendered by Astro at build time (see `src/lib/home-seo.js`), and this tree is
 * purely the interactive layer, so there is nothing to hydrate and no server/client markup
 * to keep in step.
 *
 * Every root-level surface is mounted here from day one, including the ones later work
 * packages fill in — they currently render nothing. That is what lets Task 3 through Task 8
 * each replace exactly one file under `views/` or `features/` without touching this root,
 * the tab registry or the state providers.
 *
 * Provider order is a dependency order, not a preference: `useHubHealth()` reads IROPS, the
 * ticker reads fleet + weather + hub health, and the deep-link handler reads the feed.
 */

import { Suspense, useCallback, useEffect, useState } from 'react';

import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { TooltipProvider } from '@/components/ui/tooltip';
import AircraftDetailDialog from './features/AircraftDetailDialog';
import BmacToast from './features/BmacToast';
import DelayExplainDialog from './features/DelayExplainDialog';
import DisclaimerDialog from './features/DisclaimerDialog';
import { FlightSheet } from './features/FlightSheet';
import Fr24LookupDialog from './features/Fr24LookupDialog';
import LegalPopover from './features/LegalPopover';
import NewsBanner from './features/NewsBanner';
import Onboarding from './features/Onboarding';
import { SearchPalette } from './features/SearchPalette';
import TipStrip from './features/TipStrip';
import WaitlistDialog from './features/WaitlistDialog';
import { Attribution } from './shell/Attribution';
import { Header } from './shell/Header';
import { HubHealthStrip } from './shell/HubHealthStrip';
import { IropsAnnouncer } from './shell/IropsAnnouncer';
import { MobileNav } from './shell/MobileNav';
import { OfflineBanner } from './shell/OfflineBanner';
import { TabBar } from './shell/TabBar';
import { Ticker } from './shell/Ticker';
import { WatchPanel } from './shell/WatchPanel';
import { useDeepLinks } from './state/deep-links';
import { FeedProvider, useFeed } from './state/feed';
import { FleetProvider } from './state/fleet';
import { IropsProvider } from './state/irops';
import { PrefsProvider, usePrefs } from './state/prefs';
import { ScheduleProvider, useSchedule } from './state/schedule';
import { UiProvider, useUi } from './state/ui';
import { WatchProvider } from './state/watch';
import { WeatherProvider } from './state/weather';
import { TABS } from './tabs';
import type { TabId } from './tabs';

/** What the tab area shows while a lazily-loaded view's chunk is in flight. */
function ViewSkeleton() {
  return (
    <div className="space-y-3 p-4 md:p-6">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}

function DashboardShell() {
  const { tab, setTab, select, openAircraft, openFr24, setWaitlistOpen, setOnboardingOpen, setSearchOpen } =
    useUi();
  const { flights } = useFeed();
  const { setCurrent } = useSchedule();
  const [watchOpen, setWatchOpen] = useState(false);
  // Views stay mounted once visited. Radix unmounts inactive TabsContent by default, which
  // would tear the Leaflet map down and rebuild it on every tab switch — losing the pan,
  // the zoom and a screenful of tiles. Lazily mounting on FIRST visit keeps the chunk
  // splitting: a visitor who never opens Starlink never downloads it.
  const [visited, setVisited] = useState<Set<TabId>>(() => new Set<TabId>([tab]));
  useEffect(() => {
    setVisited((current) => (current.has(tab) ? current : new Set(current).add(tab)));
  }, [tab]);

  useDeepLinks({
    flights,
    setTab,
    select,
    openAircraft,
    openFr24,
    setWaitlistOpen,
    setScheduleHub: useCallback((hub: string) => setCurrent({ hub }), [setCurrent]),
  });

  // ⌘K / Ctrl-K from anywhere. This has to be a window listener, not a React onKeyDown on
  // the root element: on a fresh load focus sits on <body>, which is OUTSIDE the React tree,
  // so a bubbling handler never sees the keystroke and the advertised shortcut does nothing.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearchOpen(true);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [setSearchOpen]);

  return (
    <div className="flex h-[100svh] flex-col bg-background text-foreground">
      <OfflineBanner />
      <NewsBanner />
      <Header
        onOpenWatch={() => setWatchOpen(true)}
        watchOpen={watchOpen}
        onOpenHelp={() => setOnboardingOpen(true)}
      />
      <Ticker />
      <HubHealthStrip />
      <TipStrip />

      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as TabId)}
        className="flex min-h-0 flex-1 flex-col gap-0"
      >
        <div className="hidden lg:block">
          <TabBar />
        </div>
        {TABS.filter(({ id }) => visited.has(id)).map(({ id, View }) => (
          <TabsContent
            key={id}
            value={id}
            forceMount
            className="min-h-0 flex-1 overflow-y-auto data-[state=inactive]:hidden"
          >
            <Suspense fallback={<ViewSkeleton />}>
              <View />
            </Suspense>
          </TabsContent>
        ))}
      </Tabs>

      <Attribution />
      <MobileNav tab={tab} onSelect={(id) => setTab(id)} />

      <FlightSheet />
      <SearchPalette />
      <WatchPanel open={watchOpen} onOpenChange={setWatchOpen} />
      <AircraftDetailDialog />
      <DelayExplainDialog />
      <Fr24LookupDialog />
      <Onboarding />
      <WaitlistDialog />
      <DisclaimerDialog />
      <LegalPopover />
      <BmacToast />
      <IropsAnnouncer />
    </div>
  );
}

/** Seeds the Schedule tab's default board from the viewer's home hub. */
function ShellWithPrefs() {
  const { homeAirport } = usePrefs();
  return (
    <ScheduleProvider defaultHub={homeAirport || 'ORD'}>
      <WeatherProvider>
        <DashboardShell />
      </WeatherProvider>
    </ScheduleProvider>
  );
}

export default function Dashboard() {
  return (
    <TooltipProvider delayDuration={200}>
      <UiProvider>
        <PrefsProvider>
          <FeedProvider>
            <FleetProvider>
              <WatchProvider>
                <IropsProvider>
                  <ShellWithPrefs />
                </IropsProvider>
              </WatchProvider>
            </FleetProvider>
          </FeedProvider>
        </PrefsProvider>
      </UiProvider>
    </TooltipProvider>
  );
}
