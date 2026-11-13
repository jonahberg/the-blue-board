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
 *
 * A card whose destination lists exactly what it counts links there (`metricLink`,
 * src/lib/stats-links.js): its label is the card's one link, in link colour, stretched over the
 * whole card so the card is one target, and named for a screen reader by its label plus where it
 * goes. The other cards render no link at all.
 */

import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { DashLink } from '../../features/DashLink';

export type Metric = {
  label: string;
  value: string;
  sub?: string;
  /** Where the card goes (`metricLink`); absent or null, the card is text. */
  link?: { href: string; where: string } | null;
};

/**
 * The label link, stretched over the card (which is `relative`). Its focus ring is drawn on the
 * stretched box, so a keyboard sees the whole card ringed rather than the label alone.
 */
const STRETCHED =
  'after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-ring';

/**
 * Always two columns: at `lg` the Stats tab pairs this 2×2 block with the phase donut beside it
 * (`StatsView.tsx`), where a 1×4 row used to sit above a donut card that was two-thirds empty.
 */
export function MetricCards({ metrics }: { metrics: Metric[] }) {
  return (
    <dl className="grid grid-cols-2 gap-3">
      {metrics.map((metric) => (
        <Card key={metric.label} size="sm" className={cn('px-4', metric.link && 'relative')}>
          <dt className="order-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {metric.link ? (
              <DashLink href={metric.link.href} tone="identity" hit="none" className={STRETCHED}>
                {metric.label}{' '}
                <span className="sr-only">({metric.link.where})</span>
              </DashLink>
            ) : (
              metric.label
            )}
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
