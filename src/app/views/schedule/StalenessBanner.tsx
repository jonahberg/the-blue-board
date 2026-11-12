/**
 * What the board is, when it is not simply current (inventory §20).
 *
 * The ladder itself lives in `src/lib/schedule-load.js`; this only paints it. Two rules hold
 * the whole component together:
 *
 *  - The sentence names an ABSOLUTE time and a consequence ("Statuses as of 7:12 PM CDT —
 *    showing the latest data we have"), never a bare relative age. A relative age made
 *    viewers do clock maths, and "paused" read as dishonest because nothing was resuming.
 *  - Severity escalates with age and is never colour alone: the icon and the wording carry
 *    it, so a six-hour-old board reads as a problem in a greyscale screenshot too.
 */

import { RotateCw } from 'lucide-react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { BANNER_TONE } from './tone';

export type BoardCondition = {
  kind: 'banner' | 'age-chip' | 'none';
  message: string;
  suffix: string;
  tone: string;
  icon: string;
};

export function StalenessBanner({
  condition,
  onRetry,
}: {
  condition: BoardCondition;
  onRetry: () => void;
}) {
  // Only the banner rung paints here. The quiet "data as of …" rung (`age-chip`) rides on the stat
  // strip's meta line instead (ScheduleView), and `none` paints nothing.
  if (condition.kind !== 'banner') return null;

  return (
    <Alert
      className={cn('flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]', BANNER_TONE[condition.tone])}
    >
      <span aria-hidden="true">{condition.icon}</span>
      <span className="flex-1">
        {condition.message}
        {condition.suffix}
      </span>
      <Button
        variant="link"
        size="sm"
        className="h-auto min-h-11 px-1 py-0 text-[11px] underline pointer-fine:md:min-h-0"
        onClick={onRetry}
      >
        <RotateCw aria-hidden="true" className="size-3" />
        Retry
      </Button>
    </Alert>
  );
}
