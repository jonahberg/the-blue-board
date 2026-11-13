/**
 * "Top Routes Right Now" and "Average Fleet Age by Type" — two single-series bar lists
 * (inventory §25, `main.js:4224-4266`).
 *
 * One series, so no legend: the panel title names the measure. Every bar is directly
 * labelled with its value, which is what lets the age chart's colour band be a hint
 * rather than the reading.
 *
 * Links (links everywhere, part 2):
 *  - Top Routes: each hub end of a route links to that hub's Schedule board, quiet: the row is a
 *    route, which has no home of its own. A non-hub end, the rank, the bar and the count are text;
 *    the count is body colour, since link colour means link. The two ends come from the row
 *    (`topRoutes` carries `origin` and `dest`), never from the joined string. Wherever the 44 px
 *    touch boxes are drawn (every pointer below `md`, a coarse one at any width) a row is 44 px
 *    tall and the arrow keeps the two ends far enough apart that their boxes never overlap; a mouse
 *    at `md`+ keeps the tight row.
 *  - Average Fleet Age: the type is the row's identity link, as in the utilisation list.
 */

import { fleetTypeCodeFor } from '@/lib/fleet-type-link.js';
import { AGE_BAR_COLOR, ageBand, ageBarPct, routeBarPct } from '@/lib/stats-chart.js';
import { HubLink, TypeLink } from '../../features/EntityLinks';
import { TYPE_CELL, TYPE_ROW } from './UtilizationChart';

export type RouteRow = { route: string; origin: string; dest: string; count: number };

export function RouteBars({ rows }: { rows: RouteRow[] }) {
  if (!rows.length) {
    return <p className="py-6 text-xs text-muted-foreground">Waiting for flight data…</p>;
  }
  const max = rows[0].count;

  return (
    <ol className="space-y-0.5">
      {rows.map((row, index) => (
        <li key={row.route} className="flex min-h-11 items-center gap-2 py-0.5 text-[11px] pointer-fine:md:min-h-0">
          <span className="w-4 shrink-0 text-right text-[9px] text-muted-foreground">
            {index + 1}
          </span>
          <span className="w-[92px] shrink-0 font-mono font-semibold">
            <HubLink code={row.origin} />
            <span aria-hidden="true" className="mx-3 pointer-fine:md:mx-0">
              →
            </span>
            <HubLink code={row.dest} />
          </span>
          <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
            <span
              className="block h-full rounded-full bg-primary"
              style={{ width: `${routeBarPct(row.count, max)}%` }}
            />
          </span>
          <span className="w-7 shrink-0 text-right font-mono font-semibold tabular-nums">
            {row.count}
          </span>
        </li>
      ))}
    </ol>
  );
}

export function AgeBars({ rows }: { rows: { type: string; avg: string | number }[] }) {
  return (
    <ul className="divide-y divide-border/40">
      {rows.map((row) => {
        const band = ageBand(row.avg) as keyof typeof AGE_BAR_COLOR;
        return (
          <li key={row.type} className={TYPE_ROW}>
            <TypeLink typeCode={fleetTypeCodeFor({ typeText: row.type })} tone="identity" className={TYPE_CELL}>
              {row.type}
            </TypeLink>
            <span className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
              <span
                className="block h-full rounded-full"
                style={{ width: `${ageBarPct(row.avg)}%`, background: AGE_BAR_COLOR[band] }}
              />
            </span>
            <span className="w-10 shrink-0 text-right font-mono font-semibold tabular-nums">
              {row.avg}y
            </span>
          </li>
        );
      })}
    </ul>
  );
}
