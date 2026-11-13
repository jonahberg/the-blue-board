/**
 * URL → dashboard state, on first load. A later hash change (Back, Forward, an in-page `#tab`
 * anchor) is `FollowProvider`'s (follow-link.tsx): one listener shows the tab, announces it and
 * moves focus.
 *
 * The whole published deep-link surface (inventory §16) lands here so no view has to parse
 * the query string for itself:
 *   #live #myflight #schedule #fleet #starlink #weather #stats #sources
 *   ?tab=…            including the `irops` alias → Weather, scrolled to the IROPS section
 *   ?tab=weather&hub= Weather, scrolled to that hub's card (the brief's FAA/weather chips)
 *   ?tab=weather&section=nas   Weather, scrolled to the NAS status panel (FAA plan chips)
 *   ?flight= / ?q=    open the flight sheet, or offer a schedule lookup when not airborne
 *   ?hub=             selects that schedule board (not with ?tab=weather, where it names a Weather
 *                     card); with no ?tab (or ?tab=live) it is ALSO the
 *                     Live map's hub filter — `readLiveHubDeepLink()`, read by the Live view
 *                     (the hub pages' "Live <HUB> Map" CTA, F13/F45)
 *   ?view=starlink    the Starlink tab (its airborne/special/express siblings are Fleet-tab sub-views)
 *   ?aircraft=        opens the aircraft dialog
 *   ?waitlist=1       opens the waitlist dialog
 *   ?watch=UA929      watches that flight (the flight page's "Watch this flight"), through the
 *                     eye buttons' own add path, opens My Flights and leaves the address bar
 *                     without it (`&route=` / `&dep=` pin the leg; src/lib/watch-link.js)
 *
 * `?flight=` is LATCHED rather than applied once: on a cold load the feed has not answered
 * yet, so matching against an empty flight list would silently drop the link. The effect
 * re-runs on each poll and resolves the first time the feed is non-empty — and only then
 * decides between "select this aircraft" and "offer a lookup".
 */

import { useEffect, useRef } from 'react';

import { fleetDeepLinksFrom as readFleetParams } from '@/lib/fleet-address.js';
import { DEEP_LINK_PARAMS } from '@/lib/followed-link.js';
import { hubLink } from '@/lib/hub-link.js';
import { hashTailParams, weatherScrollTarget } from '@/lib/tab-hash.js';
import { parseWatchLink, withoutWatchParams } from '@/lib/watch-link.js';
import { FR24_LOOKUP_AVAILABLE } from '../features/Fr24LookupDialog';
import { resolveTabParam } from '../tabs';
import type { TabId } from '../tabs';
import type { Flight } from '../data/types';

type DeepLinkDeps = {
  flights: Flight[];
  setTab: (id: ReturnType<typeof resolveTabParam> & string, options?: { hash?: boolean; scrollTo?: string }) => void;
  select: (selection: { kind: 'flight'; flight: Flight } | { kind: 'ident'; ident: string }) => void;
  openAircraft: (reg: string) => void;
  openFr24: (query: string) => void;
  setWaitlistOpen: (open: boolean) => void;
  setScheduleHub: (hub: string) => void;
  announce: (text: string) => void;
  /** `WatchValue.add`: adds unless already watched; true when it added. */
  addWatch: (flight: string, route: string, status: string, dep: number) => boolean;
};

/** The Fleet tab's slice of the query string. */
export type FleetDeepLinks = {
  /** `?type=` or `?filter=` — a status shortcut or an aircraft type, resolved by the view. */
  filter: string | null;
  /**
   * `?view=airborne|special|express` — a Fleet sub-view (`express` is the United Express list).
   * `?view=starlink` is tab routing, above.
   */
  view: 'airborne' | 'special' | 'express' | null;
};

/**
 * Read the Fleet tab's deep links straight off the URL.
 *
 * These three parameters name rows INSIDE the Fleet tab, and only the Fleet view knows
 * which filter values its controls actually offer and when the fleet database has arrived
 * — so the view reads them itself rather than being pushed a value it cannot yet apply.
 * Safe to call on any render: it is a pure read of `window.location.search`.
 */
export function readFleetDeepLinks(): FleetDeepLinks {
  if (typeof window === 'undefined') return { filter: null, view: null };
  return fleetDeepLinksFrom(new URLSearchParams(window.location.search));
}

/**
 * The Fleet tab's slice of a query string; one reading for a cold load and an in-place link
 * (`src/lib/fleet-address.js`, which the UI store also reads at startup).
 */
function fleetDeepLinksFrom(params: URLSearchParams): FleetDeepLinks {
  return readFleetParams(params) as FleetDeepLinks;
}

/**
 * The Live map's hub from `?hub=`, when the link is for the Live view (no `?tab`, or
 * `?tab=live`). Validated against the hubs the map knows, so `?hub=xyz` is ignored rather than
 * filtering the map to nothing. The Live view seeds its hub filter with this and centres on
 * the hub — like `readFleetDeepLinks()`, a pure read the owning view does itself.
 */
