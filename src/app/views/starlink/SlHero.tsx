/**
 * The rollout hero: one big number, the two fleet-rollout bars, and two chips
 * (inventory §22, `renderSlHero()`).
 *
 * The number is the served equipped count and nothing else. The verification figures
 * ("397 verified · 3 disputed") sit under it as a muted sub-line whose "disputed" half scrolls
 * to the ledger — they are a different denominator from the hero count, and putting them in
 * the headline would invite the reader to subtract one from the other.
 *
 * The rollout bars are hidden whole in the degraded tier: the static fallback roster carries
 * no fleet denominators, so a percentage there would be a guess wearing a ruler.
 *
 * "● N AIRBORNE NOW" is a real button, not a decorated span — it navigates to the Live tab
 * with the Starlink map filter enabled, and only when that filter can actually be enabled.
 */

import { memo } from 'react';

import { Card } from '@/components/ui/card';

export type RolloutBar = { label: string; installed: number; total: number; pct: number };

export const SlHero = memo(function SlHero({
  equipped,
  bars,
  newThisWeek,
  airborneCount,
  canFilterMap,
  verified,
  disputed,
  onJumpToLedger,
  onShowOnMap,
}: {
  equipped: number | null;
  bars: RolloutBar[] | null;
  newThisWeek: number;
  airborneCount: number;
  /** False in the degraded tier — the Live map's Starlink toggle is disabled there. */
  canFilterMap: boolean;
  verified: number | null;
  disputed: number | null;
  onJumpToLedger: () => void;
  onShowOnMap: () => void;
}) {
  return (
    <Card className="gap-0 p-4">
      <p className="text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
        Starlink Rollout
      </p>

      <div className="mt-3 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="shrink-0">
          <p className="font-mono text-5xl leading-none font-bold tabular-nums" id="sl-hero-count">
            {equipped ?? '—'}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">Aircraft Equipped</p>
          {verified != null ? (
            <p className="mt-1 text-[11px] text-muted-foreground" id="sl-hero-verify-sub">
              {verified} verified ·{' '}
              <button
                type="button"
                data-action="sl-jump-verify"
                onClick={onJumpToLedger}
                // Padding, not min-height: this is an inline link inside an 11 px sentence, so
                // the touch target is grown vertically and pulled back out of the flow, which
                // buys the 44 px without moving the line it sits in.
                className="-my-3.5 py-3.5 underline underline-offset-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring md:my-0 md:py-0"
                title="Jump to the verification ledger"
              >
                {disputed ?? 0} disputed
              </button>
            </p>
          ) : null}
        </div>

        {bars ? (
          <div className="w-full max-w-md space-y-2" id="sl-bars">
            {bars.map((bar) => (
              <div key={bar.label} className="flex items-center gap-2">
                <span className="w-16 shrink-0 text-[11px] text-muted-foreground">{bar.label}</span>
                <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className={`h-full rounded-full ${bar.label === 'Express' ? 'bg-emerald-500' : 'bg-primary'}`}
                    style={{ width: `${Math.max(0, Math.min(100, bar.pct))}%` }}
                  />
                </div>
                <span className="w-28 shrink-0 text-right font-mono text-[11px] tabular-nums">
                  {bar.installed} / {bar.total} · {bar.pct}%
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {newThisWeek > 0 || airborneCount > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2" id="sl-hero-chips">
          {newThisWeek > 0 ? (
            <span className="rounded-full border px-2.5 py-1 text-[11px] font-semibold">
              +{newThisWeek} NEW THIS WEEK
            </span>
          ) : null}
          {airborneCount > 0 ? (
            canFilterMap ? (
              <button
                type="button"
                data-action="view-starlink-on-map"
                onClick={onShowOnMap}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring md:min-h-0"
                title="Show these on the live map"
                aria-label={`Show ${airborneCount} airborne Starlink aircraft on the live map`}
              >
                <span aria-hidden="true" className="size-1.5 rounded-full bg-emerald-400" />
                {airborneCount} AIRBORNE NOW
              </button>
            ) : (
              // Degraded tier: the Live map's Starlink toggle is disabled, so a click-through
              // would land on a map with nothing filtered. State the count, offer no journey.
              <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold">
                <span aria-hidden="true" className="size-1.5 rounded-full bg-emerald-400" />
                {airborneCount} AIRBORNE NOW
              </span>
            )
          ) : null}
        </div>
      ) : null}
    </Card>
  );
});

export default SlHero;
