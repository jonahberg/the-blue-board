// ═══ DASHBOARD TAB ADDRESSES ═══
// The addresses a dashboard link uses to open a whole tab, with nothing else in them: the path and
// the tab's own hash, which `resolveDeepLink` (src/app/state/deep-links.ts) follows in place and a
// cold load opens the same way (`initialTab`). Kept here so a row model in src/lib can carry one
// (a Schedule row's Starlink mark) and the views do not spell them out.
//
// Tested in tests/schedule-links.test.ts against `TAB_HASHES` and `resolveDeepLink`.

/** The Schedule tab, on whichever board it was left on ("Check the Schedule tab →" in Live). */
export const SCHEDULE_TAB_HREF = '/#schedule';

/** My Flights, the watched flights' own tab (the watch panel's "N of 20 slots used"). */
export const MY_FLIGHTS_HREF = '/#myflight';

/** The Starlink tab (a row's ⚡ Starlink mark; the same address the brief's chips use). */
export const STARLINK_TAB_HREF = '/#starlink';
