/**
 * Delays · Weather · Hubs — ported in Task 4.
 *
 * Registered in `src/app/tabs.ts` from the start so routing, deep links and the mobile nav
 * are already wired; Task 4 replaces this file and nothing else.
 */

import { Placeholder } from './Placeholder';

export default function WeatherView() {
  return <Placeholder title="Delays · Weather · Hubs" summary="Hub METAR cards, NEXRAD radar, FAA NAS advisories and the IROPS monitor arrive with the Weather port." />;
}
