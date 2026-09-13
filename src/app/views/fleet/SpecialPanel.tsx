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
 */

import { Skeleton } from '@/components/ui/skeleton';

export type SpecialRow = {
  reg: string;
  name: string;
  kind: string;
  type: string;
  delivered: string;
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
            key={row.reg}
            className="flex items-start justify-between gap-3 rounded-lg border bg-card p-3"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{row.name}</p>
              <p className="mt-0.5 text-xs">
                <button
                  type="button"
                  onClick={() => onOpenAircraft(row.reg)}
                  className="min-h-11 font-mono text-primary underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring md:min-h-0"
                >
                  {row.reg}
                </button>{' '}
                <span className="text-muted-foreground">
                  {row.type} · Del {row.delivered}
                </span>
              </p>
            </div>
            <div className="shrink-0 text-right">
              {row.airborne ? (
                <>
                  <span className="inline-flex items-center gap-1 rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-medium text-emerald-400">
                    <span
                      aria-hidden="true"
                      className="inline-block size-1.5 animate-pulse rounded-full bg-emerald-400"
                    />
                    AIRBORNE
                  </span>
                  <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                    {row.airborne.flight} {row.airborne.route}
                  </p>
                </>
              ) : (
                <span className="rounded border px-1.5 py-0.5 text-[9px] font-medium text-amber-400">
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
