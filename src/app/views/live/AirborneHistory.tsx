/**
 * The Live tab's 24-hour "United flights airborne" graph: a sparkline beside the Airborne stat
 * that opens a full chart in a Dialog.
 *
 * The samples come from `/api/airborne-history` — one row per successful 5-minute read of the
 * free live feed by the watch-alerts cron, counted by `countAirborne()`, the same function behind
 * the stat bar's unfiltered number. Every number and path here comes from
 * `src/lib/airborne-history.js`; this file maps them onto SVG and handles the pointer.
 *
 * Honesty devices that are load-bearing, not decorative:
 *  - the window is always the full 24 hours, and the stretch before the first sample is shaded
 *    and labelled "Collecting since …" — a young table is a short line at the right edge, never
 *    90 minutes stretched to pass for a day;
 *  - a gap (two or more missed reads) is a BREAK with a shaded "no data" band, never a drop to 0;
 *  - the readout names the sample's time and says it is a 5-minute sample, beside the live count,
 *    so a reader can see why the graph's last point and the map's number may differ by a few.
 */

import { ChartSpline } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent, RefObject } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  buildAirborneChart,
  buildSparkline,
  describeHistory,
  formatSampleTime,
  historyCoverage,
  normalizeSamples,
  nearestPointIndex,
  zoneLabel,
} from '@/lib/airborne-history.js';
import { cn } from '@/lib/utils';
import { fetchAirborneHistory } from '../../data/api';
import type { AirborneHistory } from '../../data/types';
import { useJson, useNow } from '../../state/hooks';

/** The sampler writes every 5 minutes and the CDN holds a body 5; polling faster buys nothing. */
const REFRESH_MS = 5 * 60_000;
const CHART_HEIGHT = 200;
const SPARK_W = 64;
const SPARK_H = 18;

type HistoryState = ReturnType<typeof useAirborneHistory>;

export function useAirborneHistory() {
  return useJson<AirborneHistory>(() => fetchAirborneHistory(24), {
    key: 'airborne-history-24',
    refreshMs: REFRESH_MS,
  });
}

/** The inline line: the last 24 h over its own extent, breaking at gaps. Icon until it has a shape. */
export function AirborneSparkline({
  history,
  className,
  width = SPARK_W,
  height = SPARK_H,
}: {
  history: AirborneHistory | null;
  className?: string;
  width?: number;
  height?: number;
}) {
  const now = useNow(60_000);
  const spark = useMemo(
    () => (history ? buildSparkline(history.samples, { nowMs: now, width, height }) : null),
    [history, now, width, height],
  );
  if (!spark) {
    return <ChartSpline aria-hidden="true" className={cn('size-4 shrink-0', className)} />;
  }
  return (
    <svg
      aria-hidden="true"
      data-testid="airborne-sparkline"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn('shrink-0 overflow-visible', className)}
    >
      {spark.segments.map((d, i) => (
        <path
          key={i}
          d={d}
          className="stroke-primary"
          fill="none"
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      ))}
      {spark.dots.map((dot, i) => (
        <circle key={`d${i}`} cx={dot.cx} cy={dot.cy} r={1.25} className="fill-primary" />
      ))}
      <circle cx={spark.last.cx} cy={spark.last.cy} r={2} className="fill-primary" />
    </svg>
  );
}