export function readLiveHubDeepLink(knownHubs: readonly string[]): string | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const hub = params.get('hub')?.trim().toUpperCase();
  if (!hub || !knownHubs.includes(hub)) return null;
  const tab = resolveTabParam(params.get('tab'));
  return !tab || tab === 'live' ? hub : null;
}

/**
 * True when the visitor arrived on a deep link. The first-visit welcome overlay should not
 * open on top of the view the link was sent for (F45) — the arrival already has a purpose.
 */
export function isDeepLinkArrival(): boolean {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  return DEEP_LINK_PARAMS.some((key) => params.has(key));
}

/** Where an in-dashboard link goes. */
export type DeepLinkIntent = {
  /** The tab to show; null for an overlay link (`?aircraft=`) that keeps the current tab. */
  tab: TabId | null;
  /** The element to scroll to on the Weather tab. */
  scrollTo: string | null;
  /** The Schedule board to select: only on the Schedule tab, and only one of the nine hubs. */
  scheduleHub: string | null;
  /** The registration whose aircraft dialog opens, upper-cased. */
  aircraft: string | null;
  /** The Fleet view's filter and sub-view: only on the Fleet tab, and only when one is named. */
  fleet: FleetDeepLinks | null;
};

const SITE_ORIGIN = 'https://theblueboard.co';

/**
 * Resolve a dashboard href (`/?tab=schedule&hub=ORD`, `/?tab=weather&hub=EWR`, `/#live`,
 * `/?aircraft=N78501`, `/?tab=fleet&type=737%20MAX%209`) the way a cold load of that URL would, so
 * a link clicked in place and the same link opened in a new tab land in the same spot.
 *
 * Null — the link then loads like any other — when the href is not the dashboard's (another
 * origin, or a path other than `/`: a flight, hub or fleet page is a page load), when it names
 * nothing an intent carries (`/`, a UTM-only link), and when a cold load would apply more of it
 * than an intent can carry (`carriesMoreThanAnIntent`), so following it in place never
 * half-applies it.
 */
export function resolveDeepLink(href: string): DeepLinkIntent | null {
  let url: URL;
  try {
    url = new URL(href, SITE_ORIGIN);
  } catch {
    return null;
  }
  if (url.origin !== SITE_ORIGIN || url.pathname !== '/') return null;
  // A cold load first moves parameters trapped after the '#' into the query, existing keys
  // winning (`canonicalizeHashParams`, called by `initialTab` in ui.tsx), so they count here too.
  const params = new URLSearchParams(url.search);
  for (const [key, value] of new URLSearchParams(hashTailParams(url.hash))) {
    if (!params.has(key)) params.set(key, value);
  }

  // Same precedence as `useDeepLinks`: ?view=starlink is applied after ?tab=, and both after the
  // hash the dashboard opened on.
  const tab =
    (params.get('view')?.toLowerCase() === 'starlink' ? 'starlink' : null) ??
    resolveTabParam(params.get('tab')) ??
    resolveTabParam(url.hash);
  const aircraft = params.get('aircraft')?.trim().toUpperCase() || null;
  if (!tab && !aircraft) return null;
  if (carriesMoreThanAnIntent(params, tab)) return null;

  const fleet = tab === 'fleet' ? fleetDeepLinksFrom(params) : null;
  return {
    tab,
    // `weatherScrollTarget` reads the raw ?tab=; the target belongs to the tab actually shown.
    scrollTo: tab === 'weather' ? weatherScrollTarget(params) : null,
    scheduleHub: tab === 'schedule' ? (hubLink(params.get('hub'), 'dashboard')?.code ?? null) : null,
    aircraft,
    fleet: fleet && (fleet.filter || fleet.view) ? fleet : null,
  };
}

/**
 * True when the query names something a cold load acts on (`useDeepLinks`, the views' own reads)
 * that an intent for `tab` cannot carry: the flight sheet, the watch list, the waitlist dialog, a
 * Weather section off the Weather tab, a hub that is neither a Schedule board nor a Weather card
 * (with no tab or on Live it is the Live map's hub filter, `readLiveHubDeepLink`), and the Fleet
 * view's filter or sub-view off the Fleet tab (the Fleet view reads those whenever it mounts).
 * Parameters that name nothing in the dashboard (`utm_*`) are ignored, as on a cold load.
 */
function carriesMoreThanAnIntent(params: URLSearchParams, tab: TabId | null): boolean {
  if (['flight', 'q', 'watch', 'waitlist'].some((key) => params.has(key))) return true;
  if (params.has('section') && tab !== 'weather') return true;
  if (params.has('hub') && tab !== 'schedule' && tab !== 'weather') return true;
  const view = params.get('view')?.toLowerCase();
  const fleetParam = params.has('type') || params.has('filter') || (view !== undefined && view !== 'starlink');
  return fleetParam && tab !== 'fleet';
}

