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

import type { DeepLinkIntent } from './deep-links';
import { useSchedule } from './schedule';
import type { ScheduleValue } from './schedule';
import { useUi } from './ui';
import type { UiValue } from './ui';

export type FollowDeepLink = (intent: DeepLinkIntent) => void;

const FollowContext = createContext<FollowDeepLink | null>(null);

/** What a follow reads from the two stores, as of the last commit. */
type Latest = {
  setTab: UiValue['setTab'];
  openAircraft: UiValue['openAircraft'];
  followFleetLink: UiValue['followFleetLink'];
  setCurrent: ScheduleValue['setCurrent'];
};

export function FollowProvider({ children }: { children: ReactNode }) {
  const { setTab, openAircraft, followFleetLink } = useUi();
  const { setCurrent } = useSchedule();
  const latest = useRef<Latest>({ setTab, openAircraft, followFleetLink, setCurrent });
  // After commit, so a render React throws away never reaches a click.
  useLayoutEffect(() => {
    latest.current = { setTab, openAircraft, followFleetLink, setCurrent };
  });

  const follow = useCallback<FollowDeepLink>((intent) => {
    const { setTab, openAircraft, followFleetLink, setCurrent } = latest.current;
    if (intent.scheduleHub) setCurrent({ hub: intent.scheduleHub });
    if (intent.fleet) followFleetLink(intent.fleet);
    if (intent.tab) setTab(intent.tab, intent.scrollTo ? { scrollTo: intent.scrollTo } : undefined);
    if (intent.aircraft) openAircraft(intent.aircraft);
  }, []);

  return <FollowContext.Provider value={follow}>{children}</FollowContext.Provider>;
}

/** The dashboard's in-place follow. The function is the same one for the life of the provider. */
export function useFollowDeepLink(): FollowDeepLink {
  const follow = useContext(FollowContext);
  if (!follow) throw new Error('useFollowDeepLink() outside <FollowProvider>');
  return follow;
}
