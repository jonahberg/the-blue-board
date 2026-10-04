/**
 * Zone 3, "Special" — the named aircraft and the special liveries (inventory §21).
 *
 * United names airframes after employees and paints a handful in commemorative schemes, and
 * the fleet site publishes both in one free-text column. This panel is the payoff for
 * `indexSpecialAircraft()` parsing it: a spotter's list of which of them exist and, crossed
 * against the live feed, which one is in the air right now.
 *
 * An airborne entry shows the pulse plus its flight and route; a grounded one shows NAMED or
 * LIVERY, so the badge always says which kind of special this is rather than only that it is
 * one.
 *
 * The curated paint schemes (`kind: 'paint'`, from src/data/special-liveries.js) lead the
 * list with their one-line description under the name. They are the hand-verified answer to
 * "which United jets wear a special livery?"; the fleet site's column carries no sources.
 */

import { Paintbrush } from 'lucide-react';

import { Skeleton } from '@/components/ui/skeleton';

export type SpecialRow = {
  /** reg + kind: a tail with a name AND a livery (N76021) is two cards. */
  key: string;
  reg: string;
  name: string;
  /** 'paint' (curated livery) | 'named' | 'livery' (the fleet site's sticker/livery note). */
  kind: string;
  type: string;
  delivered: string;
  description?: string;
  airborne: { flight: string; route: string } | null;
};

export function SpecialPanel({
  rows,
  loading,
  onOpenAircraft,
}: {
  rows: SpecialRow[];
  loading: boolean;
  onOpenAircraft: (reg: string) => void;
}) {
  if (loading && !rows.length) {
    return (
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    );
  }

  if (!rows.length) {
    return (
      <p className="rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">
        No special aircraft found
      </p>
    );
  }

  return (
    <div
      tabIndex={0}
      aria-label="Special fleet list, scrollable region"
      className="max-h-[60svh] overflow-auto rounded-lg focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
    >
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {rows.map((row) => (
          <li
            key={row.key}
            className="flex items-start justify-between gap-3 rounded-lg border bg-card p-3"
          >
            <div className="min-w-0">
              <p className="flex min-w-0 items-center gap-1 text-sm font-medium">
                {row.kind === 'paint' ? (
                  <Paintbrush aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
                ) : null}
                <span className="truncate">{row.name}</span>
              </p>
              {row.description ? (
                <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{row.description}</p>
              ) : null}
              <p className="mt-0.5 text-xs">
                <button
                  type="button"
                  onClick={() => onOpenAircraft(row.reg)}
                  className="min-h-11 font-mono text-primary underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring pointer-fine:md:min-h-0"
                >
                  {row.reg}
                </button>{' '}
                <span className="text-muted-foreground">
                  {row.type ? `${row.type} · Del ${row.delivered}` : 'Not in the mainline fleet database'}
                </span>
              </p>
            </div>
            <div className="shrink-0 text-right">
              {row.airborne ? (
                <>
                  <span className="inline-flex items-center gap-1 rounded border border-bb-ok/30 bg-bb-ok/10 px-1.5 py-0.5 text-[9px] font-medium text-bb-ok">
                    <span
                      aria-hidden="true"
                      className="inline-block size-1.5 animate-pulse rounded-full bg-bb-ok"
                    />
                    AIRBORNE
                  </span>
                  <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                    {row.airborne.flight} {row.airborne.route}
                  </p>
                </>
              ) : (
                <span className="rounded border px-1.5 py-0.5 text-[9px] font-medium text-foreground">
                  {row.kind === 'named' ? 'NAMED' : 'LIVERY'}
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default SpecialPanel;
