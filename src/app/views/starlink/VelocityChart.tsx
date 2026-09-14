/**
 * Installation Velocity — stacked monthly bars (Express / Mainline) plus a cumulative line on
 * its own right axis, with the install-pace caption folded in underneath (inventory §22,
 * `renderSlChart()` + `renderSlTrend()`).
 *
 * This card is the rollout story, so it sits directly under the hero count. Every number in it
 * comes from `buildVelocityChart()` in `src/lib/starlink-chart.js` and `computeInstallPace()`
 * in `src/lib/starlink-utils.js`; this file maps them onto SVG elements and nothing else.
 *
 * Two honesty devices are load-bearing rather than decorative:
 *  - the OUTLIER CAP. `dateFound` is a detection date, and one 117-aircraft tracker catch-up
 *    batch on 2025-12-03 would otherwise flatten every real month into a sliver. The capped
 *    bar keeps a zig-zag break, an `N*` label and a footnote saying exactly what was cut.
 *  - the ETA's denominator is EXPRESS REMAINING ONLY. Much of the mainline widebody fleet is
 *    ageing out and may never be equipped; counting it would produce a date nobody means.
 *
 * A chart is an image to a screen reader, so `role="img"` carries the headline and the full
 * month-by-month series follows as a visually-hidden table — the same data, linearised.
 */

import { memo } from 'react';

import { Card } from '@/components/ui/card';
import { STARLINK_CHART_COLORS } from '@/lib/starlink-chart.js';

export type VelocityModel = {
  width: number;
  height: number;
  gridLeft: number;
  gridRight: number;
  cap: number;
  maxCum: number;
  bars: {
    ym: string;
    label: string;
    total: number;
    express: number;
    mainline: number;
    cumulative: number;
    x: number;
    width: number;
    expressRect: { y: number; height: number } | null;
    mainlineRect: { y: number; height: number } | null;
    capped: boolean;
    zigzag: string | null;
    countLabel: { x: number; y: number; text: string } | null;
    monthLabel: { x: number; y: number; text: string } | null;
  }[];
  leftTicks: { value: number; y: number }[];
  rightTicks: { value: number; y: number }[];
  linePath: string;
  dots: { cx: number; cy: number }[];
  endValue: { x: number; y: number; text: number };
  subtitle: string;
  footnote: string;
};

export type PaceModel = {
  /** Trailing weekly pace, already rounded for display; null hides the caption. */
  pace: string;
  paceNote: string;
  eta: string;
  etaNote: string;
} | null;

