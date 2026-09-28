/**
 * The map's layer toolbar.
 *
 * A `ToggleGroup` rather than six buttons: these are layer toggles that persist, the group
 * gives them one roving tab stop, and `aria-pressed` comes from the primitive. Refresh is a
 * separate Button because it is an action, not a state.
 *
 * The Starlink toggle is genuinely disabled — with an explanation — whenever the roster is
 * empty or degraded. Offering a filter that would silently hide the entire fleet is worse
 * than not offering it.
 */

import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export type LayerKey = 'hubs' | 'longhaul' | 'starlink' | 'wx' | 'pacific';

/**
 * 44 px touch targets (WCAG 2.5.5) up to `md`, then back to the compact desktop toolbar.
 *
 * On every item rather than a `*:` variant on the group: the Starlink toggle is wrapped in a
 * span so its tooltip survives being disabled, which puts it out of reach of a direct-child
 * selector — measured at 28 px on a 400 px viewport while its five siblings were 44.
 */
const TOUCH_TARGET = 'min-h-11 pointer-fine:md:min-h-8';

/** Trailing-edge fade, on only while `data-overflow="right"`. */
const OVERFLOW_FADE =
  'data-[overflow=right]:[mask-image:linear-gradient(to_right,black_calc(100%_-_2.5rem),transparent)]';

/** Is there more of this scroller off its right edge? (1 px of slack for sub-pixel widths.) */
export function hasMoreRight(el: Pick<HTMLElement, 'scrollLeft' | 'clientWidth' | 'scrollWidth'>): boolean {
  return el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
}

/**
 * On a phone the row is a scrollbar-less horizontal scroller (LiveView), and at 390 px Radar,
 * Pacific and Refresh sat entirely past its edge with nothing to say so. While more lies to
 * the right, the row's trailing edge fades out, so the last visible chip reads as cut off
 * rather than as the end of the list.
 */
function useOverflowCue() {
  const ref = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const update = () => setMore(hasMoreRight(el));
    update();
    el.addEventListener('scroll', update, { passive: true });
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null;
    observer?.observe(el);
    return () => {
      el.removeEventListener('scroll', update);
      observer?.disconnect();
    };
  }, []);
  return { ref, more };
}

export function MapControls({
  active,
  onChange,
  starlinkAvailable,
  refreshing,
  onRefresh,
  className,
}: {
  active: LayerKey[];
  onChange: (next: LayerKey[]) => void;
  starlinkAvailable: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  className?: string;
}) {
  const { ref, more } = useOverflowCue();
  return (
    <div
      ref={ref}
      className={cn(className, OVERFLOW_FADE)}
      data-overflow={more ? 'right' : undefined}
    >
      <ToggleGroup
        type="multiple"
        variant="outline"
        size="sm"
        value={active}
        onValueChange={(next) => onChange(next as LayerKey[])}
        aria-label="Map layers"
        className="bg-background"
      >
        <ToggleGroupItem value="hubs" className={`gap-1.5 text-xs ${TOUCH_TARGET}`}>
          <span aria-hidden="true">🏢</span> Hubs
        </ToggleGroupItem>
        <ToggleGroupItem value="longhaul" className={`gap-1.5 text-xs ${TOUCH_TARGET}`}>
          <span aria-hidden="true">🌍</span> Long-haul
        </ToggleGroupItem>
        <Tooltip>
          <TooltipTrigger asChild>
            {/* A disabled trigger swallows pointer events, so the span carries the tooltip. */}
            <span>
              <ToggleGroupItem
                value="starlink"
                className={`gap-1.5 text-xs ${TOUCH_TARGET}`}
                disabled={!starlinkAvailable}
              >
                <span aria-hidden="true">⚡</span> Starlink
              </ToggleGroupItem>
            </span>
          </TooltipTrigger>
          {!starlinkAvailable ? (
            <TooltipContent side="bottom">Starlink data unavailable right now</TooltipContent>
          ) : null}
        </Tooltip>
        <ToggleGroupItem value="wx" className={`gap-1.5 text-xs ${TOUCH_TARGET}`}>
          <span aria-hidden="true">🌧</span> Radar
        </ToggleGroupItem>
        <ToggleGroupItem value="pacific" className={`gap-1.5 text-xs ${TOUCH_TARGET}`}>
          <span aria-hidden="true">🌏</span> Pacific
        </ToggleGroupItem>
      </ToggleGroup>
      <Button
        size="sm"
        variant="outline"
        className="min-h-11 bg-background text-xs md:h-8 pointer-fine:md:min-h-0"
        onClick={onRefresh}
        disabled={refreshing}
      >
        {refreshing ? '⏳ Loading…' : '↻ Refresh'}
      </Button>
    </div>
  );
}
