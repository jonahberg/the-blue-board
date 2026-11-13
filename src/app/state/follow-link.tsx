/**
 * Follow a dashboard link in place: apply a resolved address (`resolveDeepLink`) through the
 * dashboard's own state, so the link ends in the state a cold load of the same address reaches
 * and the page never reloads.
 *
 * The order here: the Schedule board before the tab that shows it, the Fleet link before the Fleet
 * tab mounts and reads it, the tab with its scroll target, and the aircraft dialog last so it opens
 * over whichever tab is showing (an aircraft link has no tab of its own and keeps the one you were
 * on). It is not the cold load's order (`useDeepLinks` sets the tab first); the end state is the
 * same.
 *
 * A link ARRIVES when it changes the tab, and only then is its destination put where a cold load of
 * the same address starts (a hub link: Departures, the hub's default day, and `scheduleLink` for
 * the Schedule view's own filters; a Fleet link: `fleetLink.arriving`, so the Fleet view resets
 * before it applies). A link followed on the tab already showing changes only what it names: a hub
 * link on Schedule changes the board's hub and keeps direction and day, a Fleet link sets its own
 * filter (the links plan, ruling 2).
 *
 * A link that changes the tab leaves ONE history entry (`pushHistoryEntry`), so Back returns to the
 * tab the reader was on: the hash listener in `useDeepLinks` restores it, and `FollowProvider`
 * announces the tab and moves focus as a follow does. A link to the tab already showing and an
 * aircraft link (an overlay) leave none; the tab bar keeps replacing (`setTab`).
 *
 * A link that changes the tab also says where it went ("Schedule, ORD") through the page's one
 * polite region, and when the focused element was in the panel being hidden (a hub or type link
 * inside the Starlink tab) or focus was already lost, it moves focus to the destination panel a
 * frame later, without scrolling (`moveFocusToPanel`). Focus anywhere else stays: a hub chip in
 * the header activated from the keyboard keeps it.
 *
 * `follow` comes from a context of its own whose value never changes: `FollowProvider` reads the
 * UI and Schedule stores and keeps what it needs in a ref, so a link (there are over a thousand
 * once the Starlink roster has mounted) re-renders only when its own props change, not on every
 * tab switch, dialog, announcement or board load.
 *
 * `FollowProvider` needs `UiProvider` and `ScheduleProvider` above it; in the dashboard it sits
 * just inside `ScheduleProvider` (`Dashboard.tsx`), so any view, overlay or shell component can
 * call `useFollowDeepLink()`.
 */

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef } from 'react';
import type { ReactNode } from 'react';

import { addressAfterFollow, followAnnouncement } from '@/lib/followed-link.js';
import { TAB_HASHES, resolveTabParam, tabById } from '../tabs';
import type { TabId } from '../tabs';
import type { DeepLinkIntent } from './deep-links';
import { useSchedule } from './schedule';
import type { ScheduleValue } from './schedule';
import { useUi } from './ui';
import type { UiValue } from './ui';

export type FollowDeepLink = (intent: DeepLinkIntent) => void;

const FollowContext = createContext<FollowDeepLink | null>(null);

/** What a follow reads from the two stores, as of the last commit. */
type Latest = {
  tab: TabId;
  setTab: UiValue['setTab'];
  openAircraft: UiValue['openAircraft'];
  followFleetLink: UiValue['followFleetLink'];
  followScheduleLink: UiValue['followScheduleLink'];
  announce: UiValue['announce'];
  setCurrent: ScheduleValue['setCurrent'];
  board: ScheduleValue['current'];
};

