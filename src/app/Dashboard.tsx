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
import EmailPrompt from './features/EmailPrompt';
import LegalPopover from './features/LegalPopover';
import NewsBanner from './features/NewsBanner';
import SupportStrip from './features/SupportStrip';
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
import { BriefProvider } from './state/brief';
import { useDeepLinks } from './state/deep-links';
import { FeedProvider, useFeed } from './state/feed';
import { FleetProvider } from './state/fleet';
import { FollowProvider } from './state/follow-link';
import { IropsProvider } from './state/irops';
import { PrefsProvider, usePrefs } from './state/prefs';
import { ScheduleProvider, useSchedule } from './state/schedule';
import { UiProvider, useUi } from './state/ui';
import { WatchProvider, useWatch } from './state/watch';
import { WatchAlertsProvider, useWatchAlerts } from './state/watch-alerts';
import { WeatherProvider } from './state/weather';
import { TABS } from './tabs';
import type { TabId } from './tabs';

// Overlays nobody sees at first paint are split out of the Dashboard chunk that gates the
// map: the ⌘K palette (and cmdk with it), the flight sheet, and the root dialogs. Each mounts
// as soon as its chunk arrives — well before anyone can click a plane or press ⌘K. The
// "What is this dashboard?" dialog (`Onboarding`) only ever opens on request.
const AircraftDetailDialog = lazy(() => import('./features/AircraftDetailDialog'));
const DelayExplainDialog = lazy(() => import('./features/DelayExplainDialog'));
const DisclaimerDialog = lazy(() => import('./features/DisclaimerDialog'));
const Fr24LookupDialog = lazy(() => import('./features/Fr24LookupDialog'));
const Onboarding = lazy(() => import('./features/Onboarding'));
const WaitlistDialog = lazy(() => import('./features/WaitlistDialog'));
// The full brief as a sheet, opened from the header row (the row itself is in `shell/Ticker`).
const BriefSheet = lazy(() => import('./features/BriefSheet'));
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
  const { setCurrent } = useSchedule();
  const { alert: watchAlert, clearAlert: clearWatchAlert } = useWatchAlerts();
  const { add: addWatch } = useWatch();
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
    addWatch,
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
    // `viewport-fit=cover` (Seo.astro) lets the page run under a landscape iPhone's notch; the
    // side insets keep the chrome and the map's controls out from under it. The bottom inset is
    // the bottom nav's (MobileNav); `svh` is the height with Safari's toolbars showing.
    <div className="flex h-[100svh] flex-col bg-background pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)] text-foreground">
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

          The slot shows ONE line at a time, at every width, the first one present in this
          order: the "cover a day" support strip (the deep-use ask on the visits it is chosen),
          the waitlist strip (once its triggers fire, on visits when neither the support strip
          nor the email dialog is the ask), the news, the tip. The others wait their turn and
          come back as the one above is dismissed. Three stacked lines were ~100 px of a 780 px phone (audit
          Oct 3 2026), so phones got the rule first; on a 900 px desktop the news, the tip and
          the attribution were ~110 px under the map (Nov 2026), so it now holds everywhere.
          Components that have nothing to say render null, so `*~*` only ever hides a strip
          that is actually there.

          The news does not show on the phone Live tab (below `lg`, Nov 2026: "the amount of map
          you see is kind of small"). It stays mounted and is hidden by CSS, so the tip behind it
          keeps waiting rather than taking its 32 px; the support and waitlist strips, which
          come first, are unaffected. More → News reaches the stories from a phone. */}
      <div className="flex shrink-0 flex-col [&>*~*]:hidden">
        <SupportStrip />
        <WaitlistStrip />
        <NewsBanner className={tab === 'live' ? 'max-lg:hidden' : undefined} />
        <TipStrip />
      </div>
      <Attribution />
      <MobileNav tab={tab} onSelect={(id) => setTab(id)} onOpenHelp={() => setOnboardingOpen(true)} />

      <Suspense fallback={null}>
        <FlightSheet />
        <SearchPalette />
        <BriefSheet />
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
      {/* The deep-use asks: ONE per visit, on the email strip's trigger — the support strip
          in the slot above, or (EmailPrompt) the waitlist dialog, opened after a pause. */}
      <EmailPrompt />
      <IropsAnnouncer />
    </div>
  );
}

/**
 * Seeds the Schedule tab's default board from the viewer's home hub. `FollowProvider` (an
 * in-place link's `follow`) reads the UI and Schedule stores, so it sits just inside the second.
 */
function ShellWithPrefs() {
  const { homeAirport } = usePrefs();
  return (
    <ScheduleProvider defaultHub={homeAirport || 'ORD'}>
      <FollowProvider>
        <WeatherProvider>
          <DashboardShell />
        </WeatherProvider>
      </FollowProvider>
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
                  <WatchAlertsProvider>
                    <IropsProvider>
                      {/* The ops brief's one poll, read by the header row, the Live sidebar
                          and the brief sheet. */}
                      <BriefProvider>
                        <ShellWithPrefs />
                      </BriefProvider>
                    </IropsProvider>
                  </WatchAlertsProvider>
                </WatchProvider>
              </FleetProvider>
            </FeedProvider>
          </PrefsProvider>
        </UiProvider>
      </ErrorBoundary>
    </TooltipProvider>
  );
}
