/**
 * Schedule — ported in Task 3.
 *
 * Registered in `src/app/tabs.ts` from the start so routing, deep links and the mobile nav
 * are already wired; Task 3 replaces this file and nothing else.
 */

import { Placeholder } from './Placeholder';

export default function ScheduleView() {
  return <Placeholder title="Schedule" summary="Departure and arrival boards for all nine tracked airports, with on-time stats and equipment-swap alerts, arrive with the Schedule port." />;
}
