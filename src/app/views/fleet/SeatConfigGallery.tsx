/**
 * Zone 2 — the cabin layouts a selected type flies (inventory §21 `showConfigGallery()`).
 *
 * Block widths are proportional to seat count with a 30 px floor, which is the compromise
 * that makes this readable: to scale, an 8-seat Polaris cabin next to 118 economy seats is
 * four pixels wide and cannot carry its own label, and naming the cabins is the whole point.
 * So the bar is honest about ORDER and roughly honest about size, and the number is printed
 * on every block.
 *
 * The empty state offers three types rather than only instructing: "select a type above" with
 * nothing to click is a dead end on a phone, where "above" is several screens away.
 */

import { Skeleton } from '@/components/ui/skeleton';

export type ConfigEntry = {
  config: string;
  count: number;
  total: number | null;
  blocks: { cabin: string; count: number; width: number; color: string }[];
};

/** The three types the shipped empty state offered — one per cabin shape. */
const QUICK_TYPES = ['737-800', 'A321neo', '777-300ER'];

export function SeatConfigGallery({
  type,
  configs,
  loading,
  onSelectType,
}: {
  /** The selected type, or '' for the empty state. */
  type: string;
  configs: ConfigEntry[];
  loading: boolean;
  onSelectType: (type: string) => void;
}) {
  if (!type) {
    return (
      <div className="rounded-lg border border-dashed p-4 text-center">
        <p className="text-xs text-muted-foreground">
          Select an aircraft type above to see cabin layout
        </p>
        <div className="mt-2 flex flex-wrap justify-center gap-1.5">
          {QUICK_TYPES.map((quick) => (
            <button
              key={quick}
              type="button"
              onClick={() => onSelectType(quick)}
              className="min-h-11 rounded-md border px-3 text-xs transition-colors hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring md:min-h-8"
            >
              {quick}
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (loading && !configs.length) return <Skeleton className="h-32 w-full" />;

  return (
    <div className="space-y-3">
      <p className="text-xs font-medium">{type} Configurations</p>
      {configs.map((entry) => (
        <div key={entry.config}>
          <p className="text-[11px]">
            <strong className="font-medium">{entry.config || 'Unknown'}</strong>{' '}
            <span className="text-muted-foreground">
              ({entry.count} aircraft, {entry.total ?? '?'} seats)
            </span>
          </p>
          {entry.blocks.length > 0 ? (
            <div className="mt-1 flex flex-wrap gap-1">
              {entry.blocks.map((block) => (
                <span
                  key={block.cabin}
                  className="flex h-6 items-center justify-center rounded text-[10px] font-medium text-white"
                  style={{ background: block.color, width: `${block.width}px` }}
                >
                  {block.count}
                  {block.cabin}
                </span>
              ))}
            </div>
          ) : (
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              No cabin breakdown published for this configuration.
            </p>
          )}
        </div>
      ))}
      {configs.length === 0 ? (
        <p className="text-xs text-muted-foreground">No configuration data for {type}.</p>
      ) : null}
    </div>
  );
}

export default SeatConfigGallery;
