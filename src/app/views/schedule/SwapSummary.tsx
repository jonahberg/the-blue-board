/**
 * "3 equipment swaps detected · 1 downgrade · 2 upgrades" (inventory §20).
 *
 * A swap is the one thing on this board that can change a passenger's actual day — a Polaris
 * seat becoming an Economy Plus one, Starlink becoming no wifi — so it gets a banner above
 * the table rather than only a badge buried in a row. Clicking it opens the filter drawer,
 * which is where a viewer can narrow to the affected aircraft.
 *
 * The count is a real button, not a decorated div: it does something, so it has to be
 * reachable by keyboard and announced as actionable.
 */

import { swapSummary } from '@/lib/schedule-load.js';
import { cn } from '@/lib/utils';
import type { EquipmentSwap } from '../../state/schedule';

export function SwapSummary({
  swaps,
  impactsFor,
  onOpenFilters,
}: {
  swaps: EquipmentSwap[];
  impactsFor: (swap: EquipmentSwap) => { cls: string }[];
  onOpenFilters: () => void;
}) {
  const summary = swapSummary(swaps, impactsFor) as {
    total: number;
    upgrades: number;
    downgrades: number;
    text: string;
  } | null;
  if (!summary) return null;

  return (
    <button
      type="button"
      onClick={onOpenFilters}
      className={cn(
        'flex min-h-11 w-full items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10',
        'px-2.5 py-1.5 text-left text-[11px] text-amber-400 md:min-h-0',
      )}
    >
      <span aria-hidden="true">⚠️</span>
      <span>{summary.text}</span>
      {summary.downgrades > 0 ? (
        <span className="text-red-400">
          · {summary.downgrades} downgrade{summary.downgrades > 1 ? 's' : ''}
        </span>
      ) : null}
      {summary.upgrades > 0 ? (
        <span className="text-emerald-400">
          · {summary.upgrades} upgrade{summary.upgrades > 1 ? 's' : ''}
        </span>
      ) : null}
      <span className="ml-auto text-muted-foreground">Filters →</span>
    </button>
  );
}