/** Container width, measured — the chart is drawn at real pixels so its labels stay legible. */
function useMeasuredWidth<T extends HTMLElement>(): [RefObject<T | null>, number | null] {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState<number | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    // clientWidth, not getBoundingClientRect: the dialog opens with a zoom-in transform, and a
    // transformed box would size the chart 5% small for good.
    // 0 means "not laid out yet" (or jsdom): draw at a sane width and let the observer correct it.
    const read = () => setWidth(el.clientWidth || 600);
    read();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

function AirborneChart({
  history,
  now,
  selectedT,
  onSelect,
}: {
  history: AirborneHistory | null;
  now: number;
  /** The picked sample's time (null = the latest). A time, not an index: the window slides
   *  every minute and refreshes every five, and an index would silently jump a sample. */
  selectedT: number | null;
  onSelect: (t: number | null) => void;
}) {
  const [boxRef, width] = useMeasuredWidth<HTMLDivElement>();
  const chart = useMemo(
    () =>
      width
        ? buildAirborneChart(history?.samples ?? [], { nowMs: now, width, height: CHART_HEIGHT })
        : null,
    [history, now, width],
  );
  const points = chart?.points ?? [];
  const picked = selectedT == null ? -1 : points.findIndex((p) => p.t === selectedT);
  const active = picked >= 0 ? picked : points.length - 1;
  const activePoint = points[active] ?? null;

  const pick = useCallback(
    (event: PointerEvent<SVGRectElement>) => {
      if (!chart) return;
      const svg = event.currentTarget.ownerSVGElement;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const x = ((event.clientX - rect.left) / (rect.width || 1)) * chart.width;
      const index = nearestPointIndex(points, x);
      if (index >= 0) onSelect(points[index].t);
    },
    [chart, points, onSelect],
  );

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (points.length === 0) return;
      const last = points.length - 1;
      const from = active;
      const step = event.shiftKey ? 12 : 1; // shift: an hour at a time
      let next: number | null = null;
      if (event.key === 'ArrowLeft') next = Math.max(0, from - step);
      else if (event.key === 'ArrowRight') next = Math.min(last, from + step);
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = last;
      if (next === null) return;
      event.preventDefault();
      onSelect(points[next].t);
    },
    [points, active, onSelect],
  );

  const valueText = activePoint
    ? `${activePoint.airborne.toLocaleString()} airborne at ${formatSampleTime(activePoint.t)}`
    : 'No samples yet';

  return (
    <div className="space-y-1">
      <p className="sr-only">{describeHistory(points)}</p>
      <div
        ref={boxRef}
        // A slider, so arrow keys walk the samples and a screen reader hears each value — the
        // readout above is not a live region (DESIGN.md's aria-live inventory).
        role="slider"
        tabIndex={points.length ? 0 : -1}
        aria-label="Airborne flights over the last 24 hours. Arrow keys move between samples."
        aria-valuemin={0}
        aria-valuemax={Math.max(0, points.length - 1)}
        aria-valuenow={Math.max(0, active)}
        aria-valuetext={valueText}
        onKeyDown={onKeyDown}
        data-testid="airborne-chart"
        className="relative w-full rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
        // pan-y: a vertical drag still scrolls the dialog; a horizontal one scrubs the chart.
        style={{ height: CHART_HEIGHT, touchAction: 'pan-y' }}
      >
        {chart ? (
          <svg
            aria-hidden="true"
            width={chart.width}
            height={chart.height}
            viewBox={`0 0 ${chart.width} ${chart.height}`}
            className="block select-none"
          >
            {chart.uncollected ? (
              <g data-testid="airborne-uncollected">
                <rect
                  x={chart.uncollected.x0}
                  y={chart.plot.top}
                  width={Math.max(0, chart.uncollected.x1 - chart.uncollected.x0)}
                  height={chart.plot.bottom - chart.plot.top}
                  className="fill-muted"
                  opacity={0.45}
                />
                {chart.uncollected.x1 - chart.uncollected.x0 > 150 && chart.points[0] ? (
                  <text
                    x={(chart.uncollected.x0 + chart.uncollected.x1) / 2}
                    y={(chart.plot.top + chart.plot.bottom) / 2}
                    textAnchor="middle"
                    className="fill-muted-foreground"
                    fontSize={11}
                  >
                    {`Collecting since ${formatSampleTime(chart.points[0].t)}`}
                  </text>
                ) : null}
              </g>
            ) : null}
            {chart.gaps.map((gap) => (
              <rect
                key={`g${gap.from}`}
                data-testid="airborne-gap"
                x={gap.x0}
                y={chart.plot.top}
                width={Math.max(1, gap.x1 - gap.x0)}
                height={chart.plot.bottom - chart.plot.top}
                className="fill-muted"
                opacity={0.45}
              />
            ))}

            {chart.yTicks.map((tick) => (
              <g key={`y${tick.value}`}>
                <line
                  x1={chart.plot.left}
                  x2={chart.plot.right}
                  y1={tick.y}
                  y2={tick.y}
                  className="stroke-border"
                  strokeWidth={1}
                />
                <text
                  x={chart.plot.left - 6}
                  y={tick.y + 3.5}
                  textAnchor="end"
                  className="fill-muted-foreground font-mono"
                  fontSize={10}
                >
                  {tick.label}
                </text>
              </g>
            ))}
            {chart.xTicks.map((tick) => (
              <g key={`x${tick.t}`}>
                <line
                  x1={tick.x}
                  x2={tick.x}
                  y1={tick.midnight ? chart.plot.top : chart.plot.bottom}
                  y2={chart.plot.bottom + 4}
                  className="stroke-border"
                  strokeWidth={1}
                  strokeDasharray={tick.midnight ? '3 3' : undefined}
                />
                <text
                  x={tick.x}
                  y={chart.plot.bottom + 15}
                  textAnchor="middle"
                  className={tick.midnight ? 'fill-foreground' : 'fill-muted-foreground'}
                  fontSize={10}
                >
                  {tick.label}
                </text>
              </g>
            ))}

            {chart.segments.map((segment) => (
              <path
                key={`s${segment.from}`}
                data-testid="airborne-segment"
                d={segment.path}
                className="stroke-primary"
                fill="none"
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ))}
            {chart.dots.map((dot) => (
              <circle key={`d${dot.t}`} cx={dot.cx} cy={dot.cy} r={2.5} className="fill-primary" />
            ))}

            {points.length === 0 ? (
              <text
                x={(chart.plot.left + chart.plot.right) / 2}
                y={(chart.plot.top + chart.plot.bottom) / 2}
                textAnchor="middle"
                className="fill-muted-foreground"
                fontSize={12}
              >
                No samples yet
              </text>
            ) : null}

            {activePoint ? (
              <g data-testid="airborne-cursor">
                <line
                  x1={activePoint.x}
                  x2={activePoint.x}
                  y1={chart.plot.top}
                  y2={chart.plot.bottom}
                  className="stroke-muted-foreground"
                  strokeWidth={1}
                  strokeDasharray="2 2"
                />
                <circle
                  cx={activePoint.x}
                  cy={activePoint.y}
                  r={4}
                  className="fill-primary stroke-popover"
                  strokeWidth={2}
                />
              </g>
            ) : null}

            {/* The hit area: the whole plot, so a tap anywhere picks the nearest sample. */}
            <rect
              x={chart.plot.left}
              y={0}
              width={chart.plot.right - chart.plot.left}
              height={chart.height}
              fill="transparent"
              onPointerDown={pick}
              onPointerMove={pick}
              onPointerLeave={(event) => {
                // A mouse leaving returns to the latest sample; a lifted finger keeps its pick.
                if (event.pointerType === 'mouse') onSelect(null);
              }}
            />
          </svg>
        ) : null}
      </div>
    </div>
  );
}

