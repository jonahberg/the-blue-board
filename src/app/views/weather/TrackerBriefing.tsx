/**
 * Infrastructure watch — the one card on this tab that is not about today.
 *
 * Today's delays are weather and volume; next year's are the tower still running paper
 * flight strips and the terminal that has been under construction since 2023. With a home
 * hub set this narrows to two facts about that airport and deep-links into the trackers;
 * without one it states what the corpus covers and asks for a hub.
 *
 * The copy and the link targets are `buildTrackerBriefing()` in `src/lib/tracker-briefing.js`.
 * `bb_tracker_watches` is READ here and written by the tracker pages (inventory §29) — the
 * key and its `[{slug,id}]` shape are a compatibility contract with the shipped site.
 */

import { useMemo } from 'react';

import { atcAirports, atcMeta, unitedHubsMeta, unitedProjects } from '@/data/trackers/index.js';
import { buildTrackerBriefing, parseTrackerWatches } from '@/lib/tracker-briefing.js';
import { usePrefs } from '../../state/prefs';
import { readString, STORAGE_KEYS } from '../../state/storage';

type Briefing = {
  title: string;
  summary: string;
  hubLink: { href: string; text: string };
  atcLink: { href: string; text: string };
  watchText: string;
  home: boolean;
};

export function TrackerBriefing() {
  const { homeAirport } = usePrefs();

  const briefing = useMemo(
    () =>
      buildTrackerBriefing({
        home: homeAirport,
        atcAirports,
        atcMeta,
        unitedHubsMeta,
        unitedProjects,
        watches: parseTrackerWatches(readString(STORAGE_KEYS.trackerWatches)),
      }) as Briefing,
    [homeAirport],
  );

  return (
    <aside
      id="tracker-briefing"
      aria-labelledby="tracker-briefing-title"
      className="rounded-lg border bg-card/40 p-3"
    >
      <p className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
        Infrastructure watch
      </p>
      <h3 id="tracker-briefing-title" className="mt-0.5 text-sm font-semibold">
        {briefing.title}
      </h3>
      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{briefing.summary}</p>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
        <a href={briefing.hubLink.href} className="text-primary underline">
          {briefing.hubLink.text}
        </a>
        <a href={briefing.atcLink.href} className="text-primary underline">
          {briefing.atcLink.text}
        </a>
        <span
          id="tracker-briefing-watch"
          aria-live="polite"
          className="ml-auto font-mono text-[10px] text-muted-foreground"
        >
          {briefing.watchText}
        </span>
      </div>
    </aside>
  );
}

export default TrackerBriefing;
