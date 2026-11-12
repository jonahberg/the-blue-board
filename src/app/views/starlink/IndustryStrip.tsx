/**
 * Industry Starlink coverage — one thin bar per carrier, best-covered first
 * (inventory §22, `renderSlIndustry()`).
 *
 * Deliberately quiet: this is context for the rollout above it, not a second headline, so it
 * carries no big numbers and United is distinguished by colour AND by its own label weight
 * rather than by size.
 *
 * `buildIndustryRows()` returns null unless EVERY carrier has a finite percentage, and this
 * component renders nothing in that case. A half-populated comparison chart ranks carriers on
 * data we only hold for some of them, which is the one thing a bar chart must never do.
 *
 * Alaska and Hawaiian are one airline, so they arrive as one "AS+HA" row summed from their
 * counts (Nov 2026). The title and the Hawaiian footnote sentence come from
 * `industryStripCopy()`: "Starlink Coverage · United vs Alaska" when the strip is exactly those
 * two rows, "Industry · Starlink Coverage" otherwise. Each code is followed by the carrier's
 * name for screen readers and carries it as a hover title.
 */

import { memo } from 'react';

import { Card } from '@/components/ui/card';
import { STARLINK_CHART_COLORS } from '@/lib/starlink-chart.js';
import { industryStripCopy } from '@/lib/starlink-roster.js';

export type IndustryRow = {
  code: string;
  /** The carrier's name ('Alaska Airlines + Hawaiian Airlines' on the merged row), if sent. */
  name: string | null;
  isUA: boolean;
  pct: number;
  width: number;
  installed: number | null;
  total: number | null;
};

export const IndustryStrip = memo(function IndustryStrip({ rows }: { rows: IndustryRow[] }) {
  const copy = industryStripCopy(rows) as { title: string; note: string | null };
  return (
    <Card className="gap-0 p-4" id="sl-industry">
      <p
        className="text-[11px] font-semibold tracking-widest text-muted-foreground uppercase"
        id="sl-industry-title"
      >
        {copy.title}
      </p>
      <div className="mt-3 space-y-1.5" id="sl-industry-bars">
        {rows.map((row) => (
          <div key={row.code} className="flex items-center gap-2" data-carrier={row.code}>
            <span
              className={`relative w-10 shrink-0 font-mono text-[11px] whitespace-nowrap ${row.isUA ? 'font-bold' : 'text-muted-foreground'}`}
              title={row.name ?? undefined}
            >
              {row.name ? (
                <>
                  <span aria-hidden="true">{row.code}</span>
                  <span className="sr-only">{row.name}</span>
                </>
              ) : (
                row.code
              )}
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
      <p className="mt-2 text-[10px] text-muted-foreground" id="sl-industry-note">
        Coverage is installed aircraft as a share of each carrier's tracked fleet upstream, not
        of its full mainline. Counts are the industry tracker's own snapshot, so United's can
        differ by a few from the equipped total above.{copy.note ? ` ${copy.note}` : null}
      </p>
    </Card>
  );
});

export default IndustryStrip;
