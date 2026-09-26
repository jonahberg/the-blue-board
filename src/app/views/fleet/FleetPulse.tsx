/**
 * Zone 1, left — "how much of the fleet is in the air right now?" (inventory §21).
 *
 * The subtitle's "N mainline matched · N regional/partner" is the honest footnote under the
 * airborne count: the feed carries every United-coded flight, but only mainline airframes are
 * in the fleet database, so roughly a third of what is flying can never appear in the bars
 * below. Saying that outright is what stops the utilisation figure from reading as a
 * discrepancy.
 *
 * Per-type bars are drawn only for types with at least one aircraft airborne — nineteen rows
 * of "0/76 0%" at 04:00 UTC is a table of zeroes, not a pulse.
 */

import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';

export type TypeUtilisation = { type: string; flying: number; total: number; pct: number };

export function FleetPulse({
  airborne,
  matched,
  unmatched,
  fleetTotal,
  utilisation,
  updatedAt,
  loading,
  fleetFailed = false,
}: {
  airborne: number;
  matched: number;
  unmatched: number;
  fleetTotal: number;
  utilisation: TypeUtilisation[];
  /** `HH:MM:SS` in UTC, or null before the first poll. */
  updatedAt: string | null;
  loading: boolean;
  /** True when `/data/fleet.json` failed: the airborne count still stands, the split cannot. */
  fleetFailed?: boolean;
}) {
  const flying = utilisation.filter((row) => row.total > 0 && row.flying > 0);
  const utilPct = fleetTotal > 0 ? Math.round((matched / fleetTotal) * 100) : 0;

  return (
    <div className="flex min-w-0 flex-col">
      <div className="flex items-baseline gap-3">
        <span
          className="font-mono text-5xl font-semibold tabular-nums"
          id="fleet-airborne-count"
        >
          {loading && !airborne ? <Skeleton className="inline-block h-10 w-24 align-middle" /> : airborne}
        </span>
        <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
          Airborne
        </span>
      </div>

      {/* Without the fleet database every flight is UNMATCHED, not regional — calling 348
          aircraft "regional/partner" because we cannot look them up is the same class of
          false claim as reporting "0 aircraft" for a file that failed to load. */}
      <p className="mt-1 text-xs text-muted-foreground">
        {!airborne
          ? 'Loading live flight data…'
          : fleetFailed
            ? 'Mainline / regional split unavailable — the fleet database did not load'
            : `${matched} mainline matched · ${unmatched} regional/partner`}
      </p>

      {fleetTotal > 0 && airborne > 0 ? (
        <p className="mt-0.5 text-xs font-medium text-primary">
          {utilPct}% fleet utilization ({matched}/{fleetTotal})
        </p>
      ) : null}

      {flying.length > 0 ? (
        <ul className="mt-3 space-y-1">
          {flying.map((row) => (
            <li key={row.type} className="flex items-center gap-2 text-[11px]">
              <span className="w-20 shrink-0 truncate font-mono text-muted-foreground">
                {row.type}
              </span>
              <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                <span
                  className="block h-full rounded-full bg-primary"
                  style={{ width: `${row.pct}%` }}
                />
              </span>
              <span className="w-20 shrink-0 text-right font-mono tabular-nums text-muted-foreground">
                {row.flying}/{row.total} {row.pct}%
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {updatedAt ? (
        <p className="mt-3 flex items-center gap-2 text-[10px] text-muted-foreground">
          <Badge variant="outline" className="gap-1 text-[10px]">
            <span
              aria-hidden="true"
              className="inline-block size-1.5 animate-pulse rounded-full bg-emerald-400"
            />
            LIVE
          </Badge>
          <span className="font-mono">Updated {updatedAt}Z</span>
        </p>
      ) : null}
    </div>
  );
}

export default FleetPulse;
