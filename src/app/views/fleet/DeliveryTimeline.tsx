/**
 * Zone 2 — every delivery year since the fleet's oldest airframe, coloured by family
 * (inventory §21 `renderAgeChart()`).
 *
 * Inline SVG rather than a stack of divs: the chart has to survive a 400 px phone and a
 * 1440 px desktop, and one `viewBox` does that without a resize observer or a chart library.
 * Everything numeric — the year buckets, the stacked segment heights, the 1 px floor, which
 * bars get a printed count, which years get an axis label — comes from
 * `buildDeliveryTimeline()` in `src/lib/fleet-view.js`, so the picture is tested.
 *
 * What the chart is FOR: the shape says the fleet's age at a glance. The 1997-2002 hump is
 * the 737NG and A320 order book; the flat 2009-2012 stretch is the recession; the wall on the
 * right is the MAX and the A321neo arriving at once.
 */

import { Skeleton } from '@/components/ui/skeleton';

export type TimelineYear = {
  year: number;
  total: number;
  segments: { color: string; count: number; height: number }[];
  height: number;
  showCount: boolean;
  showYear: boolean;
};
export type TimelineModel = {
  years: TimelineYear[];
  minYear: number | null;
  maxYear: number | null;
  maxCount: number;
  legend: { color: string; name: string }[];
};
export type TimelineStats = {
  avgAge: string;
  newest: { r?: string; d?: string | number } | null;
  oldest: { r?: string; d?: string | number } | null;
  decades: { label: string; count: number }[];
};

/** Per-year horizontal slot, in viewBox units. Bars leave a 2-unit gutter. */
const SLOT = 20;
const BAR_W = 18;
/** Room above the bars for the printed counts. */
const LABEL_BAND = 12;
const CHART_H = 140;
/** Room below the baseline for the year labels. */
const AXIS_BAND = 14;

export function DeliveryTimeline({
  model,
  stats,
  loading,
}: {
  model: TimelineModel;
  stats: TimelineStats;
  loading: boolean;
}) {
  if (loading && !model.years.length) return <Skeleton className="h-40 w-full" />;
  if (!model.years.length) {
    return <p className="text-xs text-muted-foreground">No delivery years in the fleet data.</p>;
  }

  const width = model.years.length * SLOT;
  const height = LABEL_BAND + CHART_H + AXIS_BAND;
  const baseline = LABEL_BAND + CHART_H;

  return (
    <div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto w-full"
        role="img"
        aria-label={`United mainline deliveries by year, ${model.minYear} to ${model.maxYear}. Busiest year: ${model.maxCount} aircraft.`}
      >
        {model.years.map((bar, index) => {
          const x = index * SLOT + (SLOT - BAR_W) / 2;
          let y = baseline - bar.height;
          return (
            <g key={bar.year}>
              {bar.total > 0 ? <title>{`${bar.year}: ${bar.total} aircraft`}</title> : null}
              {bar.showCount ? (
                <text
                  x={x + BAR_W / 2}
                  y={baseline - bar.height - 2}
                  textAnchor="middle"
                  className="fill-primary"
                  fontSize="8"
                  fontWeight="700"
                >
                  {bar.total}
                </text>
              ) : null}
              {bar.segments.map((segment, segIndex) => {
                const segY = y;
                y += segment.height;
                return (
                  <rect
                    key={`${segment.color}-${segIndex}`}
                    x={x}
                    y={segY}
                    width={BAR_W}
                    height={segment.height}
                    fill={segment.color}
                  />
                );
              })}
              {bar.showYear ? (
                <text
                  x={x + BAR_W / 2}
                  y={baseline + AXIS_BAND - 4}
                  textAnchor="middle"
                  className="fill-muted-foreground"
                  fontSize="8"
                >
                  {bar.year}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>

      <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
        {model.legend.map((entry) => (
          <li
            key={entry.color}
            className="flex items-center gap-1 text-[10px] text-muted-foreground"
          >
            <span
              aria-hidden="true"
              className="inline-block size-2 rounded-sm"
              style={{ background: entry.color }}
            />
            {entry.name}
          </li>
        ))}
      </ul>

      <p className="mt-3 text-[11px] text-muted-foreground">
        Average: <strong className="font-medium text-primary">{stats.avgAge}y</strong>
        {stats.newest ? (
          <>
            {' · '}Newest:{' '}
            <strong className="font-medium text-emerald-400">
              {stats.newest.r} ({stats.newest.d})
            </strong>
          </>
        ) : null}
        {stats.oldest ? (
          <>
            {' · '}Oldest:{' '}
            <strong className="font-medium text-amber-400">
              {stats.oldest.r} ({stats.oldest.d})
            </strong>
          </>
        ) : null}
      </p>
      <p className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
        {stats.decades.map((bucket) => (
          <span key={bucket.label}>
            {bucket.label}: <strong className="font-medium text-foreground">{bucket.count}</strong>
          </span>
        ))}
      </p>
    </div>
  );
}

export default DeliveryTimeline;
