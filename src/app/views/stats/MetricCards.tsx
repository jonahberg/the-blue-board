/**
 * The four numbers at the top of the Stats tab (inventory §25).
 *
 * Deliberately NOT charts. Each of these is a single figure whose job is to be read, not
 * compared — a bar or a sparkline around one number is decoration that costs a reader
 * time. A card's subtitle carries the "N of M" a percentage was computed from, because
 * "62 %" means nothing without it.
 *
 * Markup: each card is a `<dl>` group (a div is allowed) holding `<dt>` then `<dd>`s, in that
 * order, so a screen reader hears the term before its value (F42). The big number still sits
 * on top visually through flex `order`, which changes paint order only.
 */

import { Card } from '@/components/ui/card';

export type Metric = { label: string; value: string; sub?: string };

export function MetricCards({ metrics }: { metrics: Metric[] }) {
  return (
    <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {metrics.map((metric) => (
        <Card key={metric.label} size="sm" className="px-4">
          <dt className="order-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {metric.label}
          </dt>
          <dd className="order-1 font-mono text-3xl font-semibold tabular-nums">{metric.value}</dd>
          {metric.sub ? (
            <dd className="order-3 text-[10px] text-muted-foreground">{metric.sub}</dd>
          ) : null}
        </Card>
      ))}
    </dl>
  );
}
