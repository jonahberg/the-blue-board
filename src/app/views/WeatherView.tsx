/**
 * Delays · Weather · Hubs.
 *
 * Two panels on a wide screen: the radar on the left, everything textual on the right in one
 * scroll — network disruption, the infrastructure briefing, NAS programs, then the nine hub
 * stations. That order is a priority order, not a layout accident: the broadest fact (is the
 * network having a day?) comes first and the most specific (what is the ceiling at GUM?)
 * comes last. Below 1024 px the two panels stack, radar first, because on a phone the map is
 * the thing you can read at a glance.
 *
 * The map and the cards are two views of ONE model: `buildHubCardModel()` decides a hub's
 * colour once, and both the card's top border and the radar marker take it. Clicking a
 * marker scrolls to that card and flashes it, which is what makes them feel like one thing
 * rather than a map beside a list.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { assignJargonFirsts, buildHubCardModel, radarTitle, WX_HUBS } from '@/lib/weather-cards.js';
import { useUi } from '../state/ui';
import { useWeather } from '../state/weather';
import type { RadarHub } from '../map/RadarMap';
import { HubCards } from './weather/HubCards';
import type { HubCardModel } from './weather/HubCard';
import { IropsSection } from './weather/IropsSection';
import { NasPanel } from './weather/NasPanel';
import { RadarPanel } from './weather/RadarPanel';
import { TrackerBriefing } from './weather/TrackerBriefing';

/** How long a card stays ringed after its radar marker is clicked. */
const HIGHLIGHT_MS = 1500;

export default function WeatherView() {
  const { metarByHub, faaIndex, nas, updatedAt, loading, metarFailed, refresh } = useWeather();
  const { pendingScroll, clearPendingScroll } = useUi();
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const highlightTimer = useRef<number | undefined>(undefined);
  const panelRef = useRef<HTMLDivElement>(null);

  const models = useMemo(() => {
    if (!Object.keys(metarByHub).length && !Object.keys(faaIndex).length) return [];
    const built = (WX_HUBS as string[]).map((hub) =>
      buildHubCardModel({ hub, metar: metarByHub[hub] ?? null, faa: faaIndex[hub] ?? null }),
    );
    // The jargon gate is a pure fold over the ordered cards, so a re-render can never move
    // a tooltip from the first card that surfaces a term to a later one.
    return assignJargonFirsts(built) as HubCardModel[];
  }, [metarByHub, faaIndex]);

  const radarHubs = useMemo<RadarHub[]>(
    () => models.map((m) => ({ hub: m.hub, color: m.borderColor, label: m.markerLabel })),
    [models],
  );

  const selectHub = useCallback((hub: string) => {
    document
      .getElementById(`hub-card-${hub}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setHighlighted(hub);
    window.clearTimeout(highlightTimer.current);
    highlightTimer.current = window.setTimeout(() => setHighlighted(null), HIGHLIGHT_MS);
  }, []);

  useEffect(() => () => window.clearTimeout(highlightTimer.current), []);

  // `?tab=irops` lands on this tab already scrolled to the disruption bar. Consumed once —
  // leaving it set would yank the panel back on every later render.
  useEffect(() => {
    if (pendingScroll !== 'irops-section') return;
    const target = document.getElementById('irops-section');
    if (target) {
      // The panel has just been mounted by the tab switch; let it lay out before scrolling.
      requestAnimationFrame(() => target.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }
    clearPendingScroll();
  }, [pendingScroll, clearPendingScroll]);

  // "Hub Stations ↓" — a hint that there is more below the fold, which removes itself the
  // moment the cards are actually in view rather than nagging about what you can already see.
  const [hintVisible, setHintVisible] = useState(true);
  const cardsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const cards = cardsRef.current;
    const root = panelRef.current;
    if (!cards || !root) return undefined;
    const observer = new IntersectionObserver(
      ([entry]) => setHintVisible(!entry.isIntersecting),
      { root, threshold: 0.1 },
    );
    observer.observe(cards);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="grid h-full min-h-0 grid-cols-1 gap-3 p-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:p-4">
      <div className="min-h-[320px] lg:min-h-0">
        <RadarPanel title={radarTitle(updatedAt) as string} hubs={radarHubs} onSelectHub={selectHub} />
      </div>

      <div ref={panelRef} className="relative min-h-0 space-y-3 lg:overflow-y-auto lg:pr-1">
        <IropsSection />
        <TrackerBriefing />
        <NasPanel nas={nas} />

        <div
          aria-hidden="true"
          className={`flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground transition-opacity duration-300 ${
            hintVisible ? 'opacity-100' : 'opacity-0'
          }`}
        >
          <span>Hub Stations</span>
          <span>↓</span>
          <span className="h-px flex-1 bg-border" />
        </div>

        <div ref={cardsRef}>
          <HubCards
            models={models}
            loading={loading}
            failed={metarFailed && !loading}
            highlighted={highlighted}
            onRetry={refresh}
          />
        </div>
      </div>
    </div>
  );
}
