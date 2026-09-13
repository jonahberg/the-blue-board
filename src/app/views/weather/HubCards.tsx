/**
 * The nine hub cards, plus the two states that are not "here are nine cards".
 *
 * Skeletons are shaped like the cards they replace and there are exactly nine of them, so
 * the first paint already has the layout it will keep — the panel does not jump when the
 * observations land.
 *
 * The total-failure state is deliberately separate from a card that happens to have no
 * observation. One hub going quiet is a data gap the card says so about; all nine going
 * quiet is a broken feed, and the only useful control then is Retry.
 */

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { WX_HUBS } from '@/lib/weather-cards.js';
import { HubCard } from './HubCard';
import type { HubCardModel } from './HubCard';

function CardSkeleton() {
  return (
    <Card className="gap-0 border-t-[3px] border-t-muted p-3">
      <div className="flex items-center gap-2">
        <Skeleton className="h-5 w-10" />
        <Skeleton className="ml-auto h-4 w-10" />
      </div>
      <Skeleton className="mt-1.5 h-3 w-28" />
      <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-7 w-full" />
        ))}
      </div>
      <Skeleton className="mt-3 h-3 w-32" />
    </Card>
  );
}

export function HubCards({
  models,
  loading,
  failed,
  highlighted,
  onRetry,
}: {
  models: HubCardModel[];
  loading: boolean;
  failed: boolean;
  /** The hub whose card a radar marker click just flashed. */
  highlighted: string | null;
  onRetry: () => void;
}) {
  if (failed && !models.length) {
    return (
      <div className="rounded-lg border border-dashed p-6 text-center">
        <p aria-hidden="true" className="text-2xl">
          🌦
        </p>
        <p className="mt-1 text-sm">Weather data unavailable</p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          Could not load METAR observations
        </p>
        <Button variant="outline" size="sm" className="mt-3" onClick={onRetry}>
          ↻ Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {loading && !models.length
        ? (WX_HUBS as string[]).map((hub) => <CardSkeleton key={hub} />)
        : models.map((model) => (
            <HubCard key={model.hub} model={model} highlighted={highlighted === model.hub} />
          ))}
    </div>
  );
}

export default HubCards;
