/**
 * The full brief: "Right now" + when it was written, the headline, the items with their chips,
 * the traveler note (a hub ground stop or delay program, or a disrupted day), and a footer that says
 * how it was written.
 *
 * One body, two homes: the top of the Live sidebar at `lg`+ (`BriefSidebarPanel`, below) and the
 * brief sheet everywhere else (`BriefSheet.tsx`). Everything it decides comes from
 * `src/lib/brief-view.js` and `src/lib/brief-chips.js`; this file only renders.
 *
 * Text is rendered as React text children, never as HTML: the brief's words are model-written
 * and a radio quote is third-party (docs/specs/ops-brief.md). Neither this panel nor the header
 * row is a live region — `IropsAnnouncer` is the page's one disruption announcer (DESIGN.md).
 */

import { ChevronRight, RadioTower } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent, ReactNode } from 'react';

import { itemChips } from '@/lib/brief-chips.js';
import {
  BRIEF_HOW_STEPS,
  BRIEF_RADIO_CAVEAT,
  briefFreshnessLine,
  briefSourceLine,
  formatBriefClock,
} from '@/lib/brief-view.js';
import { cn } from '@/lib/utils';
import type { BriefFact } from '../data/api';
import { useBrief } from '../state/brief';
import type { BriefReady, BriefViewItem } from '../state/brief';
import { resolveDeepLink } from '../state/deep-links';
import type { DeepLinkIntent } from '../state/deep-links';
import { useSchedule } from '../state/schedule';
import { useUi } from '../state/ui';
import { ToneMark } from './BriefTone';

type Chip = {
  id: string;
  label: string;
  tone: 'radio' | 'alert' | 'warn' | 'plain';
  target: { href: string; tab: string } | null;
  title: string;
};

/** Follow a chip in place: close the sheet, pick the board, switch tab, scroll. */
function useFollow() {
  const { setTab } = useUi();
  const { setCurrent } = useSchedule();
  const { setSheetOpen } = useBrief();
  return (intent: DeepLinkIntent) => {
    setSheetOpen(false);
    if (intent.scheduleHub) setCurrent({ hub: intent.scheduleHub });
    setTab(intent.tab, intent.scrollTo ? { scrollTo: intent.scrollTo } : undefined);
  };
}

const CHIP_BASE = 'inline-flex items-center gap-1 font-mono text-[11px] leading-none tabular-nums';
/**
 * The box every chip shares, link or not: 28 px on touch (the hub strip's chip links clear 24 px;
 * WCAG 2.5.8), dense with a mouse. A plain-text tag keeps the box with a dashed outline and no
 * fill (the design system's "not an action" mark, as the Cover a day calendar's open days), so two
 * of them side by side no longer run together as one line of words (Nov 2026).
 */
const CHIP_BOX = 'min-h-7 rounded-md border px-1.5 pointer-fine:md:min-h-5';

function BriefChip({ chip, currentTab, onFollow }: { chip: Chip; currentTab: string; onFollow: (i: DeepLinkIntent) => void }) {
  const intent = chip.target ? resolveDeepLink(chip.target.href) : null;
  // A link to the tab already showing, with nothing to scroll to or select, would do nothing:
  // that is a dead button, so it renders as text instead.
  const live = intent && !(intent.tab === currentTab && !intent.scrollTo && !intent.scheduleHub);

  if (!live || !chip.target || !intent) {
    return (
      <span
        title={chip.title}
        data-chip="text"
        className={cn(
          CHIP_BASE,
          CHIP_BOX,
          'border-dashed',
          chip.tone === 'radio' ? 'border-bb-info/40 text-bb-info'
            : chip.tone === 'alert' ? 'border-destructive/40 text-destructive'
            : chip.tone === 'warn' ? 'border-bb-warn/40 text-bb-warn'
            : 'border-border text-muted-foreground',
        )}
      >
        {chip.tone === 'radio' ? <RadioTower aria-hidden="true" className="size-3" /> : null}
        {chip.label}
      </span>
    );
  }

  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    // Let the browser open a new tab / window: the href is a real deep link.
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onFollow(intent);
  };

  return (
    <a
      href={chip.target.href}
      title={chip.title}
      onClick={onClick}
      data-chip="link"
      className={cn(
        CHIP_BASE,
        CHIP_BOX,
        'bg-card no-underline transition-colors duration-100',
        'hover:border-primary hover:text-foreground',
        chip.tone === 'alert' ? 'border-destructive/40 text-destructive'
          : chip.tone === 'warn' ? 'border-bb-warn/40 text-bb-warn'
          : 'text-muted-foreground',
      )}
    >
      {chip.label}
    </a>
  );
}

function Chips({ ids, factsById, currentTab, onFollow }: {
  ids: string[];
  factsById: Map<string, BriefFact>;
  currentTab: string;
  onFollow: (i: DeepLinkIntent) => void;
}) {
  const chips = useMemo(() => itemChips(ids, factsById) as Chip[], [ids, factsById]);
  if (!chips.length) return null;
  return (
    <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
      <span className="sr-only">Sources: </span>
      {chips.map((chip) => (
        <BriefChip key={chip.id} chip={chip} currentTab={currentTab} onFollow={onFollow} />
      ))}
    </span>
  );
}

