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
 * A link that changes the tab leaves ONE history entry (`pushHistoryEntry`), so Back returns to the
 * tab the reader was on: the hash listener in `useDeepLinks` restores it. A link to the tab already
 * showing and an aircraft link (an overlay) leave none; the tab bar keeps replacing (`setTab`).
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

import { createContext, useCallback, useContext, useLayoutEffect, useRef } from 'react';
import type { ReactNode } from 'react';

import { addressAfterFollow } from '@/lib/followed-link.js';
import { TAB_HASHES, resolveTabParam } from '../tabs';
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
  setCurrent: ScheduleValue['setCurrent'];
};

export function FollowProvider({ children }: { children: ReactNode }) {
  const { tab, setTab, openAircraft, followFleetLink } = useUi();
  const { setCurrent } = useSchedule();
  const latest = useRef<Latest>({ tab, setTab, openAircraft, followFleetLink, setCurrent });
  // After commit, so a render React throws away never reaches a click.
  useLayoutEffect(() => {
    latest.current = { tab, setTab, openAircraft, followFleetLink, setCurrent };
  });

  const follow = useCallback<FollowDeepLink>((intent) => {
    const { tab: from, setTab, openAircraft, followFleetLink, setCurrent } = latest.current;
    const to = intent.tab && intent.tab !== from ? intent.tab : null;
    // A board as a cold load opens it: Departures (the hub chip's figure is operated departures),
    // and, with no day given, the hub's useful day (`setCurrent` re-derives it).
    if (intent.scheduleHub) setCurrent({ hub: intent.scheduleHub, dir: 'departures' });
    if (intent.fleet) followFleetLink(intent.fleet);
    if (to) {
      pushHistoryEntry(from, to);
      setTab(to, { hash: false, ...(intent.scrollTo ? { scrollTo: intent.scrollTo } : {}) });
    } else if (intent.tab) {
      // The tab already showing: a new board or scroll target is not a new place to go back from.
      setTab(intent.tab, intent.scrollTo ? { scrollTo: intent.scrollTo } : undefined);
    }
    if (intent.aircraft) openAircraft(intent.aircraft);
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
  const { pathname, search, hash } = window.location;
  if (resolveTabParam(hash) !== from) {
    window.history.replaceState(window.history.state, '', `${pathname}${search}${TAB_HASHES[from]}`);
  }
  window.history.pushState(null, '', addressAfterFollow(window.location, TAB_HASHES[to]));
}

/** The dashboard's in-place follow. The function is the same one for the life of the provider. */
export function useFollowDeepLink(): FollowDeepLink {
  const follow = useContext(FollowContext);
  if (!follow) throw new Error('useFollowDeepLink() outside <FollowProvider>');
  return follow;
}
