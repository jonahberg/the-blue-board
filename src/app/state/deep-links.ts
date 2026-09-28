/**
 * URL → dashboard state, on first load and on every hash change.
 *
 * The whole published deep-link surface (inventory §16) lands here so no view has to parse
 * the query string for itself:
 *   #live #myflight #schedule #fleet #starlink #weather #stats #sources
 *   ?tab=…            including the `irops` alias → Weather, scrolled to the IROPS section
 *   ?flight= / ?q=    open the flight sheet, or offer a schedule lookup when not airborne
 *   ?hub=             selects that schedule board; with no ?tab (or ?tab=live) it is ALSO the
 *                     Live map's hub filter — `readLiveHubDeepLink()`, read by the Live view
 *                     (the hub pages' "Live <HUB> Map" CTA, F13/F45)
 *   ?view=starlink    the Starlink tab (its airborne/special siblings are Fleet-tab filters)
 *   ?aircraft=        opens the aircraft dialog
 *   ?waitlist=1       opens the waitlist dialog
 *
 * `?flight=` is LATCHED rather than applied once: on a cold load the feed has not answered
 * yet, so matching against an empty flight list would silently drop the link. The effect
 * re-runs on each poll and resolves the first time the feed is non-empty — and only then
 * decides between "select this aircraft" and "offer a lookup".
 */

import { useEffect, useRef } from 'react';

import { FR24_LOOKUP_AVAILABLE } from '../features/Fr24LookupDialog';
import { resolveTabParam } from '../tabs';
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
};

/** The Fleet tab's slice of the query string. */
export type FleetDeepLinks = {
  /** `?type=` or `?filter=` — a status shortcut or an aircraft type, resolved by the view. */
  filter: string | null;
  /** `?view=airborne|special` — a Fleet sub-view. `?view=starlink` is tab routing, above. */
  view: 'airborne' | 'special' | null;
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
  const params = new URLSearchParams(window.location.search);
  const view = params.get('view')?.toLowerCase();
  return {
    filter: params.get('type') ?? params.get('filter'),
    view: view === 'airborne' || view === 'special' ? view : null,
  };
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

/** Query parameters that name a specific destination inside the dashboard. */
const DEEP_LINK_PARAMS = ['tab', 'hub', 'flight', 'q', 'aircraft', 'view', 'filter', 'type', 'waitlist'];

/**
 * True when the visitor arrived on a deep link. The first-visit welcome overlay should not
 * open on top of the view the link was sent for (F45) — the arrival already has a purpose.
 */
export function isDeepLinkArrival(): boolean {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  return DEEP_LINK_PARAMS.some((key) => params.has(key));
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

    const tabParam = params.get('tab');
    const resolved = resolveTabParam(tabParam);
    if (resolved) {
      // `?tab=irops` means the Weather tab scrolled to its IROPS section.
      depsRef.current.setTab(
        resolved,
        tabParam?.toLowerCase() === 'irops' ? { scrollTo: 'irops-section' } : undefined,
      );
    }

    const hub = params.get('hub');
    if (hub) {
      depsRef.current.setScheduleHub(hub.toUpperCase());
      if (resolved === 'schedule') depsRef.current.setTab('schedule');
    }

    // ?view=starlink is tab routing and belongs here. ?view=airborne|special and
    // ?type=/?filter= select rows INSIDE the Fleet tab: the Fleet view reads those itself
    // through `readFleetDeepLinks()`, once its database has actually loaded.
    if (params.get('view')?.toLowerCase() === 'starlink') depsRef.current.setTab('starlink');

    const aircraft = params.get('aircraft');
    if (aircraft) depsRef.current.openAircraft(aircraft.toUpperCase());

    if (params.get('waitlist') === '1') depsRef.current.setWaitlistOpen(true);
    // Deliberately mount-only: re-reading the URL later would fight the user's own tabbing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The hash is the one deep link that can change under us (back button, in-page anchor).
  useEffect(() => {
    function onHashChange() {
      const resolved = resolveTabParam(window.location.hash);
      if (resolved) depsRef.current.setTab(resolved, { hash: false });
    }
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

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
