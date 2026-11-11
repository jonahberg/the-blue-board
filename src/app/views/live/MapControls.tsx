/**
 * The map's layer toolbar.
 *
 * A `ToggleGroup` rather than six buttons: these are layer toggles that persist, the group
 * gives them one roving tab stop, and `aria-pressed` comes from the primitive. Refresh is a
 * separate Button because it is an action, not a state.
 *
 * The region chooser (v1.14.0, replacing the lone Pacific toggle) is a DropdownMenu, not a
 * Select: picking a region is a "fly there" command, and re-picking the region you last chose
 * after panning away has to recentre — a Select only reports a CHANGE of value. The radio
 * check still shows which preset the map was last sent to. It leads the row so that on a
 * phone it is on screen without scrolling the toolbar.
 *
 * The Starlink toggle is genuinely disabled — with an explanation — whenever the roster is
 * empty or degraded. Offering a filter that would silently hide the entire fleet is worse
 * than not offering it.
 */

import { Building2, ChevronDown, CloudRain, Earth, Globe, RefreshCw, Zap } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { MAP_REGIONS, getRegion } from '@/lib/map-regions.js';
import { cn } from '@/lib/utils';
import { TOUCH_CONTROL } from '../../shell/touch-target';

/** Map layers. The old 'pacific' key is gone — it is the Pacific region preset now. */
export type LayerKey = 'hubs' | 'longhaul' | 'starlink' | 'wx';

type Region = (typeof MAP_REGIONS)[number];

/**
 * The map's floating controls (this toolbar, the Filters button, the Key and the airborne chip):
 * a 36 px opaque surface with a 44 px hit box on touch (`TOUCH_CONTROL`), the compact desktop
 * size for a mouse at `md`+. Opaque, because planes and the basemap run underneath.
 *
 * On every item rather than a `*:` variant on the group: the Starlink toggle is wrapped in a
 * span so its tooltip survives being disabled, which puts it out of reach of a direct-child
 * selector — measured at 28 px on a 400 px viewport while its five siblings were 44.
 */
export const MAP_CONTROL = cn(TOUCH_CONTROL, 'border border-input bg-background text-xs');

/** The same, on an outline `Button`, whose own dark fill is a see-through 30% wash. */
export const MAP_BUTTON = cn(MAP_CONTROL, 'dark:bg-background');

/**
 * Below `sm` the layer toggles and Refresh are icons with their names kept for assistive tech
 * (`max-sm:sr-only`, not `hidden`, which would drop the name too): with the words, the row was
 * 533 px wide on a 390 px map and the Starlink toggle sat half under the Filters button.
 */
const LABEL = 'max-sm:sr-only';

/** A layer toggle: muted at rest, foreground on a raised surface while on. */
const TOGGLE = cn(
  MAP_CONTROL,
  'gap-1.5 px-2 text-muted-foreground hover:bg-muted data-[state=on]:bg-muted data-[state=on]:text-foreground max-sm:w-9 max-sm:px-0 max-sm:data-[state=on]:border-primary/60 max-sm:data-[state=on]:text-primary',
);

/** Trailing-edge fade, on only while `data-overflow="right"`. */
const OVERFLOW_FADE =
  'data-[overflow=right]:[mask-image:linear-gradient(to_right,black_calc(100%_-_2.5rem),transparent)]';

/** Is there more of this scroller off its right edge? (1 px of slack for sub-pixel widths.) */
export function hasMoreRight(el: Pick<HTMLElement, 'scrollLeft' | 'clientWidth' | 'scrollWidth'>): boolean {
  return el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
}

/**
 * "Fly the map to…" — every region preset, with the last one picked checked.
 *
 * Radix opens a menu on pointerdown for every pointer type, so on a touch screen a swipe that
 * merely STARTED on this button (the toolbar scrolls sideways on a phone) would open it. Touch
 * and pen open on click instead, which a scroll never produces — the split Radix's own Select
 * makes. The touch pointerdown's open request is swallowed in `onOpenChange` rather than by
 * cancelling the event, so nothing depends on how a browser treats a cancelled pointerdown.
 * A mouse keeps press-to-open, and the keyboard is untouched.
 */
