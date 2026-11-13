/**
 * "Live Fleet Utilization" — airborne now vs total fleet, one row per mainline type
 * (inventory §25, `main.js:4112-4139`).
 *
 * All nineteen types are listed in `TYPE_ORDER`, including the ones with nothing flying:
 * this panel answers "how much of each fleet is working right now", and a type that has
 * gone quiet is part of that answer. (The Fleet tab's pulse strip drops the zeroes,
 * because there the question is "what is up".)
 *
 * The bar is one measure on one scale — no second axis, no stacked segment — in one colour:
 * utilisation is a measure, not a status, so it is drawn in the accent exactly as the Fleet
 * tab draws it (F69). Only idle types (nothing flying) recede. Every row carries its own
 * "N/M P%" figure.
 *
 * The type is the row's identity link (links everywhere, part 2): the Fleet tab filtered to it,
 * in place. Every `TYPE_ORDER` string is a fleet database type, and `fleetTypeCodeFor` still
 * decides, so a string with no fleet page would print as text. The figures and the bar stay text.
 * Wherever the link's 44 px touch box is drawn a row is 44 px tall, so one row's box never covers
 * the next row's link; a mouse at `md`+ keeps the dense list.
 */

import { fleetTypeCodeFor } from '@/lib/fleet-type-link.js';
import { UTIL_BAR_COLOR, UTIL_TEXT_CLASS, utilBand } from '@/lib/stats-chart.js';
import { TypeLink } from '../../features/EntityLinks';
import type { TypeUtilisation } from '../fleet/FleetPulse';

/**
 * A type-per-row list: 44 px rows where the touch box is drawn. Shared with the fleet-age list
 * (RouteBars.tsx), whose rows line up with these at `lg`.
 */
export const TYPE_ROW = 'flex min-h-11 items-center gap-2 py-1 text-[11px] pointer-fine:md:min-h-0';

/**
 * The type column. Never `truncate`: overflow clipping would clip the link's touch box too, and
 * the longest type ("737-900ER") fits the column.
 */
export const TYPE_CELL = 'w-[72px] shrink-0 font-mono sm:w-[86px]';

export function UtilizationChart({ rows }: { rows: TypeUtilisation[] }) {
  return (
    <ul className="divide-y divide-border/40">
      {rows.map((row) => {
        const band = utilBand(row.pct) as keyof typeof UTIL_BAR_COLOR;
        return (
          <li key={row.type} className={TYPE_ROW}>
            <TypeLink typeCode={fleetTypeCodeFor({ typeText: row.type })} tone="identity" className={TYPE_CELL}>
              {row.type}
            </TypeLink>
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
