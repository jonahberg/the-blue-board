/**
 * Cross-cutting UI state: which tab is showing, what is selected, where the map should look,
 * which root-level dialog is open, and the single polite announcer.
 *
 * Everything here is deliberately in ONE store because the deep-link handler, the search
 * palette, the map, the hub-health strip and every view need to drive the same few things.
 * Views own their own local state; this is only what crosses view boundaries.
 *
 * `announce()` writes to the one `role="status"` region on the page. The old dashboard had a
 * single writer for exactly this reason (inventory §17): several polite live regions fighting
 * each other is worse for a screen-reader user than one that speaks in turn.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { bmacEligible } from '@/lib/engagement.js';
import { DEFAULT_TAB, TAB_HASHES } from '../tabs';
import { safeLocalStorage } from './storage';
import { canonicalizeHashParams, cleanTabHash } from '@/lib/tab-hash.js';
import type { TabId } from '../tabs';
import type { Flight } from '../data/types';
import { fleetDeepLinksFrom } from '@/lib/fleet-address.js';
import type { FleetDeepLinks } from './deep-links';

/** What the flight sheet is showing: a live aircraft, or a flight number to look up. */
export type Selection =
  | { kind: 'flight'; flight: Flight }
  | { kind: 'ident'; ident: string }
  | null;

/** A map "look here" request. `key` makes repeated focuses on the same point distinct. */
export type MapFocus = { lat: number; lon: number; key: number } | null;

/**
 * A Fleet-tab link followed in place. `seq` counts follows, from 1, so a repeat is a change.
 *
 * `arriving`: true when the link came from another tab, so the Fleet view first puts itself back
 * where a cold load starts, then applies the link and scrolls to it; false when the Fleet tab was
 * already showing, so it applies only the filter or sub-view the link names and resets nothing
 * (the links plan, ruling 2). `at`: when it was followed (ms), so a link held for the fleet
 * database gives up on the same budget a cold load does.
 */
export type FleetLink = {
  filter: string | null;
  view: FleetDeepLinks['view'];
  seq: number;
  arriving: boolean;
  at: number;
};

/**
 * A hub link that ARRIVED at the Schedule tab from another tab (`useFollowDeepLink`), for the
 * Schedule view: on a new `seq` it clears its own status, type and search filters, so the board
 * the link opened lands as a cold load of `/?tab=schedule&hub=ORD` does (the links plan, ruling 9).
 * The board itself (hub, Departures, the hub's default day) is already set through the Schedule
 * store by the follow. A hub link followed while Schedule is showing changes the hub only and does
 * not bump this (ruling 2: the reader's direction, day and filters stay). Not consumed yet: the
 * Schedule view reads it from `useUi().scheduleLink` (links part 2, slice 2a).
 */
export type ScheduleLink = { hub: string; seq: number };

export type UiValue = {
  tab: TabId;
  setTab: (id: TabId, options?: { hash?: boolean; scrollTo?: string }) => void;
  /** Set when a tab change asked for a scroll target (e.g. `?tab=irops`). */
  pendingScroll: string | null;
  clearPendingScroll: () => void;

  selection: Selection;
  select: (selection: Selection) => void;

  focus: MapFocus;
  focusOn: (lat: number, lon: number) => void;

  /**
   * The Live map's Starlink-only filter. It lives here rather than in `LiveView` local state
   * because the Starlink tab's "● N AIRBORNE NOW" chip is a click-through that has to arrive
   * on Live with the filter already on (inventory §16/§22). Every other map layer stays local
   * to the view — this is the only one another tab drives.
   */
  starlinkFilter: boolean;
  setStarlinkFilter: (on: boolean) => void;

  /**
   * The last Fleet link followed in place (`/?tab=fleet&type=A319`, `useFollowDeepLink`). Only
   * the Fleet view knows which filters its controls offer and when the fleet database has
   * arrived, so this store only holds the request and the view applies it. It applies on each
   * new `seq`: the same link clicked twice, after the visitor has cleared the filter, applies twice.
   * `options.arriving` (default true) says whether the link came from another tab (`FleetLink`).
   */
  fleetLink: FleetLink | null;
  followFleetLink: (link: FleetDeepLinks, options?: { arriving?: boolean }) => void;

  /**
   * The Fleet tab's slice of the address the page was opened on (`?type=` / `?filter=` /
   * `?view=`), read once when the dashboard starts. The Fleet view applies it once its database
   * has loaded; it reads it here rather than from the address bar because a followed link to
   * another tab may have taken those parameters out of the address by then (`addressAfterFollow`).
   */
  coldFleetLink: FleetDeepLinks;

  /** The last hub link that arrived at the Schedule tab from another tab (`ScheduleLink`). */
  scheduleLink: ScheduleLink | null;
  followScheduleLink: (hub: string) => void;

  searchOpen: boolean;
  setSearchOpen: (open: boolean) => void;

  /** Root-level dialogs the later work packages fill in. */
  aircraftReg: string | null;
  openAircraft: (reg: string | null) => void;
  delayExplain: Record<string, unknown> | null;
  openDelayExplain: (context: Record<string, unknown> | null) => void;
  fr24Query: string | null;
  openFr24: (query: string | null) => void;
  waitlistOpen: boolean;
  setWaitlistOpen: (open: boolean) => void;
  /** The canopy's "?" reopens onboarding; `features/Onboarding.tsx` renders it. */
  onboardingOpen: boolean;
  setOnboardingOpen: (open: boolean) => void;
  /** The About / legal modal, opened from the legal popover's About and Disclaimer links. */
  disclaimerOpen: boolean;
  setDisclaimerOpen: (open: boolean) => void;

  /**
   * The "glad you landed" toast (inventory §12). The ident of the flight that landed, or
   * null. `showBmacToast()` owns the whole ask: the 14-day cooldown, the "already showing"
   * guard and the 3-second delay that keeps the thank-you from stepping on the status
   * change that earned it. Callers just say a flight landed.
   */
  bmacToast: string | null;
  showBmacToast: (ident: string) => void;
  dismissBmacToast: () => void;

  /**
   * The current text of the single polite live region. A sentence announced twice in a row ends
   * the second time with `ANNOUNCEMENT_REPEAT_MARK`, so the region changes and speaks it again.
   */
  announcement: string;
  announce: (text: string) => void;
};