export function RegionMenu({
  region,
  onRegion,
}: {
  region: string;
  onRegion: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const pointerType = useRef('mouse');
  /** A touch/pen pointerdown is in progress: Radix's synchronous open request is ignored. */
  const touchPress = useRef(false);
  const current = getRegion(region) as Region;
  return (
    <DropdownMenu
      open={open}
      onOpenChange={(next) => {
        if (next && touchPress.current) {
          touchPress.current = false;
          return;
        }
        setOpen(next);
      }}
    >
      <DropdownMenuTrigger
        asChild
        onPointerDown={(event) => {
          pointerType.current = event.pointerType;
          touchPress.current = event.pointerType !== 'mouse';
          // Radix's handler runs synchronously after this one; never let the flag outlive it.
          queueMicrotask(() => {
            touchPress.current = false;
          });
        }}
        onClick={() => {
          if (pointerType.current !== 'mouse') setOpen(true);
        }}
      >
        <Button
          variant="outline"
          className={cn(MAP_BUTTON, 'shrink-0 gap-1.5 px-2.5 max-sm:gap-0.5 max-sm:px-1.5')}
        >
          <Earth aria-hidden="true" />
          <span className="sr-only">Map region: </span>
          {/* Below `sm` a globe and a chevron, like the icon toggles beside it: a 375 px map has
              room for "US" but not for "Caribbean" (124 px) or "Mexico & C. America" (162 px),
              which pushed Refresh under the row's fade. The name stays for assistive tech, and
              the menu checks it. */}
          <span className={LABEL}>{current.short}</span>
          <ChevronDown aria-hidden="true" className="text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        <DropdownMenuLabel className="text-xs text-muted-foreground">Fly the map to</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={current.id}>
          {(MAP_REGIONS as readonly Region[]).map((option) => (
            <DropdownMenuRadioItem
              key={option.id}
              value={option.id}
              // onSelect fires on every pick, including the region already checked.
              onSelect={() => onRegion(option.id)}
              className="min-h-11 text-xs pointer-fine:md:min-h-8"
            >
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
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
  region,
  onRegion,
  starlinkAvailable,
  refreshing,
  onRefresh,
  className,
}: {
  active: LayerKey[];
  onChange: (next: LayerKey[]) => void;
  /** The region preset last picked (the menu's check mark). */
  region: string;
  onRegion: (id: string) => void;
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
      <RegionMenu region={region} onRegion={onRegion} />
      <ToggleGroup
        type="multiple"
        value={active}
        onValueChange={(next) => onChange(next as LayerKey[])}
        aria-label="Map layers"
        className="shrink-0"
      >
        <ToggleGroupItem value="hubs" className={TOGGLE}>
          <Building2 aria-hidden="true" /> <span className={LABEL}>Hubs</span>
        </ToggleGroupItem>
        <ToggleGroupItem value="longhaul" className={TOGGLE}>
          <Globe aria-hidden="true" /> <span className={LABEL}>Long-haul</span>
        </ToggleGroupItem>
        <Tooltip>
          <TooltipTrigger asChild>
            {/* A disabled trigger swallows pointer events, so the span carries the tooltip. */}
            <span className="flex">
              <ToggleGroupItem value="starlink" className={TOGGLE} disabled={!starlinkAvailable}>
                <Zap aria-hidden="true" /> <span className={LABEL}>Starlink</span>
              </ToggleGroupItem>
            </span>
          </TooltipTrigger>
          {!starlinkAvailable ? (
            <TooltipContent side="bottom">Starlink data unavailable right now</TooltipContent>
          ) : null}
        </Tooltip>
        <ToggleGroupItem value="wx" className={TOGGLE}>
          <CloudRain aria-hidden="true" /> <span className={LABEL}>Radar</span>
        </ToggleGroupItem>
      </ToggleGroup>
      <Button
        variant="outline"
        className={cn(MAP_BUTTON, 'shrink-0 gap-1.5 px-2 text-muted-foreground max-sm:w-9 max-sm:px-0')}
        onClick={onRefresh}
        disabled={refreshing}
        aria-busy={refreshing || undefined}
      >
        {/* A lucide icon, not the ↻ / ⏳ glyphs (DESIGN.md: chrome icons are lucide). */}
        <RefreshCw
          aria-hidden="true"
          className={cn(refreshing && 'animate-spin motion-reduce:animate-none')}
        />
        <span className={LABEL}>{refreshing ? 'Loading…' : 'Refresh'}</span>
      </Button>
    </div>
  );
}
