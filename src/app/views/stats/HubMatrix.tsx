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
 */

import { matrixAlpha } from '@/lib/stats-chart.js';

export type MatrixModel = {
  matrix: Record<string, Record<string, number>>;
  rowTotals: Record<string, number>;
  max: number;
};

export function HubMatrix({ hubs, model }: { hubs: string[]; model: MatrixModel }) {
  return (
    <div className="overflow-x-auto" tabIndex={0} aria-label="Hub-to-hub flow matrix, scrollable region">
      <table className="w-full border-collapse font-mono text-[10px]">
        <caption className="sr-only">
          Airborne United flights between hubs, by origin (rows) and destination (columns)
        </caption>
        <thead>
          <tr>
            <th scope="col" className="px-1.5 py-1 text-left text-[9px] font-normal text-muted-foreground">
              FROM \ TO
            </th>
            {hubs.map((hub) => (
              <th key={hub} scope="col" className="px-1.5 py-1 text-center text-primary">
                {hub}
              </th>
            ))}
            <th scope="col" className="px-1.5 py-1 text-center text-[9px] font-normal text-muted-foreground">
              TOTAL
            </th>
          </tr>
        </thead>
        <tbody>
          {hubs.map((origin) => (
            <tr key={origin}>
              <th scope="row" className="px-1.5 py-1 text-left font-bold text-primary">
                {origin}
              </th>
              {hubs.map((dest) => {
                if (origin === dest) {
                  return (
                    <td key={dest} className="bg-muted/30 px-1.5 py-1 text-center text-muted-foreground">
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
                    className={`border border-border/30 px-1.5 py-1 text-center ${
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
              <td className="border-l-2 border-border px-1.5 py-1 text-center font-bold text-muted-foreground">
                {model.rowTotals[origin] ?? 0}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