export const VelocityChart = memo(function VelocityChart({
  model,
  pace,
}: {
  model: VelocityModel;
  pace: PaceModel;
}) {
  const last = model.bars[model.bars.length - 1];
  return (
    <Card className="gap-0 p-4" id="sl-chart-card">
      <h3 className="text-sm font-semibold">Installation Velocity</h3>
      <p className="text-[11px] text-muted-foreground" id="sl-chart-sub">
        {model.subtitle}
      </p>

      {/* The chart keeps a readable minimum width and scrolls on a phone rather than shrinking
          eighteen month labels into an unreadable smear. */}
      <div className="mt-3 -mx-1 overflow-x-auto px-1">
        <svg
          id="sl-chart"
          viewBox={`0 0 ${model.width} ${model.height}`}
          className="h-auto w-full min-w-[620px]"
          role="img"
          aria-label={`Starlink installations per month. ${model.subtitle}. ${last.cumulative} aircraft equipped in total; the busiest month added ${Math.max(...model.bars.map((b) => b.total))}.`}
        >
          {model.leftTicks.map((tick) => (
            <g key={`l${tick.value}-${tick.y}`}>
              <line
                x1={model.gridLeft}
                y1={tick.y}
                x2={model.gridRight}
                y2={tick.y}
                className="stroke-border"
                strokeWidth={1}
              />
              <text
                x={model.gridLeft - 6}
                y={tick.y + 3}
                className="fill-muted-foreground"
                fontSize={9}
                textAnchor="end"
              >
                {tick.value}
              </text>
            </g>
          ))}

          {model.bars.map((bar) => (
            <g key={bar.ym}>
              {bar.total > 0 ? (
                <title>{`${bar.label}: ${bar.total} equipped (${bar.express} Express, ${bar.mainline} Mainline)`}</title>
              ) : null}
              {bar.expressRect ? (
                <rect
                  x={bar.x}
                  y={bar.expressRect.y}
                  width={bar.width}
                  height={bar.expressRect.height}
                  fill={STARLINK_CHART_COLORS.express}
                  opacity={0.85}
                  rx={1}
                />
              ) : null}
              {bar.mainlineRect ? (
                <rect
                  x={bar.x}
                  y={bar.mainlineRect.y}
                  width={bar.width}
                  height={bar.mainlineRect.height}
                  fill={STARLINK_CHART_COLORS.mainline}
                  opacity={0.9}
                  rx={1}
                />
              ) : null}
              {bar.zigzag ? (
                <path d={bar.zigzag} className="stroke-muted-foreground" fill="none" strokeWidth={1.5} />
              ) : null}
              {bar.countLabel ? (
                <text
                  x={bar.countLabel.x}
                  y={bar.countLabel.y}
                  fill={bar.capped ? STARLINK_CHART_COLORS.express : undefined}
                  className={bar.capped ? undefined : 'fill-muted-foreground'}
                  fontSize={bar.capped ? 10 : 9}
                  fontWeight={bar.capped ? 700 : undefined}
                  textAnchor="middle"
                >
                  {bar.countLabel.text}
                </text>
              ) : null}
              {bar.monthLabel ? (
                <text
                  x={bar.monthLabel.x}
                  y={bar.monthLabel.y}
                  className="fill-muted-foreground"
                  fontSize={8.5}
                  textAnchor="middle"
                >
                  {bar.monthLabel.text}
                </text>
              ) : null}
            </g>
          ))}

          <path
            d={model.linePath}
            stroke={STARLINK_CHART_COLORS.cumulative}
            strokeWidth={2}
            fill="none"
          />
          {model.dots.map((dot) => (
            <circle
              key={`${dot.cx}-${dot.cy}`}
              cx={dot.cx}
              cy={dot.cy}
              r={2.5}
              fill={STARLINK_CHART_COLORS.cumulative}
            />
          ))}
          {model.rightTicks.map((tick) => (
            <text
              key={`r${tick.value}-${tick.y}`}
              x={model.gridRight + 8}
              y={tick.y + 3}
              fill={STARLINK_CHART_COLORS.cumulative}
              opacity={0.7}
              fontSize={9}
            >
              {tick.value}
            </text>
          ))}
          <text
            x={model.endValue.x}
            y={model.endValue.y}
            fill={STARLINK_CHART_COLORS.cumulative}
            fontSize={11}
            fontWeight={700}
            textAnchor="end"
          >
            {model.endValue.text}
          </text>
        </svg>
      </div>

      {/* The chart's data, linearised. `sr-only` rather than a <details>: this is the same
          information, not extra information, and a sighted reader already has the picture. */}
      <table className="sr-only">
        <caption>Starlink installations per month</caption>
        <thead>
          <tr>
            <th scope="col">Month</th>
            <th scope="col">Express</th>
            <th scope="col">Mainline</th>
            <th scope="col">Total</th>
            <th scope="col">Cumulative</th>
          </tr>
        </thead>
        <tbody>
          {model.bars.map((bar) => (
            <tr key={bar.ym}>
              <th scope="row">{bar.ym}</th>
              <td>{bar.express}</td>
              <td>{bar.mainline}</td>
              <td>{bar.total}</td>
              <td>{bar.cumulative}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block size-2 rounded-xs"
            style={{ background: STARLINK_CHART_COLORS.express }}
          />
          Express
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block size-2 rounded-xs"
            style={{ background: STARLINK_CHART_COLORS.mainline }}
          />
          Mainline
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block h-0.5 w-4"
            style={{ background: STARLINK_CHART_COLORS.cumulative }}
          />
          Cumulative
        </span>
      </div>

      {model.footnote ? (
        <p className="mt-2 text-[10px] text-muted-foreground" id="sl-chart-footnote">
          {model.footnote}
        </p>
      ) : null}

      {pace ? (
        <div className="mt-3 grid grid-cols-2 gap-3 border-t pt-3" id="sl-velo-stats">
          <div>
            <p className="text-[10px] tracking-wider text-muted-foreground uppercase">Avg / Wk</p>
            <p className="font-mono text-lg font-semibold tabular-nums" id="sl-trend-pace">
              {pace.pace}
            </p>
            <p className="text-[10px] text-muted-foreground" id="sl-trend-pace-note">
              {pace.paceNote}
            </p>
          </div>
          <div>
            <p className="text-[10px] tracking-wider text-muted-foreground uppercase">
              Express · 100% ETA
            </p>
            <p
              className="font-mono text-lg font-semibold tabular-nums"
              id="sl-trend-eta"
              style={{ color: STARLINK_CHART_COLORS.cumulative }}
            >
              {pace.eta}
            </p>
            <p className="text-[10px] text-muted-foreground" id="sl-trend-eta-note">
              {pace.etaNote}
            </p>
          </div>
        </div>
      ) : null}
    </Card>
  );
});

export default VelocityChart;
