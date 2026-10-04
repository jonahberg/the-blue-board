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

import { Suspense, lazy, useCallback, useEffect, useState } from 'react';

import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { TooltipProvider } from '@/components/ui/tooltip';
import BmacToast from './features/BmacToast';
import LegalPopover from './features/LegalPopover';
import NewsBanner from './features/NewsBanner';
import TipStrip from './features/TipStrip';
import WaitlistStrip from './features/WaitlistStrip';
import { Attribution } from './shell/Attribution';
import { ErrorBoundary } from './shell/ErrorBoundary';
import { Header } from './shell/Header';
import { HubHealthStrip } from './shell/HubHealthStrip';
import { IropsAnnouncer } from './shell/IropsAnnouncer';
import { MobileNav } from './shell/MobileNav';
import { OfflineBanner } from './shell/OfflineBanner';
import { TabBar } from './shell/TabBar';
import { WatchBanner } from './shell/WatchBanner';
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

// Overlays nobody sees at first paint are split out of the Dashboard chunk that gates the
// map: the ⌘K palette (and cmdk with it), the flight sheet, and the root dialogs. Each mounts
// as soon as its chunk arrives — well before anyone can click a plane or press ⌘K — and the
// waitlist/onboarding triggers run from their own mount as before.
const AircraftDetailDialog = lazy(() => import('./features/AircraftDetailDialog'));
const DelayExplainDialog = lazy(() => import('./features/DelayExplainDialog'));
const DisclaimerDialog = lazy(() => import('./features/DisclaimerDialog'));
const Fr24LookupDialog = lazy(() => import('./features/Fr24LookupDialog'));
const Onboarding = lazy(() => import('./features/Onboarding'));
const WaitlistDialog = lazy(() => import('./features/WaitlistDialog'));
const FlightSheet = lazy(() =>
  import('./features/FlightSheet').then((m) => ({ default: m.FlightSheet })),
);
const SearchPalette = lazy(() =>
  import('./features/SearchPalette').then((m) => ({ default: m.SearchPalette })),
);

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
  const {
    tab,
    setTab,
    select,
    openAircraft,
    openFr24,
    setWaitlistOpen,
    setOnboardingOpen,
    setSearchOpen,
    announce,
  } = useUi();
  const { flights } = useFeed();
  const { setCurrent, watchAlert, clearWatchAlert } = useSchedule();
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
    announce,
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
      <Header
        onOpenWatch={() => setWatchOpen(true)}
        watchOpen={watchOpen}
        onOpenHelp={() => setOnboardingOpen(true)}
      />
      <Ticker />
      <HubHealthStrip />
      {/* Relocated from inside ScheduleView: a watched flight can change status while the
          viewer is on any tab, and the banner has to be where they are. */}
      <WatchBanner alert={watchAlert} onDismiss={clearWatchAlert} />

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
            // `relative` makes the panel the containing block for absolutely positioned
            // descendants (Tailwind `sr-only` captions/cells in the Stats and Starlink tables);
            // without it they escaped the scroller and made the whole page scrollable.
            className="relative min-h-0 flex-1 overflow-y-auto data-[state=inactive]:hidden"
          >
            <ErrorBoundary scope="This tab">
              <Suspense fallback={<ViewSkeleton />}>
                <View />
              </Suspense>
            </ErrorBoundary>
          </TabsContent>
        ))}
      </Tabs>

      {/* The engagement slot. Both strips appear late — the news after an idle-time fetch,
          the tip after two seconds — so they go BELOW the panel: an insertion here shrinks
          the panel from its bottom edge and moves nothing the visitor is looking at, where
          the old above-the-header placement shoved the whole dashboard down mid-load (CLS
          0.11 on a phone). It also keeps the fixed chrome above the content to the header,
          the ticker and the hub strip.

          On a phone the slot shows ONE line at a time, the first one present in this order:
          the waitlist strip (once its triggers fire), the news, the tip. Three stacked lines
          were ~100 px of a 780 px screen (audit Oct 3 2026); the others wait their turn and
          come back as the one above is dismissed. A tablet or desktop shows all of them. */}
      <div className="flex shrink-0 flex-col max-md:[&>*~*]:hidden">
        <WaitlistStrip />
        <NewsBanner />
        <TipStrip />
      </div>
      <Attribution />
      <MobileNav tab={tab} onSelect={(id) => setTab(id)} onOpenHelp={() => setOnboardingOpen(true)} />

      <Suspense fallback={null}>
        <FlightSheet />
        <SearchPalette />
      </Suspense>
      <WatchPanel open={watchOpen} onOpenChange={setWatchOpen} />
      <Suspense fallback={null}>
        <AircraftDetailDialog />
        <DelayExplainDialog />
        <Fr24LookupDialog />
        <Onboarding />
        <WaitlistDialog />
        <DisclaimerDialog />
      </Suspense>
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
      <ErrorBoundary scope="The dashboard">
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
      </ErrorBoundary>
    </TooltipProvider>
  );
}