export function FollowProvider({ children }: { children: ReactNode }) {
  const { tab, setTab, openAircraft, followFleetLink, followScheduleLink, announce } = useUi();
  const { setCurrent, current: board } = useSchedule();
  const now = { tab, setTab, openAircraft, followFleetLink, followScheduleLink, announce, setCurrent, board };
  const latest = useRef<Latest>(now);
  // The tab a history move has already been announced for, until the tab change commits: Back
  // fires `popstate` and then `hashchange`, and the second must not speak again.
  const historyMoveTo = useRef<TabId | null>(null);
  // After commit, so a render React throws away never reaches a click.
  useLayoutEffect(() => {
    latest.current = now;
    historyMoveTo.current = null;
  });

  // Back and Forward across a followed link's entry, and an in-page `#tab` anchor. The hash
  // listener in `useDeepLinks` puts the tab back; this does what a follow does once the tab
  // changes: it says which tab is showing ("Starlink") and, when focus was in the panel being
  // hidden or already lost, moves it to the panel shown. Read before the tab change commits, so
  // `latest.current.tab` is still the tab being left. The tab bar uses `replaceState`, which fires
  // neither event, so it stays silent as before.
  useEffect(() => {
    function onHistoryMove() {
      const to = resolveTabParam(window.location.hash);
      const { tab: from, announce } = latest.current;
      if (!to || to === from || to === historyMoveTo.current) return;
      historyMoveTo.current = to;
      const refocus = focusLeavesWith(from);
      announce(followAnnouncement(tabById(to)?.label ?? to, {}));
      if (refocus) moveFocusToPanel(to, from);
    }
    window.addEventListener('popstate', onHistoryMove);
    window.addEventListener('hashchange', onHistoryMove);
    return () => {
      window.removeEventListener('popstate', onHistoryMove);
      window.removeEventListener('hashchange', onHistoryMove);
    };
  }, []);

  const follow = useCallback<FollowDeepLink>((intent) => {
    const { tab: from, setTab, openAircraft, followFleetLink, followScheduleLink, announce, setCurrent, board } =
      latest.current;
    const to = intent.tab && intent.tab !== from ? intent.tab : null;
    // Arriving from another tab, or already there (the links plan, ruling 2): only a link that
    // arrives puts its destination where a cold load of its address starts; one followed on the
    // tab already showing changes what it names and resets nothing.
    const arriving = to !== null;
    // Read before anything moves: a caller may blur the link after this returns (the hub chip).
    const refocus = arriving && focusLeavesWith(from);
    if (intent.scheduleHub) {
      if (arriving) {
        // A board as a cold load opens it: Departures (the hub chip's figure is operated
        // departures), and, with no day given, the hub's useful day (`setCurrent` re-derives it).
        // The Schedule view clears its own filters on the new `scheduleLink` seq.
        setCurrent({ hub: intent.scheduleHub, dir: 'departures' });
        followScheduleLink(intent.scheduleHub);
      } else {
        // On the Schedule tab already: the hub changes, the reader's direction and day stay.
        setCurrent({ hub: intent.scheduleHub, day: board.day });
      }
    }
    if (intent.fleet) followFleetLink(intent.fleet, { arriving });
    if (to) {
      pushHistoryEntry(from, to);
      setTab(to, { hash: false, ...(intent.scrollTo ? { scrollTo: intent.scrollTo } : {}) });
    } else if (intent.tab) {
      // The tab already showing: a new board or scroll target is not a new place to go back from.
      setTab(intent.tab, intent.scrollTo ? { scrollTo: intent.scrollTo } : undefined);
    }
    if (intent.aircraft) openAircraft(intent.aircraft);
    if (to) {
      announce(followAnnouncement(tabById(to)?.label ?? to, intent));
      if (refocus) moveFocusToPanel(to, from);
    }
  }, []);

  return <FollowContext.Provider value={follow}>{children}</FollowContext.Provider>;
}

/**
 * Leave one history entry for a followed link that moves the reader from tab `from` to tab `to`.
 *
 * The entry being left is first made to name its tab: a fresh `/` (Live, no hash) would otherwise
 * be an address Back reaches with nothing for the hash listener to restore. The new entry is the
 * path, the query without the dashboard's own deep-link parameters (they would outrank the hash on
 * a reload; utm_* and the like stay) and the new tab's hash. The two entries' hashes differ, so
 * Back fires `hashchange` (and `popstate`), and `useDeepLinks` puts the old tab back.
 */
function pushHistoryEntry(from: TabId, to: TabId) {
  if (typeof window === 'undefined') return;
  try {
    const { pathname, search, hash } = window.location;
    if (resolveTabParam(hash) !== from) {
      window.history.replaceState(window.history.state, '', `${pathname}${search}${TAB_HASHES[from]}`);
    }
    window.history.pushState(null, '', addressAfterFollow(window.location, TAB_HASHES[to]));
  } catch {
    // A browser may refuse a history call (Safari throws a SecurityError past about a hundred in
    // thirty seconds; a sandboxed frame may throw on any). The click has already been taken from
    // the browser, so the follow still happens: the tab changes, without its Back entry.
  }
}

/** The panel that holds a tab's view: Dashboard.tsx marks each `TabsContent` with its tab id. */
function tabPanel(id: TabId): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  return document.querySelector<HTMLElement>(`[data-tab-panel="${id}"]`);
}

/** True when focus is lost, or sits inside the panel of the tab a follow is about to hide. */
function focusLeavesWith(from: TabId): boolean {
  if (typeof document === 'undefined') return false;
  const active = document.activeElement;
  if (!active || active === document.body) return true;
  return tabPanel(from)?.contains(active) ?? false;
}

/**
 * Focus tab `to`'s panel once it shows (Radix gives a tab panel `tabIndex` 0), unless something
 * else has taken focus by then. A frame later, because the panel is hidden until the tab change
 * commits, and on a first visit it is only mounted after that (`visited` in Dashboard.tsx), so a
 * missing or inactive panel is tried for two more frames. `preventScroll`: the view decides where
 * the tab scrolls (the Fleet link's scroll to its controls, a Weather link's to its hub card).
 */
function moveFocusToPanel(to: TabId, from: TabId, framesLeft = 3) {
  if (typeof requestAnimationFrame !== 'function') return;
  requestAnimationFrame(() => {
    const panel = tabPanel(to);
    if (!panel || panel.getAttribute('data-state') !== 'active') {
      if (framesLeft > 1) moveFocusToPanel(to, from, framesLeft - 1);
      return;
    }
    const active = document.activeElement;
    if (active && active !== document.body && !tabPanel(from)?.contains(active)) return;
    panel.focus({ preventScroll: true });
  });
}

/** The dashboard's in-place follow. The function is the same one for the life of the provider. */
export function useFollowDeepLink(): FollowDeepLink {
  const follow = useContext(FollowContext);
  if (!follow) throw new Error('useFollowDeepLink() outside <FollowProvider>');
  return follow;
}
