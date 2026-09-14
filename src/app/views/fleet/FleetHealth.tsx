/**
 * Zone 1, right — the fleet's own health, and the Starlink rollout against it (inventory §21).
 *
 * The bars are the maintenance picture the fleet site publishes in free text, folded into the
 * seven categories `categorizeFleetStatus()` recognises. Each row is dot + label + count + per
 * cent: the colour repeats what the label already says, so the panel survives being read in
 * greyscale or by a screen reader.
 *
 * The load-failure state is its own thing and deliberately blunt. "0 Mainline Aircraft" is a
 * factual claim the dashboard has no business making when `/data/fleet.json` simply did not
 * arrive, so the panel says which of the two happened (F035).
 */

import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';

export type HealthBar = { key: string; label: string; color: string; count: number; pct: string };
export type HealthModel = {
  total: number;
  active: number;
  nonActive: number;
  activePct: string;
  bars: HealthBar[];
};

export type StarlinkChip = { label: string; value: string; tone: 'ok' | 'primary' | 'express' | 'neutral' | 'new' };

const CHIP_TONES: Record<StarlinkChip['tone'], string> = {
  ok: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400',
  primary: 'border-primary/20 bg-primary/10 text-primary',
  express: 'border-violet-500/20 bg-violet-500/10 text-violet-400',
  neutral: 'border-border bg-muted/40 text-foreground',
  new: 'border-amber-500/25 bg-amber-500/10 text-amber-400',
};

export function FleetLoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="text-xs leading-relaxed text-muted-foreground">
      <p className="text-sm font-medium text-foreground">Fleet database unavailable</p>
      <p className="mt-1">
        The fleet database could not be loaded, so counts and per-type stats are unavailable
        right now. <strong className="font-medium text-foreground">This is a load error — not zero aircraft.</strong>
      </p>
      <Button size="lg" className="mt-3 min-h-11 md:min-h-0" onClick={onRetry}>
        ↻ Retry
      </Button>
    </div>
  );
}

export function FleetHealth({
  health,
  starlinkInstalled,
  chips,
  loading,
}: {
  health: HealthModel | null;
  /** Mainline aircraft confirmed with Starlink, over the whole mainline fleet. */
  starlinkInstalled: number;
  chips: StarlinkChip[];
  loading: boolean;
}) {
  const pct = health && health.total > 0 ? Math.round((starlinkInstalled / health.total) * 100) : 0;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {!health ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-40" />
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-4 w-full" />
          ))}
        </div>
      ) : (
        <div>
          <div className="flex items-baseline gap-3">
            <span className="font-mono text-4xl font-semibold tabular-nums">{health.total}</span>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Total Mainline Aircraft
              </p>
              <p className="text-xs">
                {health.active} active ({health.activePct}%) · {health.nonActive} out of service
              </p>
            </div>
          </div>

          <ul className="mt-3 space-y-1">
            {health.bars.map((bar) => (
              <li
                key={bar.key}
                className="flex items-center gap-2 text-[11px]"
                aria-label={`${bar.label}: ${bar.count} of ${health.total}, ${bar.pct}%`}
              >
                <span className="flex w-32 shrink-0 items-center gap-1.5 truncate">
                  <span
                    aria-hidden="true"
                    className="inline-block size-2 shrink-0 rounded-full"
                    style={{ background: bar.color }}
                  />
                  {bar.label}
                </span>
                <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                  <span
                    className="block h-full rounded-full"
                    style={{ width: `${(bar.count / health.total) * 100}%`, background: bar.color }}
                  />
                </span>
                <span className="w-20 shrink-0 text-right font-mono tabular-nums text-muted-foreground">
                  {bar.count} ({bar.pct}%)
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <div className="flex items-center gap-2">
          <Progress
            value={pct}
            className="h-2 min-w-0 flex-1"
            aria-label="Starlink-equipped share of the mainline fleet"
          />
          <span className="shrink-0 font-mono text-xs tabular-nums">
            {health ? `${pct}% (${starlinkInstalled}/${health.total})` : '—'}
          </span>
        </div>
        <p className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">
          Starlink Equipped
        </p>

        {chips.length > 0 ? (
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {chips.map((chip) => (
              <li
                key={chip.label}
                className={`flex flex-col items-center rounded-md border px-2 py-1 ${CHIP_TONES[chip.tone]}`}
              >
                <span className="font-mono text-sm font-semibold tabular-nums">{chip.value}</span>
                <span className="text-[9px] uppercase tracking-wide text-muted-foreground">
                  {chip.label}
                </span>
              </li>
            ))}
          </ul>
        ) : loading ? (
          <Skeleton className="mt-2 h-10 w-full" />
        ) : null}
      </div>
    </div>
  );
}

export default FleetHealth;