/**
 * Appended to an announcement equal to the one before it, so the live region's text changes and
 * the sentence is spoken again; a zero-width space, which a screen reader does not read.
 */
export const ANNOUNCEMENT_REPEAT_MARK = '​';

/** Inventory §30: the landing toast appears three seconds after the flight lands. */
const BMAC_DELAY_MS = 3000;

const UiContext = createContext<UiValue | null>(null);

export function useUi(): UiValue {
  const ctx = useContext(UiContext);
  if (!ctx) throw new Error('useUi() outside <UiProvider>');
  return ctx;
}

/** The tab named by the URL hash on first paint, else Live. */
function initialTab(): TabId {
  if (typeof window === 'undefined') return DEFAULT_TAB;
  // Tolerate params after the '#' ('#fleet&utm_source=email…', the Oct 6 2026 email's links):
  // move them into the query so the URL is canonical, and match the tab on what precedes them.
  const canonical = canonicalizeHashParams(window.location);
  if (canonical) window.history.replaceState(null, '', canonical);
  const hash = cleanTabHash(window.location.hash);
  const match = (Object.keys(TAB_HASHES) as TabId[]).find((id) => TAB_HASHES[id] === hash);
  return match ?? DEFAULT_TAB;
}

/**
 * The Fleet tab's slice of the address the page was opened on (`coldFleetLink`). Read from the
 * lib rather than `readFleetDeepLinks` (deep-links.ts), whose imports reach the dialogs and through
 * them this store: a cycle that deadlocks a test mocking this module.
 */
function initialFleetLink(): FleetDeepLinks {
  if (typeof window === 'undefined') return { filter: null, view: null };
  return fleetDeepLinksFrom(new URLSearchParams(window.location.search)) as FleetDeepLinks;
}

