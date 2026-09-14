/**
 * Industry · Starlink Coverage — one thin bar per carrier, best-covered first
 * (inventory §22, `renderSlIndustry()`).
 *
 * Deliberately quiet: this is context for the rollout above it, not a second headline, so it
 * carries no big numbers and United is distinguished by colour AND by its own label weight
 * rather than by size.
 *
 * `buildIndustryRows()` returns null unless EVERY carrier has a finite percentage, and this
 * component renders nothing in that case. A half-populated comparison chart ranks carriers on
 * data we only hold for some of them, which is the one thing a bar chart must never do.
 */

import { memo } from 'react';

import { Card } from '@/components/ui/card';
import { STARLINK_CHART_COLORS } from '@/lib/starlink-chart.js';

export type IndustryRow = {
  code: string;
  isUA: boolean;
  pct: number;
  width: number;
  installed: number | null;
  total: number | null;
};

export const IndustryStrip = memo(function IndustryStrip({ rows }: { rows: IndustryRow[] }) {
  return (
    <Card className="gap-0 p-4" id="sl-industry">
      <p className="text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
        Industry · Starlink Coverage
      </p>
      <div className="mt-3 space-y-1.5" id="sl-industry-bars">
        {rows.map((row) => (
          <div key={row.code} className="flex items-center gap-2">
            <span
              className={`w-10 shrink-0 font-mono text-[11px] ${row.isUA ? 'font-bold' : 'text-muted-foreground'}`}
            >
              {row.code}
            </span>
            <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
              <div
                className={`h-full rounded-full ${row.isUA ? '' : 'bg-muted-foreground/40'}`}
                style={{
                  width: `${row.width}%`,
                  background: row.isUA ? STARLINK_CHART_COLORS.ua : undefined,
                }}
              />
            </div>
            <span className="w-28 shrink-0 text-right font-mono text-[11px] tabular-nums text-muted-foreground">
              {row.installed ?? '—'} / {row.total ?? '—'} · {row.pct}%
            </span>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[10px] text-muted-foreground">
        Coverage is installed aircraft as a share of each carrier's tracked fleet upstream, not
        of its full mainline.
      </p>
    </Card>
  );
});

export default IndustryStrip;
