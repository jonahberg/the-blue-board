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
 */

import { Badge } from '@/components/ui/badge';
import { nasCountLine, nasPanelEmpty, sevBadgeClass, tierNasEventsRaw } from '@/lib/nas-severity.js';
import { WX_HUBS } from '@/lib/weather-cards.js';
import { cn } from '@/lib/utils';
import type { NasData } from '../../data/types';

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
  'sev-gs': 'border-red-500/40 bg-red-500/15 text-red-400',
  'sev-gdp': 'border-amber-500/40 bg-amber-500/15 text-amber-400',
  'sev-afp': 'border-amber-500/40 bg-amber-500/15 text-amber-400',
  'sev-mit': 'border-sky-500/40 bg-sky-500/15 text-sky-400',
  'sev-cdr': 'border-border bg-muted text-muted-foreground',
  'sev-other': 'border-border bg-muted text-muted-foreground',
};

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
              className={cn(
                'mt-0.5 h-fit shrink-0 px-1.5 py-0 font-mono text-[9px]',
                BADGE_TONE[sevBadgeClass(item.sevType) as string] ?? BADGE_TONE['sev-other'],
              )}
            >
              {item.sevType}
            </Badge>
            <div className="min-w-0">
              <p className="text-[11px]">
                {item.title}
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
                          avg <span className="font-mono text-amber-400">{part.text}</span>
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
  // `NasData` types the two feeds as `unknown[]` because nothing in the app reads a NAS
  // entry's fields directly — every one of them goes through the classifier, which is where
  // the real shape is documented.
  const payload = nas as { active?: object[]; planned?: object[]; advisoryUrl?: string } | null;
  if (nasPanelEmpty(payload)) return null;
  const tiers = tierNasEventsRaw(payload, WX_HUBS) as Tiers;
  const count = nasCountLine(payload, tiers) as string;

  return (
    <section aria-labelledby="nas-status-label" className="rounded-lg border bg-card/40 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3
          id="nas-status-label"
          className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
        >
          NAS Status
        </h3>
        {count ? <span className="font-mono text-[10px] text-muted-foreground">{count}</span> : null}
      </div>
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
