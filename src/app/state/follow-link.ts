/**
 * Follow a dashboard link in place: apply a resolved address (`resolveDeepLink`) through the
 * dashboard's own state, so the link lands where a cold load of the same address would and the
 * page never reloads.
 *
 * The order is the cold load's (`useDeepLinks`): the Schedule board before the tab that shows it,
 * the Fleet link before the Fleet tab mounts and reads it, the tab with its scroll target, and the
 * aircraft dialog last so it opens over whichever tab is showing (an aircraft link has no tab of
 * its own and keeps the one you were on).
 *
 * Needs `UiProvider` and `ScheduleProvider` above it. In the dashboard both wrap the whole shell
 * (`Dashboard.tsx`), so any view, overlay or shell component can call it.
 */

import { useCallback } from 'react';

import type { DeepLinkIntent } from './deep-links';
import { useSchedule } from './schedule';
import { useUi } from './ui';

export function useFollowDeepLink(): (intent: DeepLinkIntent) => void {
  const { setTab, openAircraft, followFleetLink } = useUi();
  const { setCurrent } = useSchedule();
  return useCallback(
    (intent: DeepLinkIntent) => {
      if (intent.scheduleHub) setCurrent({ hub: intent.scheduleHub });
      if (intent.fleet) followFleetLink(intent.fleet);
      if (intent.tab) setTab(intent.tab, intent.scrollTo ? { scrollTo: intent.scrollTo } : undefined);
      if (intent.aircraft) openAircraft(intent.aircraft);
    },
    [setCurrent, followFleetLink, setTab, openAircraft],
  );
}
