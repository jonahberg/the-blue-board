/**
 * The four numbers at the top of the Stats tab (inventory §25).
 *
 * Deliberately NOT charts. Each of these is a single figure whose job is to be read, not
 * compared — a bar or a sparkline around one number is decoration that costs a reader
 * time. The Starlink card is the only one with a subtitle, because "62 %" of an airborne
 * fleet means nothing without the "N of M" it was computed from.
 */

import { Card } from '@/components/ui/card';

export type Metric = { label: string; value: string; sub?: string };

export function MetricCards({ metrics }: { metrics: Metric[] }) {
  return (
    <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {metrics.map((metric) => (
        <Card key={metric.label} size="sm" className="px-4">
          <dd className="font-mono text-3xl font-semibold tabular-nums">{metric.value}</dd>
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {metric.label}
          </dt>
          {metric.sub ? <p className="text-[10px] text-muted-foreground">{metric.sub}</p> : null}
        </Card>
      ))}
    </dl>
  );
}
