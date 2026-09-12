/**
 * URL → dashboard state, on first load and on every hash change.
 *
 * The whole published deep-link surface (inventory §16) lands here so no view has to parse
 * the query string for itself:
 *   #live #myflight #schedule #fleet #starlink #weather #stats #sources
 *   ?tab=…            including the `irops` alias → Weather, scrolled to the IROPS section
 *   ?flight= / ?q=    open the flight sheet, or offer a schedule lookup when not airborne
 *   ?hub=             with ?tab=schedule, selects that board
 *   ?aircraft=        opens the aircraft dialog
 *   ?waitlist=1       opens the waitlist dialog
 *
 * `?flight=` is LATCHED rather than applied once: on a cold load the feed has not answered
 * yet, so matching against an empty flight list would silently drop the link. The effect
 * re-runs on each poll and resolves the first time the feed is non-empty — and only then
 * decides between "select this aircraft" and "offer a lookup".
 */

import { useEffect, useRef } from 'react';

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
};

/** 'UAL123' / 'ua 123' / '123' → 'UA123'. */
function normalizeIdent(raw: string): string {
  const value = raw.trim().toUpperCase().replace(/\s+/g, '');
  if (/^\d{1,4}$/.test(value)) return `UA${value}`;
  return value.replace(/^UAL/, 'UA');
}

export function useDeepLinks(deps: DeepLinkDeps) {
  const { flights, setTab, select, openAircraft, openFr24, setWaitlistOpen, setScheduleHub } = deps;
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
    else depsRef.current.openFr24(ident);
  }, [flights]);
}