/** 'UAL123' / 'ua 123' / '123' → 'UA123'. */
function normalizeIdent(raw: string): string {
  const value = raw.trim().toUpperCase().replace(/\s+/g, '');
  if (/^\d{1,4}$/.test(value)) return `UA${value}`;
  return value.replace(/^UAL/, 'UA');
}

export function useDeepLinks(deps: DeepLinkDeps) {
  const { flights, setTab, select, openAircraft, openFr24, setWaitlistOpen, setScheduleHub, announce } =
    deps;
  const depsRef = useRef(deps);
  depsRef.current = deps;
  const flightLatched = useRef(false);
  const onceApplied = useRef(false);

  // Everything except ?flight= applies exactly once, on mount.
  useEffect(() => {
    if (onceApplied.current || typeof window === 'undefined') return;
    onceApplied.current = true;
    const params = new URLSearchParams(window.location.search);

    const resolved = resolveTabParam(params.get('tab'));
    if (resolved) {
      // `?tab=irops` means the Weather tab scrolled to its IROPS section; `?tab=weather&hub=` to
      // that hub's card; `?tab=weather&section=nas` to the NAS panel (one resolver, shared with
      // the brief's chips: `resolveDeepLink` below).
      const scrollTo = weatherScrollTarget(params);
      depsRef.current.setTab(resolved, scrollTo ? { scrollTo } : undefined);
    }

    // `?hub=` picks the Schedule board: with `?tab=schedule`, alone, with `?tab=irops` (the hub
    // pages' "IROPS Monitor" link). Not with `?tab=weather`, where the hub names a Weather card
    // (`hubStatusLink`, the brief's chips): a click on that link leaves the board the reader chose
    // (`resolveDeepLink`), so the same address opened cold does too (Nov 12 2026 review).
    const hub = params.get('hub');
    const weatherCard = String(params.get('tab') ?? '').trim().toLowerCase() === 'weather';
    if (hub && !weatherCard) {
      depsRef.current.setScheduleHub(hub.toUpperCase());
      if (resolved === 'schedule') depsRef.current.setTab('schedule');
    }

    // ?view=starlink is tab routing and belongs here. ?view=airborne|special|express and
    // ?type=/?filter= select rows INSIDE the Fleet tab: the Fleet view reads those itself
    // through `readFleetDeepLinks()`, once its database has actually loaded.
    if (params.get('view')?.toLowerCase() === 'starlink') depsRef.current.setTab('starlink');

    const aircraft = params.get('aircraft');
    if (aircraft) depsRef.current.openAircraft(aircraft.toUpperCase());

    if (params.get('waitlist') === '1') depsRef.current.setWaitlistOpen(true);

    // ?watch=UA929 — last, so it decides the tab. The parameters leave the address bar either
    // way: a reload or a copied link must not re-add a flight the visitor has since removed.
    if (params.has('watch')) {
      const watch = parseWatchLink(params, Math.floor(Date.now() / 1000));
      const clean = withoutWatchParams(window.location);
      if (clean) window.history.replaceState(window.history.state, '', clean);
      if (watch) {
        const added = depsRef.current.addWatch(watch.flight, watch.route, '', watch.dep);
        depsRef.current.setTab('myflight');
        depsRef.current.announce(added ? `Watching ${watch.flight}` : `${watch.flight} is already on your watch list`);
      }
    }
    // Deliberately mount-only: re-reading the URL later would fight the user's own tabbing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The hash is the one deep link that can change under us (an in-page anchor, Back or Forward
  // across the entry a followed link leaves). It is not heard here: `FollowProvider` owns that move
  // with a single listener, because a second listener would run after the tab change had already
  // committed (follow-link.tsx).

  // ?flight= / ?q= — latched until the feed has actually answered.
  useEffect(() => {
    if (flightLatched.current || flights.length === 0 || typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const raw = params.get('flight') ?? params.get('q');
    if (!raw) {
      flightLatched.current = true;
      return;
    }
    flightLatched.current = true;
    const ident = normalizeIdent(raw);
    const match = flights.find((f) => {
      const iata = (f.flightIATA || '').toUpperCase();
      const callsign = (f.callsign || '').toUpperCase();
      return (
        iata === ident ||
        callsign === ident ||
        callsign === ident.replace(/^UA/, 'UAL') ||
        f.reg.toUpperCase() === ident
      );
    });
    if (match) depsRef.current.select({ kind: 'flight', flight: match });
    // Not airborne. Say so rather than opening a lookup that cannot answer yet.
    else if (FR24_LOOKUP_AVAILABLE) depsRef.current.openFr24(ident);
    else depsRef.current.announce(`${ident} is not in the live feed right now. Flight lookup is not available yet.`);
  }, [flights]);
}