export function AirborneHistoryDialog({
  open,
  onOpenChange,
  history,
  liveAirborne,
  liveFresh,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  history: HistoryState;
  /** The Live tab's unfiltered count right now (`computeLiveStats().airborneAll`). */
  liveAirborne: number;
  /** The feed's LIVE/STALE state — the live count is only comparable when it is live. */
  liveFresh: boolean;
}) {
  // Always ticking (once a minute, cheap while closed): a clock paused while the dialog is shut
  // would open it on a window that ended whenever it was last open.
  const now = useNow(60_000);
  const [selectedT, setSelectedT] = useState<number | null>(null);
  useEffect(() => {
    if (!open) setSelectedT(null);
  }, [open]);

  const data = history.data;
  const points = useMemo(() => normalizeSamples(data?.samples ?? []), [data]);
  const asOf = data ? Date.parse(data.generatedAt) : NaN;
  const coverage = useMemo(
    () => historyCoverage(points, now, 24, { asOfMs: asOf }),
    [points, now, asOf],
  );
  // The chart filters to the window too; the readout reads the SAME list.
  const windowed = useMemo(
    () => points.filter((p) => p.t >= now - 24 * 3600_000 && p.t <= now + 60_000),
    [points, now],
  );
  const latest = windowed[windowed.length - 1];
  const shown = (selectedT != null && windowed.find((p) => p.t === selectedT)) || latest;
  const isLatest = !shown || shown === latest;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] gap-3 overflow-y-auto sm:max-w-2xl">
        <DialogHeader className="pr-8">
          <DialogTitle>United flights airborne · last 24 hours</DialogTitle>
          <DialogDescription className="text-xs">
            Every United and United Express flight in the live feed that is not on the ground, sampled
            about every 5 minutes. Map filters don&apos;t apply.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1" data-testid="airborne-readout">
          {shown ? (
            <>
              <span className="font-mono text-2xl font-semibold tabular-nums">
                {shown.airborne.toLocaleString()}
              </span>
              <span className="text-xs text-muted-foreground">
                airborne at <span className="font-mono">{formatSampleTime(shown.t)}</span>
                {isLatest ? ' · latest 5-minute sample' : ''}
                {shown.express != null
                  ? ` · ${(shown.airborne - shown.express).toLocaleString()} mainline, ${shown.express.toLocaleString()} Express`
                  : ''}
              </span>
              {liveFresh && liveAirborne > 0 ? (
                <span className="ml-auto text-xs text-muted-foreground" data-testid="airborne-live-now">
                  Live map now:{' '}
                  <span className="font-mono font-medium text-foreground tabular-nums">
                    {liveAirborne.toLocaleString()}
                  </span>
                </span>
              ) : null}
            </>
          ) : liveFresh && liveAirborne > 0 ? (
            // No history to read yet: lead with the number the visitor can trust right now.
            <>
              <span className="font-mono text-2xl font-semibold tabular-nums" data-testid="airborne-live-now">
                {liveAirborne.toLocaleString()}
              </span>
              <span className="text-xs text-muted-foreground">airborne now, on the live map</span>
            </>
          ) : (
            <span className="text-xs text-muted-foreground">
              {history.loading ? 'Loading history…' : 'No samples yet'}
            </span>
          )}
        </div>

        <AirborneChart history={data} now={now} selectedT={selectedT} onSelect={setSelectedT} />

        <div className="space-y-1 text-xs text-muted-foreground" data-testid="airborne-notes">
          {history.error && !data ? (
            <p className="flex flex-wrap items-center gap-2">
              Couldn&apos;t load the history.
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={history.refresh}>
                Try again
              </Button>
            </p>
          ) : null}
          {data && coverage.state === 'empty' ? (
            <p>
              {data.note
                ? `${data.note} The live count on the map is still current.`
                : 'Collecting has just started — the first 5-minute sample lands shortly, and the 24-hour graph fills in as data arrives.'}
            </p>
          ) : null}
          {coverage.state === 'partial' && coverage.since != null ? (
            <p className="text-foreground">
              Collecting since {formatSampleTime(coverage.since)} — the 24-hour graph fills in as
              data arrives.
            </p>
          ) : null}
          {coverage.stale && coverage.latest ? (
            <p>
              No new sample since {formatSampleTime(coverage.latest.t)} — the sampler is behind. The
              live count on the map is still current.
            </p>
          ) : null}
          {coverage.gaps > 0 ? (
            <p>
              A break in the line means the live feed couldn&apos;t be read for 15 minutes or more —
              it is missing data, not a drop to zero.
            </p>
          ) : null}
          <p>
            Times are in your time zone ({zoneLabel(now)}).
            {windowed.length > 0 ? ' Tap or hover the chart to read any sample.' : ''}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
