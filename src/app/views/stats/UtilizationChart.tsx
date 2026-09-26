/**
 * "Live Fleet Utilization" — airborne now vs total fleet, one row per mainline type
 * (inventory §25, `main.js:4112-4139`).
 *
 * All nineteen types are listed in `TYPE_ORDER`, including the ones with nothing flying:
 * this panel answers "how much of each fleet is working right now", and a type that has
 * gone quiet is part of that answer. (The Fleet tab's pulse strip drops the zeroes,
 * because there the question is "what is up".)
 *
 * The bar is one measure on one scale — no second axis, no stacked segment. Every row
 * carries its own "N/M P%" figure, so the colour band is a second reading of a number
 * already on screen rather than the only way to read it.
 */

import { UTIL_BAR_COLOR, UTIL_TEXT_CLASS, utilBand } from '@/lib/stats-chart.js';
import type { TypeUtilisation } from '../fleet/FleetPulse';

export function UtilizationChart({ rows }: { rows: TypeUtilisation[] }) {
  return (
    <ul className="divide-y divide-border/40">
      {rows.map((row) => {
        const band = utilBand(row.pct) as keyof typeof UTIL_BAR_COLOR;
        return (
          <li key={row.type} className="flex items-center gap-2 py-1 text-[11px]">
            <span className="w-[72px] shrink-0 truncate font-mono sm:w-[86px]">{row.type}</span>
            <span
              className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted"
              aria-hidden="true"
            >
              <span
                className="block h-full rounded-full transition-[width] duration-500"
                style={{ width: `${row.pct}%`, background: UTIL_BAR_COLOR[band] }}
              />
            </span>
            <span className="w-[74px] shrink-0 text-right font-mono font-semibold tabular-nums">
              <span className={UTIL_TEXT_CLASS[band]}>{row.flying}</span>
              <span className="text-muted-foreground">/{row.total}</span>{' '}
              <span className={`text-[10px] ${UTIL_TEXT_CLASS[band]}`}>{row.pct}%</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
