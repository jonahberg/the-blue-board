// ═══ DASHBOARD TAB ADDRESSES ═══
// The addresses a dashboard link uses to open a whole tab, with nothing else in them: the path and
// the tab's own hash, which `resolveDeepLink` (src/app/state/deep-links.ts) follows in place and a
// cold load opens the same way (`initialTab`). Plus the one sub-view a dashboard link names, the
// Fleet tab's Airborne Now list. One named place for each, so a row model in src/lib can carry one
// (a Schedule row's Starlink mark) and no view or link table spells one out.
//
// The Starlink tab's address has its home in ./starlink-link.js, which the content pages share,
// and the NAS status panel's in ./hub-link.js (`NAS_STATUS_HREF`), beside the rule that links an
// FAA code there.
//
// Tested in tests/tab-links.test.js against `TAB_HASHES` and `resolveDeepLink`.

/** The Live tab, with whatever map filter it was left on (Sources' Flightradar24, Stats' "Flights Airborne"). */
export const LIVE_TAB_HREF = '/#live';

/** The Schedule tab, on whichever board it was left on ("Check the Schedule tab →" in Live). */
export const SCHEDULE_TAB_HREF = '/#schedule';

/** The Fleet tab (Sources' fleet database card). */
export const FLEET_TAB_HREF = '/#fleet';

/** The Fleet tab on Airborne Now, unfiltered: the aircraft the Stats tab's "Fleet Utilization" card counts. */
export const FLEET_AIRBORNE_HREF = '/?tab=fleet&view=airborne';

/** The Delays · Weather tab (Sources' AWC and NEXRAD cards, the brief's weather chips). */
export const WEATHER_TAB_HREF = '/#weather';

/** My Flights, the watched flights' own tab (the watch panel's "N of 20 slots used"). */
export const MY_FLIGHTS_HREF = '/#myflight';
