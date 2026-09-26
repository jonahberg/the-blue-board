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
import type { TabId } from '../tabs';
import type { Flight } from '../data/types';

/** What the flight sheet is showing: a live aircraft, or a flight number to look up. */
export type Selection =
  | { kind: 'flight'; flight: Flight }
  | { kind: 'ident'; ident: string }
  | null;

/** A map "look here" request. `key` makes repeated focuses on the same point distinct. */
export type MapFocus = { lat: number; lon: number; key: number } | null;

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

  /** The current text of the single polite live region. */
  announcement: string;
  announce: (text: string) => void;
};

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
  const hash = window.location.hash;
  const match = (Object.keys(TAB_HASHES) as TabId[]).find((id) => TAB_HASHES[id] === hash);
  return match ?? DEFAULT_TAB;
}

export function UiProvider({ children }: { children: ReactNode }) {
  const [tab, setTabState] = useState<TabId>(initialTab);
  const [pendingScroll, setPendingScroll] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection>(null);
  const [focus, setFocus] = useState<MapFocus>(null);
  const [starlinkFilter, setStarlinkFilter] = useState(false);
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
      // `replaceState`, never `pushState`: the tab bar is navigation within one page and must
      // not fill the visitor's back button with eight entries.
      if (options?.hash !== false && typeof window !== 'undefined') {
        window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${TAB_HASHES[id]}`);
      }
    },
    [],
  );

  const clearPendingScroll = useCallback(() => setPendingScroll(null), []);

  const focusOn = useCallback((lat: number, lon: number) => {
    setFocus({ lat, lon, key: Date.now() });
  }, []);

  /** Repeating the same sentence is a no-op: screen readers announce a changed value. */
  const announce = useCallback((text: string) => {
    if (!text || text === lastAnnouncement.current) return;
    lastAnnouncement.current = text;
    setAnnouncement(text);
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