export type BriefBodyProps = {
  view: BriefReady;
  variant: 'sidebar' | 'sheet';
  /** The headline element: an `<h2>` in the sidebar, the sheet's `SheetTitle` in the sheet. */
  renderHeadline: (text: string, className: string) => ReactNode;
};

export function BriefBody({ view, variant, renderHeadline }: BriefBodyProps) {
  const { tab } = useUi();
  const follow = useFollow();
  const sheet = variant === 'sheet';
  const written = formatBriefClock(view.generatedAtMs);
  const freshness = briefFreshnessLine(view);

  const item = (entry: BriefViewItem, key: string) => (
    <li key={key} className="space-y-1.5">
      <p className={cn('leading-snug text-foreground', sheet ? 'text-base' : 'text-sm')}>{entry.text}</p>
      <Chips ids={entry.factIds} factsById={view.factsById} currentTab={tab} onFollow={follow} />
    </li>
  );

  return (
    <div className="space-y-3">
      <p
        className={cn(
          'flex items-baseline gap-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground',
          sheet && 'pr-10',
        )}
      >
        <span>Right now</span>
        <ToneMark tone={view.tone} />
        <span className="ml-auto shrink-0">
          <span className="sr-only">Written at </span>
          <time dateTime={new Date(view.generatedAtMs).toISOString()}>{written}</time>
        </span>
      </p>

      {renderHeadline(
        view.headline,
        cn('font-semibold leading-snug tracking-tight text-balance text-foreground', sheet ? 'text-lg' : 'text-base'),
      )}

      <ul className={cn(sheet ? 'space-y-4' : 'space-y-3')}>
        {view.items.map((entry, i) => item(entry, `item-${i}`))}
      </ul>

      {view.travelerNote ? (
        <div className="space-y-1.5 rounded-md border bg-card p-2.5">
          <p className={cn('font-medium leading-snug text-foreground', sheet ? 'text-base' : 'text-sm')}>
            {view.travelerNote.text}
          </p>
          <Chips ids={view.travelerNote.factIds} factsById={view.factsById} currentTab={tab} onFollow={follow} />
        </div>
      ) : null}

      <div className={cn('space-y-1 border-t pt-2.5 text-muted-foreground', sheet ? 'text-xs' : 'text-[11px]')}>
        <p>{briefSourceLine(view.source, view.factCount)}</p>
        {freshness ? <p>{freshness}</p> : null}
        {view.hasRadio ? (
          <p className="flex gap-1">
            <RadioTower aria-hidden="true" className="mt-px size-3 shrink-0 text-bb-info" />
            <span>{BRIEF_RADIO_CAVEAT}</span>
          </p>
        ) : null}
        <details className="group">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1 text-foreground/80 hover:text-foreground pointer-fine:md:min-h-6 [&::-webkit-details-marker]:hidden">
            <ChevronRight
              aria-hidden="true"
              className="size-3 transition-transform duration-100 group-open:rotate-90 motion-reduce:transition-none"
            />
            How this was written
          </summary>
          <ol className="mt-1 list-decimal space-y-1 pl-5">
            {BRIEF_HOW_STEPS.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </details>
      </div>
    </div>
  );
}

/** How long the panel stays highlighted after the header row points at it. */
const REVEAL_RING_MS = 1500;

/**
 * The brief open at the top of the Live sidebar (≥ `lg`), inside the sidebar's scroll region so
 * hub traffic and phase stay reachable however long a bad day's brief runs. Renders nothing
 * when there is no current brief — a stale one is never shown here (src/lib/brief-view.js).
 */
export function BriefSidebarPanel() {
  const { view, revealKey } = useBrief();
  const ref = useRef<HTMLElement>(null);
  const [ringed, setRinged] = useState(false);

  // The header row's click on Live at `lg`+: the panel is already open, so it scrolls into view,
  // takes focus and flashes briefly instead of opening a second copy in a sheet.
  useEffect(() => {
    if (!revealKey) return undefined;
    const el = ref.current;
    if (!el) return undefined;
    el.scrollIntoView({ block: 'start' });
    el.focus({ preventScroll: true });
    setRinged(true);
    const timer = window.setTimeout(() => setRinged(false), REVEAL_RING_MS);
    return () => window.clearTimeout(timer);
  }, [revealKey]);

  if (view.status !== 'ready') return null;
  return (
    <section
      ref={ref}
      id="brief-panel"
      tabIndex={-1}
      aria-labelledby="brief-panel-headline"
      // The sidebar's scroll viewport clips anything drawn outside the panel, so focus is an INSET
      // ring and the reveal is a background flash rather than an offset ring.
      className={cn(
        'scroll-mt-2 border-b pb-3 transition-colors duration-300 outline-none focus-visible:rounded-md focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring motion-reduce:transition-none',
        ringed && 'bg-accent/60',
      )}
    >
      <BriefBody
        view={view}
        variant="sidebar"
        renderHeadline={(text, className) => (
          <h2 id="brief-panel-headline" className={className}>
            {text}
          </h2>
        )}
      />
    </section>
  );
}

export default BriefSidebarPanel;
