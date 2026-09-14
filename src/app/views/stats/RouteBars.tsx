/**
 * "Top Routes Right Now" and "Average Fleet Age by Type" — two single-series bar lists
 * (inventory §25, `main.js:4224-4266`).
 *
 * One series, so no legend: the panel title names the measure. Every bar is directly
 * labelled with its value, which is what lets the age chart's colour band be a hint
 * rather than the reading.
 */

import { AGE_BAR_COLOR, ageBand, ageBarPct, routeBarPct } from '@/lib/stats-chart.js';

export function RouteBars({ rows }: { rows: { route: string; count: number }[] }) {
  if (!rows.length) {
    return <p className="py-6 text-xs text-muted-foreground">Waiting for flight data…</p>;
  }
  const max = rows[0].count;

  return (
    <ol className="space-y-0.5">
      {rows.map((row, index) => (
        <li key={row.route} className="flex items-center gap-2 py-0.5 text-[11px]">
          <span className="w-4 shrink-0 text-right text-[9px] text-muted-foreground">
            {index + 1}
          </span>
          <span className="w-[92px] shrink-0 font-mono font-semibold">{row.route}</span>
          <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
            <span
              className="block h-full rounded-full bg-primary"
              style={{ width: `${routeBarPct(row.count, max)}%` }}
            />
          </span>
          <span className="w-7 shrink-0 text-right font-mono font-semibold tabular-nums text-primary">
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
          <li key={row.type} className="flex items-center gap-2 py-1 text-[11px]">
            <span className="w-[72px] shrink-0 truncate font-mono sm:w-[86px]">{row.type}</span>
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
