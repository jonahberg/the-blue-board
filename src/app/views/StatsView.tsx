/**
 * Stats — five aggregations over the live feed and the fleet database (inventory §25).
 *
 * Everything here is derived, nothing is fetched: the feed store already polls every 30
 * seconds and the fleet database is loaded once, so each `useMemo` below re-runs when a
 * new poll lands and the panels refresh with it. That is why "updates every 30s" can be
 * written on the panels as a fact rather than a promise — there is no separate timer to
 * fall out of step with the data.
 *
 * The counting lives in `src/lib/analytics.js` (shared with the Fleet tab, so the two can
 * never disagree about utilisation) and the drawing rules in `src/lib/stats-chart.js`.
 * This file owns layout and the metric headline row.
 */

import { useMemo } from 'react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  TYPE_ORDER,
  avgAgeByType,
  hubMatrix,
  phaseBreakdown,
  topRoutes,
  typeUtilization,
} from '@/lib/analytics.js';
import { matchAircraft } from '@/lib/fleet-match.js';
import { HUB_ORDER } from '@/lib/hub-health.js';
import type { Flight } from '../data/types';
import { useFeed } from '../state/feed';
import { useFleet } from '../state/fleet';
import { makeIsStarlinkFlight } from './live/starlink-match';
import { HubMatrix } from './stats/HubMatrix';
import type { MatrixModel } from './stats/HubMatrix';
import { MetricCards } from './stats/MetricCards';
import type { Metric } from './stats/MetricCards';
import { PhaseDonut } from './stats/PhaseDonut';
import type { PhaseModel } from './stats/PhaseDonut';
import { AgeBars, RouteBars } from './stats/RouteBars';
import { UtilizationChart } from './stats/UtilizationChart';
import type { TypeUtilisation } from './fleet/FleetPulse';

/** Type-level shim: `analytics.js`'s JSDoc types the matcher's argument as a bare Object. */
// eslint-disable-next-line @typescript-eslint/ban-types
type LibMatcher = (f: Object) => { t: string } | null;

const HUBS = HUB_ORDER as string[];
const REFRESH_NOTE = 'updates every 30s';

/** A panel: a titled card with a one-line subtitle saying what it measures. */
function Panel({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="min-w-0">
      <CardHeader className="gap-0.5">
        <CardTitle className="text-sm">{title}</CardTitle>
        {subtitle ? <p className="text-[10px] text-muted-foreground">{subtitle}</p> : null}
      </CardHeader>
      <CardContent className="min-w-0">{children}</CardContent>
    </Card>
  );
}

export default function StatsView() {
  const { flights } = useFeed();
  const { fleetDb, fleetByReg, starlink } = useFleet();

  const airborne = useMemo(() => flights.filter((f) => !f.onGround), [flights]);

  const utilisation = useMemo(
    () =>
      typeUtilization(airborne, fleetDb, {
        matchAircraft: ((f: Flight) => matchAircraft(f, fleetByReg)) as LibMatcher,
      }) as TypeUtilisation[],
    [airborne, fleetDb, fleetByReg],
  );

  const phase = useMemo(() => phaseBreakdown(flights) as PhaseModel, [flights]);

  const matrix = useMemo(() => hubMatrix(airborne, HUBS) as MatrixModel, [airborne]);

  const routes = useMemo(
    () => topRoutes(airborne, 15) as { route: string; count: number }[],
    [airborne],
  );

  const ages = useMemo(
    () => avgAgeByType(fleetDb) as { rows: { type: string; avg: string | number }[]; fleetAvg: string },
    [fleetDb],
  );

  const metrics = useMemo<Metric[]>(() => {
    const isStarlink = makeIsStarlinkFlight(starlink.tails, fleetByReg);
    const starlinkAirborne = airborne.filter(isStarlink).length;
    const starlinkPct = airborne.length ? Math.round((starlinkAirborne / airborne.length) * 100) : 0;
    const utilPct = fleetDb.length ? Math.round((airborne.length / fleetDb.length) * 100) : 0;
    return [
      { label: 'Flights Airborne', value: String(airborne.length) },
      { label: 'Fleet Utilization', value: `${utilPct}%` },
      { label: 'Avg Fleet Age', value: `${ages.fleetAvg}y` },
      {
        label: 'Starlink Coverage',
        value: `${starlinkPct}%`,
        // Without the denominator "0 %" reads as "no Starlink aircraft exist" rather than
        // "the feed has not answered yet", which is a different and wrong claim.
        sub: `${starlinkAirborne} of ${airborne.length} airborne`,
      },
    ];
  }, [airborne, fleetDb.length, fleetByReg, starlink.tails, ages.fleetAvg]);

  return (
    <div className="mx-auto w-full max-w-6xl space-y-3 p-3 md:p-6">
      <MetricCards metrics={metrics} />

      <div className="grid gap-3 lg:grid-cols-2">
        <Panel
          title="✈️ Live Fleet Utilization"
          subtitle={`Airborne now vs. total fleet · ${REFRESH_NOTE}`}
        >
          <UtilizationChart rows={utilisation} />
        </Panel>

        <Panel
          title="🛫 Airborne by Flight Phase"
          subtitle={`Current phase distribution · ${REFRESH_NOTE}`}
        >
          <PhaseDonut model={phase} />
        </Panel>
      </div>

      <Panel
        title="🔥 Hub-to-Hub Flow Matrix"
        subtitle="Active flights between UA hubs · darker = more traffic"
      >
        <HubMatrix hubs={HUBS} model={matrix} />
      </Panel>

      <div className="grid gap-3 lg:grid-cols-2">
        <Panel title="📈 Top Routes Right Now" subtitle={`Busiest city pairs in the air · ${REFRESH_NOTE}`}>
          <RouteBars rows={routes} />
        </Panel>

        <Panel
          title="📅 Average Fleet Age by Type"
          subtitle={`Mean years since delivery across ${TYPE_ORDER.length} mainline types`}
        >
          <AgeBars rows={ages.rows} />
        </Panel>
      </div>
    </div>
  );
}
