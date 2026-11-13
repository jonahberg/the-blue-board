/**
 * "Hub-to-Hub Flow Matrix" — a directional 9×9 of airborne flights between United's hubs,
 * plus a per-origin TOTAL column (inventory §25, `main.js:4183-4222`).
 *
 * Directional on purpose: ORD→DEN and DEN→ORD are different flights and different cells.
 * The diagonal is blank rather than zero — a hub does not fly to itself, and printing 0
 * there would invite the reader to average it in.
 *
 * This is a real `<table>` with row and column headers, so it is already the data table a
 * heatmap owes its reader; the cell tint is a second reading of the number printed in it,
 * never the only one. The single-hue ramp (magnitude, so one hue light→dark) and its 0.15
 * floor live in `src/lib/stats-chart.js`.
 *
 * The headers link to each hub's Schedule board, in place (links everywhere, part 2): a row
 * header is its row's identity link, in link colour; a column header is quiet. The cells and
 * the totals are counts with no list behind them, so they stay text. Each header link fills its
 * cell and is itself the target: 44 px both ways wherever the touch floor applies, the cell's own
 * padding for a mouse at `md`+. No `after:` box: the matrix scrolls in its own region, which would
 * clip one. On a phone the 44 px columns make the matrix wider than the card, and it scrolls.
 */

import { matrixAlpha } from '@/lib/stats-chart.js';
import { HubLink } from '../../features/EntityLinks';

export type MatrixModel = {
  matrix: Record<string, Record<string, number>>;
  rowTotals: Record<string, number>;
  max: number;
};

/**
 * Every cell's box. From `lg` the matrix sits in a half-width card beside "Top Routes" (15
 * rows); the taller cells there make its ten rows the same height as that list, so neither
 * card is left with a blank band under it (Nov 2026).
 */
const CELL = 'px-1 py-1 sm:px-1.5 lg:py-2';

/**
 * A header link: it carries the cell's padding itself (its `th` has none), so it fills the cell,
 * and it is at least 44 × 44 px until a mouse at `md`+.
 */
const HEAD_LINK = `flex min-h-11 min-w-11 items-center ${CELL} pointer-fine:md:min-h-0 pointer-fine:md:min-w-0`;

export function HubMatrix({ hubs, model }: { hubs: string[]; model: MatrixModel }) {
  return (
    <div className="overflow-x-auto" tabIndex={0} aria-label="Hub-to-hub flow matrix, scrollable region">
      <table className="w-full border-collapse font-mono text-[10px]">
        <caption className="sr-only">
          Airborne United flights between hubs, by origin (rows) and destination (columns)
        </caption>
        <thead>
          <tr>
            <th scope="col" className={`${CELL} text-left text-[9px] font-normal text-muted-foreground`}>
              FROM \ TO
            </th>
            {hubs.map((hub) => (
              <th key={hub} scope="col" className="p-0 text-center">
                <HubLink code={hub} hit="none" className={`${HEAD_LINK} justify-center`} />
              </th>
            ))}
            <th scope="col" className={`${CELL} text-center text-[9px] font-normal text-muted-foreground`}>
              TOTAL
            </th>
          </tr>
        </thead>
        <tbody>
          {hubs.map((origin) => (
            <tr key={origin}>
              <th scope="row" className="p-0 text-left font-bold">
                <HubLink code={origin} tone="identity" hit="none" className={HEAD_LINK} />
              </th>
              {hubs.map((dest) => {
                if (origin === dest) {
                  return (
                    <td key={dest} className={`bg-muted/30 ${CELL} text-center text-muted-foreground`}>
                      <span aria-hidden="true">—</span>
                      <span className="sr-only">not applicable</span>
                    </td>
                  );
                }
                const value = model.matrix[origin]?.[dest] ?? 0;
                const alpha = matrixAlpha(value, model.max) as number;
                return (
                  <td
                    key={dest}
                    className={`border border-border/30 ${CELL} text-center ${
                      value > 0 ? 'font-bold' : 'text-muted-foreground'
                    }`}
                    style={
                      alpha > 0
                        ? { background: `color-mix(in oklab, var(--primary) ${Math.round(alpha * 100)}%, transparent)` }
                        : undefined
                    }
                  >
                    {value > 0 ? value : <span aria-hidden="true">·</span>}
                    {value > 0 ? null : <span className="sr-only">0</span>}
                  </td>
                );
              })}
              <td className={`border-l-2 border-border ${CELL} text-center font-bold text-muted-foreground`}>
                {model.rowTotals[origin] ?? 0}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
