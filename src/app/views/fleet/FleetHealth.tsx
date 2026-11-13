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
 *
 * Links everywhere (Nov 12 2026). A count is a button only where the Status select has an option
 * for exactly the aircraft it counts (ruling 7), and none here does: "active" counts named
 * aircraft and NEXT notes as active while Status "Active" lists only aircraft with no status note
 * (1,092 against 1,070 on the Nov 3 database), and "out of service" is a subset of Stored/Maint
 * (62 against 84); the other categories have no option. So the counts and bars stay text. Of the
 * Starlink chips, "Total" links to the Starlink tab (`href`); the rest have no exact home and are
 * body colour, never link colour.
 */

import { RotateCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { starlinkShareCaption } from '@/lib/fleet-utils.js';
import { DashLink } from '../../features/DashLink';

export type HealthBar = { key: string; label: string; color: string; count: number; pct: string };
export type HealthModel = {
  total: number;
  active: number;
  nonActive: number;
  activePct: string;
  bars: HealthBar[];
};

/** `href`: the chip is a quiet link to the Starlink tab (in place); without one it is text. */
export type StarlinkChip = { label: string; value: string; tone: 'ok' | 'express' | 'neutral'; href?: '/#starlink' };

const CHIP_TONES: Record<StarlinkChip['tone'], string> = {
  ok: 'border-bb-ok/20 bg-bb-ok/10 text-bb-ok',
  express: 'border-bb-starlink/20 bg-bb-starlink/10 text-bb-starlink',
  neutral: 'border-border bg-muted/40 text-foreground',
};

/** One chip's figure and label. */
function ChipContent({ chip }: { chip: StarlinkChip }) {
  return (
    <>
      <span className="font-mono text-sm font-semibold tabular-nums">{chip.value}</span>{' '}
      <span className="text-[9px] uppercase tracking-wide text-muted-foreground">{chip.label}</span>
    </>
  );
}

export function FleetLoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="text-xs leading-relaxed text-muted-foreground">
      <p className="text-sm font-medium text-foreground">Fleet database unavailable</p>
      <p className="mt-1">
        The fleet database could not be loaded, so counts and per-type stats are unavailable
        right now. <strong className="font-medium text-foreground">This is a load error — not zero aircraft.</strong>
      </p>
      <Button size="lg" className="mt-3 min-h-11 pointer-fine:md:min-h-0" onClick={onRetry}>
        <RotateCw aria-hidden="true" />
        Retry
      </Button>
    </div>
  );
}

export function FleetHealth({
  health,
  starlinkShare,
  chips,
  loading,
}: {
  health: HealthModel | null;
  /**
   * `starlinkMainlineShare()` — numerator and denominator from ONE population, the same figure
   * the "Mainline Fleet" chip shows (F93). Null until either source has loaded.
   */
  starlinkShare: { count: number; total: number; pct: number; source?: string } | null;
  chips: StarlinkChip[];
  loading: boolean;
}) {
  const pct = starlinkShare?.pct ?? 0;

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
            {starlinkShare ? `${pct}%` : '—'}
          </span>
        </div>
        <p className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">
          Starlink Equipped
        </p>
        {starlinkShare ? (
          // D15: the denominator is named. It is the fleet-database total printed above; the
          // tracker's census only stands in while the database is unavailable.
          <p className="text-[10px] text-muted-foreground">{starlinkShareCaption(starlinkShare)}</p>
        ) : null}

        {chips.length > 0 ? (
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {/* A linked chip is 44 px tall on touch; the text chips beside it stretch to the row
                and keep their words centred. */}
            {chips.map((chip) =>
              chip.href ? (
                <li key={chip.label} className="flex">
                  <DashLink
                    href={chip.href}
                    hit="inline"
                    className={`flex-col justify-center rounded-md border px-2 py-1 ${CHIP_TONES[chip.tone]}`}
                  >
                    <ChipContent chip={chip} />{' '}
                    <span className="sr-only">(Starlink tab)</span>
                  </DashLink>
                </li>
              ) : (
                <li
                  key={chip.label}
                  className={`flex flex-col items-center justify-center rounded-md border px-2 py-1 ${CHIP_TONES[chip.tone]}`}
                >
                  <ChipContent chip={chip} />
                </li>
              ),
            )}
          </ul>
        ) : loading ? (
          <Skeleton className="mt-2 h-10 w-full" />
        ) : null}
      </div>
    </div>
  );
}

export default FleetHealth;
