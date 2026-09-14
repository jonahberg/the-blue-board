/**
 * "Airborne by Flight Phase" — the donut and its legend (inventory §25,
 * `main.js:4141-4181`).
 *
 * The donut is `aria-hidden`: an SVG of seven arcs is not readable, and the legend beside
 * it already states every phase, its count and its share in text. A screen reader gets the
 * same seven rows from the sr-only table at the end — the numbers, not a description of a
 * picture of the numbers.
 *
 * Geometry (r 36, stroke 12, one percentage point = 2.26 user units) and the colour ramp
 * live in `src/lib/stats-chart.js` with a test; this file is layout only.
 */

import {
  DONUT,
  PHASE_COLORS,
  PHASE_ICONS,
  PHASE_LEGEND_ORDER,
  donutSegments,
} from '@/lib/stats-chart.js';

export type PhaseModel = {
  counts: Record<string, number>;
  total: number;
  /** Phases with a non-zero count, in slice order. */
  order: string[];
};

export function PhaseDonut({ model }: { model: PhaseModel }) {
  const segments = donutSegments(model.counts, model.order, model.total) as {
    phase: string;
    count: number;
    pct: number;
    color: string;
    dashArray: string;
    dashOffset: number;
  }[];
  const legend = PHASE_LEGEND_ORDER.filter((phase) => (model.counts[phase] || 0) > 0);

  if (!legend.length) {
    return <p className="py-6 text-xs text-muted-foreground">Waiting for flight data…</p>;
  }

  return (
    <div className="flex flex-wrap items-center gap-5">
      <svg
        viewBox="0 0 100 100"
        className="size-[120px] shrink-0"
        aria-hidden="true"
        focusable="false"
      >
        {segments.map((segment) => (
          <circle
            key={segment.phase}
            cx={DONUT.cx}
            cy={DONUT.cy}
            r={DONUT.r}
            fill="none"
            stroke={segment.color}
            strokeWidth={DONUT.strokeWidth}
            strokeDasharray={segment.dashArray}
            strokeDashoffset={segment.dashOffset}
          />
        ))}
        <text
          x="50"
          y="48"
          textAnchor="middle"
          fill="currentColor"
          fontSize="14"
          fontWeight="700"
        >
          {model.total}
        </text>
        <text x="50" y="60" textAnchor="middle" fill="currentColor" fontSize="6" opacity="0.6">
          flights
        </text>
      </svg>

      <ul className="min-w-[180px] flex-1 space-y-0.5">
        {legend.map((phase) => {
          const count = model.counts[phase] || 0;
          const pct = Math.round((count / (model.total || 1)) * 100);
          return (
            <li key={phase} className="flex items-center gap-1.5 py-0.5 text-[11px]">
              <span aria-hidden="true" className="text-xs">
                {PHASE_ICONS[phase as keyof typeof PHASE_ICONS]}
              </span>
              <span className="w-[68px] shrink-0 truncate">{phase}</span>
              <span
                className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-muted"
                aria-hidden="true"
              >
                <span
                  className="block h-full rounded-full transition-[width] duration-500"
                  style={{
                    width: `${pct}%`,
                    background: PHASE_COLORS[phase as keyof typeof PHASE_COLORS],
                  }}
                />
              </span>
              <span className="w-[52px] shrink-0 text-right font-mono font-semibold tabular-nums">
                {count} <span className="text-[9px] text-muted-foreground">{pct}%</span>
              </span>
            </li>
          );
        })}
      </ul>

      <table className="sr-only">
        <caption>Airborne aircraft by flight phase</caption>
        <thead>
          <tr>
            <th scope="col">Phase</th>
            <th scope="col">Flights</th>
            <th scope="col">Share</th>
          </tr>
        </thead>
        <tbody>
          {legend.map((phase) => (
            <tr key={phase}>
              <th scope="row">{phase}</th>
              <td>{model.counts[phase] || 0}</td>
              <td>{Math.round(((model.counts[phase] || 0) / (model.total || 1)) * 100)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