export function UiProvider({ children }: { children: ReactNode }) {
  const [tab, setTabState] = useState<TabId>(initialTab);
  const [pendingScroll, setPendingScroll] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection>(null);
  const [focus, setFocus] = useState<MapFocus>(null);
  const [starlinkFilter, setStarlinkFilter] = useState(false);
  const [fleetLink, setFleetLink] = useState<FleetLink | null>(null);
  // After `initialTab`, which first moves parameters trapped after the '#' into the query.
  const [coldFleetLink] = useState<FleetDeepLinks>(initialFleetLink);
  const [scheduleLink, setScheduleLink] = useState<ScheduleLink | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [aircraftReg, setAircraftReg] = useState<string | null>(null);
  const [delayExplain, setDelayExplain] = useState<Record<string, unknown> | null>(null);
  const [fr24Query, setFr24Query] = useState<string | null>(null);
  const [waitlistOpen, setWaitlistOpen] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [disclaimerOpen, setDisclaimerOpen] = useState(false);
  const [bmacToast, setBmacToast] = useState<string | null>(null);
  const bmacTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bmacAsked = useRef(false);
  const [announcement, setAnnouncement] = useState('');
  const lastAnnouncement = useRef('');

  const setTab = useCallback(
    (id: TabId, options?: { hash?: boolean; scrollTo?: string }) => {
      setTabState(id);
      if (options?.scrollTo) setPendingScroll(options.scrollTo);
      // `replaceState`: the tab bar is navigation within one page and must not fill the visitor's
      // back button with eight entries. A followed link that changes the tab pushes its one entry
      // itself and calls this with `hash: false` (state/follow-link.tsx).
      if (options?.hash !== false && typeof window !== 'undefined') {
        window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${TAB_HASHES[id]}`);
      }
    },
    [],
  );

  const clearPendingScroll = useCallback(() => setPendingScroll(null), []);

  const followFleetLink = useCallback((link: FleetDeepLinks, options?: { arriving?: boolean }) => {
    const arriving = options?.arriving ?? true;
    const at = Date.now();
    setFleetLink((prev) => ({ filter: link.filter, view: link.view, seq: (prev?.seq ?? 0) + 1, arriving, at }));
  }, []);

  const followScheduleLink = useCallback((hub: string) => {
    setScheduleLink((prev) => ({ hub, seq: (prev?.seq ?? 0) + 1 }));
  }, []);

  // Centring the map means showing it: every caller (My Flights, Starlink "Track", the aircraft
  // dialog, the flight sheet, ⌘K) expects to land on Live, as the legacy focusFlight() did.
  // LiveMap holds the move until the panel has a size again.
  const focusOn = useCallback(
    (lat: number, lon: number) => {
      setTab('live');
      setFocus({ lat, lon, key: Date.now() });
    },
    [setTab],
  );

  /**
   * A screen reader speaks a live region when its text changes, so the same sentence twice (the
   * same link followed twice, Back to a tab announced a moment ago) would be heard once. A repeat
   * gets a trailing zero-width space, and the repeat after that drops it again: the text node
   * changes every time and what is read aloud stays the same (`ANNOUNCEMENT_REPEAT_MARK`).
   */
  const announce = useCallback((text: string) => {
    if (!text) return;
    const next = text === lastAnnouncement.current ? `${text}${ANNOUNCEMENT_REPEAT_MARK}` : text;
    lastAnnouncement.current = next;
    setAnnouncement(next);
  }, []);

  /**
   * A watched flight landed. Ask for a coffee — once, three seconds later, and not more
   * than once a fortnight.
   *
   * The delay is the point: this fires the instant the board says "Landed", which is the
   * instant the viewer is reading the row they were waiting on. Landing the ask on top of
   * that moment reads as an interruption; three seconds later it reads as a thank-you.
   */
  const showBmacToast = useCallback((ident: string) => {
    // Once per page load, then the stored 14-day cooldown takes over. A visitor tracking
    // three connections should be thanked once, not three times in twenty minutes.
    if (bmacTimer.current || bmacAsked.current) return;
    if (!bmacEligible(safeLocalStorage() ?? { getItem: () => null })) return;
    bmacAsked.current = true;
    bmacTimer.current = setTimeout(() => {
      bmacTimer.current = null;
      setBmacToast(ident);
    }, BMAC_DELAY_MS);
  }, []);

  const dismissBmacToast = useCallback(() => {
    if (bmacTimer.current) {
      clearTimeout(bmacTimer.current);
      bmacTimer.current = null;
    }
    setBmacToast(null);
  }, []);

  useEffect(
    () => () => {
      if (bmacTimer.current) clearTimeout(bmacTimer.current);
    },
    [],
  );

  const value = useMemo<UiValue>(
    () => ({
      tab,
      setTab,
      pendingScroll,
      clearPendingScroll,
      selection,
      select: setSelection,
      focus,
      focusOn,
      starlinkFilter,
      setStarlinkFilter,
      fleetLink,
      followFleetLink,
      coldFleetLink,
      scheduleLink,
      followScheduleLink,
      searchOpen,
      setSearchOpen,
      aircraftReg,
      openAircraft: setAircraftReg,
      delayExplain,
      openDelayExplain: setDelayExplain,
      fr24Query,
      openFr24: setFr24Query,
      waitlistOpen,
      setWaitlistOpen,
      onboardingOpen,
      setOnboardingOpen,
      disclaimerOpen,
      setDisclaimerOpen,
      bmacToast,
      showBmacToast,
      dismissBmacToast,
      announcement,
      announce,
    }),
    [
      tab,
      setTab,
      pendingScroll,
      clearPendingScroll,
      selection,
      focus,
      focusOn,
      starlinkFilter,
      fleetLink,
      followFleetLink,
      coldFleetLink,
      scheduleLink,
      followScheduleLink,
      searchOpen,
      aircraftReg,
      delayExplain,
      fr24Query,
      waitlistOpen,
      onboardingOpen,
      disclaimerOpen,
      bmacToast,
      showBmacToast,
      dismissBmacToast,
      announcement,
      announce,
    ],
  );

  return <UiContext.Provider value={value}>{children}</UiContext.Provider>;
}
