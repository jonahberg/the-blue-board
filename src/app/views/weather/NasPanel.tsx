/**
 * NAS STATUS — the FAA's National Airspace System programs and planned initiatives.
 *
 * A three-tier priority stack (CRITICAL / ACTIVE · LIKELY / MONITORING) rather than a flat
 * list, because a ground stop somewhere in the system and a miles-in-trail restriction are
 * not the same news. Classification, tiering and hub tagging all come from
 * `src/lib/nas-severity.js`; this renders what it decided.
 *
 * The panel hides itself entirely when both feeds are empty — a header over nothing reads
 * as a broken panel, and "no NAS programs" is the normal state on a good day.
 *
 * It is also where an OLD FAA picture is said out loud (Nov 2026, src/lib/faa-freshness.js):
 * once the held FAA or NAS answer is past its age limit the panel shows, with or without NAS
 * items, one plain line — "FAA status as of HH:MMZ: …" — and a stale NAS answer's tiers are not
 * drawn, so nothing here reads as a confirmed live disruption. The stale airport programs are
 * already out of `faaIndex` (state/weather.tsx), so the hub cards and the strip agree.
 */

import { History } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { faaStatusAsOfLine } from '@/lib/faa-freshness.js';
import {
  nasCountLine,
  nasDisplayTitle,
  nasPanelEmpty,
  sevBadgeClass,
  tierNasEventsRaw,
} from '@/lib/nas-severity.js';
import { WX_HUBS } from '@/lib/weather-cards.js';
import { cn } from '@/lib/utils';
import type { NasData } from '../../data/types';
import { useWeatherOptional } from '../../state/weather';

type DetailPart = { kind: 'text' | 'delay'; text: string };
type NasItem = {
  tier: string;
  sevType: string;
  title: string;
  detailParts: DetailPart[];
  hubs: string[];
};
type Tiers = { critical: NasItem[]; active: NasItem[]; monitoring: NasItem[] };

/** The badge classes `sevBadgeClass()` returns, mapped onto the theme's tokens. */
const BADGE_TONE: Record<string, string> = {
  'sev-gs': 'border-destructive/40 bg-destructive/15 text-destructive',
  'sev-gdp': 'border-bb-warn/40 bg-bb-warn/15 text-bb-warn',
  'sev-afp': 'border-bb-warn/40 bg-bb-warn/15 text-bb-warn',
  'sev-mit': 'border-bb-info/40 bg-bb-info/15 text-bb-info',
  'sev-cdr': 'border-border bg-muted text-muted-foreground',
  'sev-other': 'border-border bg-muted text-muted-foreground',
};

/**
 * A monitoring-tier GS/GDP/AFP is an outlook ("… POSSIBLE"), not a program in effect: its
 * badge stays muted so it never reads as a red ground stop.
 */
function badgeTone(item: NasItem): string {
  const cls = sevBadgeClass(item.sevType) as string;
  const alarming = cls === 'sev-gs' || cls === 'sev-gdp' || cls === 'sev-afp';
  if (item.tier === 'monitoring' && alarming) return BADGE_TONE['sev-other'];
  return BADGE_TONE[cls] ?? BADGE_TONE['sev-other'];
}

function Tier({ label, items }: { label: string; items: NasItem[] }) {
  if (!items.length) return null;
  return (
    <section className="mt-3 first:mt-0">
      <div className="flex items-center gap-2">
        <h4 className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </h4>
        <div className="h-px flex-1 bg-border" />
      </div>
      <ul className="mt-1.5 space-y-1.5">
        {items.map((item, i) => (
          <li key={`${item.sevType}-${item.title}-${i}`} className="flex gap-2">
            <Badge
              variant="outline"
              // One width for GS, CDR and OTHER, so every title in a tier starts on the same line.
              className={cn(
                'mt-0.5 h-fit w-11 shrink-0 justify-center px-1 py-0 font-mono text-[9px]',
                badgeTone(item),
              )}
            >
              {item.sevType}
            </Badge>
            <div className="min-w-0">
              <p className="text-[11px]">
                {/* Sentence case for reading; codes and acronyms stay as the FAA sent them. */}
                {nasDisplayTitle(item.title) as string}
                {item.hubs.map((hub) => (
                  <span
                    key={hub}
                    className="ml-1 rounded-sm bg-primary/15 px-1 font-mono text-[9px] text-primary"
                  >
                    {hub}
                  </span>
                ))}
              </p>
              {item.detailParts.length ? (
                <p className="text-[10px] text-muted-foreground">
                  {item.detailParts.map((part, index) => (
                    <span key={index}>
                      {index > 0 ? ' · ' : ''}
                      {part.kind === 'delay' ? (
                        <>
                          avg <span className="font-mono text-bb-warn">{part.text}</span>
                        </>
                      ) : (
                        part.text
                      )}
                    </span>
                  ))}
                </p>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function NasPanel({ nas }: { nas: NasData | null }) {
  // Outside the provider (the panel's own tests) there is no freshness to report.
  const weather = useWeatherOptional();
  const asOfLine = weather
    ? (faaStatusAsOfLine({
        faaAsOf: weather.faaAsOf,
        faaStale: weather.faaStale,
        nasAsOf: weather.nasAsOf,
        nasStale: weather.nasStale,
      }) as string | null)
    : null;
  // `NasData` types the two feeds as `unknown[]` because nothing in the app reads a NAS
  // entry's fields directly — every one of them goes through the classifier, which is where
  // the real shape is documented.
  const payload = nas as { active?: object[]; planned?: object[]; advisoryUrl?: string } | null;
  const showTiers = !nasPanelEmpty(payload) && !weather?.nasStale;
  if (!showTiers && !asOfLine) return null;
  const tiers = (showTiers ? tierNasEventsRaw(payload, WX_HUBS) : { critical: [], active: [], monitoring: [] }) as Tiers;
  const count = showTiers ? (nasCountLine(payload, tiers) as string) : '';

  return (
    <section id="nas-section" aria-labelledby="nas-status-label" className="scroll-mt-4 rounded-lg border bg-card/40 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3
          id="nas-status-label"
          className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
        >
          NAS Status
        </h3>
        {count ? <span className="font-mono text-[10px] text-muted-foreground">{count}</span> : null}
      </div>
      {asOfLine ? (
        <p className="mt-1.5 flex items-start gap-1.5 text-[11px] text-bb-warn">
          <History aria-hidden="true" className="mt-px size-3 shrink-0" />
          <span>{asOfLine}</span>
        </p>
      ) : null}
      <Tier label="Critical" items={tiers.critical} />
      <Tier label="Active / Likely" items={tiers.active} />
      <Tier label="Monitoring" items={tiers.monitoring} />
      {nas?.advisoryUrl ? (
        <a
          href={nas.advisoryUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-block text-[10px] text-primary underline"
        >
          View full ATCSCC advisory →
        </a>
      ) : null}
    </section>
  );
}

export default NasPanel;
