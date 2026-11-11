/**
 * On-time performance across the nine tracked airports.
 *
 * Two signals are blended into one chip per hub (inventory §3): the on-time percentage, and
 * whether the FAA currently has a program running there. The FAA marker WINS — a hub can be
 * at 85% on-time and under a ground stop at the same time, and the ground stop is the thing
 * a traveller needs to see. Severity is never colour-only: each chip carries a glyph.
 *
 * The hub code links to its hub guide, which is also why this strip is worth crawling.
 */

import { History, House } from 'lucide-react';

import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  HUB_ORDER,
  hubHealthSeverity,
  hubOtpDescription,
  hubReadingAge,
  networkLabel,
} from '@/lib/hub-health.js';
import { networkUnknownText } from '@/lib/faa-freshness.js';
import { networkChipRepeatsBrief } from '@/lib/network-chip.js';
import { hubProgramMarker } from '@/lib/ops-health.js';
import { cn } from '@/lib/utils';
import { useBrief } from '../state/brief';
import { useIrops } from '../state/irops';
import { usePrefs } from '../state/prefs';
import { useHubHealth } from '../state/schedule';
import { useWeather } from '../state/weather';
import { SEV_TEXT, SeverityGlyph } from './Status';
import type { Severity } from './Status';

export function HubHealthStrip() {
  const { hubs } = useHubHealth();
  const { faaIndex, faaUnknownSince } = useWeather();
  const { homeAirport } = usePrefs();
  const irops = useIrops();

  const readings = hubs.map((entry) => entry.otp).filter((otp): otp is number => otp !== null);
  // The network chip follows the same networkStatus() rule as the ticker and the IROPS
  // badge, so it cannot read "Smooth Ops" beside a ground stop (F5/F33/F68).
  const network = networkLabel(readings, {
    iropsScore: irops.score,
    faaIndex,
    hubCodes: HUB_ORDER,
  }) as { avg: number; label: string; severity: Severity; level: string } | null;
  // A stale FAA answer empties faaIndex, which reads exactly like a calm day. When nothing else
  // says the network is disrupted, the chip says the FAA picture is unknown instead of "Smooth
  // Ops". The time is held from the moment it went stale, so this polite region changes its words
  // only when the state does.
  const unknown = networkUnknownText(network, faaUnknownSince ?? null) as string | null;
  // While a current brief holds the row above and agrees with this chip, the chip only repeats it
  // (src/lib/network-chip.js). It returns the moment the two disagree or the brief goes.
  const { view: brief } = useBrief();
  const repeatsBrief = networkChipRepeatsBrief({
    briefTone: brief.status === 'ready' ? brief.tone : null,
    networkLevel: network?.level ?? null,
    unknown: Boolean(unknown),
  });
  const loading = readings.length === 0 && irops.loading;
  const nowMs = Date.now();

  return (
    <div
      aria-live="polite"
      aria-label="Hub on-time performance"
      // 28 px at every width and pointer, the brief row's height (Nov 2026: the 44 px touch
      // chips made this row 45 px on a phone). On a touch screen the chips fill the row.
      className="flex h-7 shrink-0 items-center gap-1.5 overflow-x-auto border-b bg-card/40 px-3 text-xs [scrollbar-width:none] md:px-4"
    >
      <span className="mr-1 hidden shrink-0 text-[11px] uppercase tracking-wide text-muted-foreground sm:inline">
        Hub on-time
      </span>

      {loading
        ? Array.from({ length: 9 }).map((_, i) => (
            <Skeleton key={i} className="h-6 w-16 shrink-0" />
          ))
        : hubs.map((entry) => {
            const program = hubProgramMarker(faaIndex, entry.hub) as {
              severity: Severity;
              marker: string;
              label: string;
            } | null;
            // Worse-of: an FAA program can only raise severity, never lower it.
            const otpSeverity = (
              entry.otp === null ? null : hubHealthSeverity(entry.otp)
            ) as Severity | null;
            const severity: Severity | null =
              program && (program.severity === 'red' || otpSeverity !== 'red')
                ? program.severity
                : otpSeverity;
            const isHome = homeAirport === entry.hub;
            const age = hubReadingAge(entry.asOfMs, nowMs) as {
              label: string;
              stale: boolean;
            } | null;
            const stale = entry.otp !== null && Boolean(age?.stale);

            return (
              <Tooltip key={entry.hub}>
                <TooltipTrigger asChild>
                  <a
                    href={`/hubs/${entry.hub.toLowerCase()}`}
                    className={cn(
                      // 24 px for a mouse (WCAG 2.5.8). A finger gets the whole row's height
                      // (27 px inside its border) and a wider pad: the 44 px chips of Oct 3 2026
                      // made this a 45 px row on a phone, and the row is 28 px now, like the
                      // brief row above it (Nov 2026). The row scrolls sideways, which clips any
                      // hit box that pokes outside it, so the chip itself is the target. Keyed
                      // to the POINTER, not the width: an iPad at desktop width is a touch screen.
                      // `relative`: the stale chip's sr-only words are absolutely positioned, and
                      // without a positioned chip they escape the sideways scroller and widen the
                      // whole page (a 390 px phone laid out at 585 px).
                      'relative flex min-h-6 shrink-0 items-center gap-1 rounded-md px-1.5 no-underline hover:bg-accent pointer-coarse:self-stretch pointer-coarse:px-2',
                      isHome && 'border border-primary/40',
                    )}
                  >
                    {isHome ? <House aria-hidden="true" className="size-3" /> : null}
                    {/* An hours-old board still shows its number (F91). It used to recede as a
                        whole chip at 60% opacity, which took the percentage to 3.8:1; now only the
                        glyph recedes, the number keeps full contrast, and a History mark (the
                        "FAA status unknown" icon) plus static sr-only words say "stale" without
                        relying on the dimming. */}
                    <SeverityGlyph severity={severity} program={program?.marker} className={stale ? 'opacity-60' : undefined} />
                    <span className="font-medium">{entry.hub}</span>
                    <span
                      className={cn(
                        'font-mono tabular-nums',
                        severity ? SEV_TEXT[severity] : 'text-muted-foreground',
                      )}
                    >
                      {entry.otp === null ? '—' : `${entry.otp}%`}
                    </span>
                    {stale ? (
                      <>
                        <History aria-hidden="true" data-stale-reading="" className="size-3 shrink-0 text-muted-foreground" />
                        {' '}
                        <span className="sr-only">(stale reading)</span>
                      </>
                    ) : null}
                  </a>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <p className="font-medium">United at {entry.hub} — hub guide</p>
                  <p className="text-xs">
                    {hubOtpDescription(entry.otp)}
                    {entry.source === 'client' ? ' (from the loaded board)' : ''}
                  </p>
                  {entry.otp !== null && age ? (
                    <p className="text-xs">
                      {age.label}
                      {age.stale ? ' — stale' : ''}
                    </p>
                  ) : null}
                  {program ? <p className="text-xs">{program.label}</p> : null}
                </TooltipContent>
              </Tooltip>
            );
          })}

      {network && unknown ? (
        <span className="ml-auto flex shrink-0 items-center gap-1 pl-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          <History aria-hidden="true" className="size-3 shrink-0" />
          <span>{unknown}</span>
        </span>
      ) : network && !repeatsBrief ? (
        <span className="ml-auto shrink-0 pl-3 text-[11px] font-semibold uppercase tracking-wide">
          <SeverityGlyph severity={network.severity} />{' '}
          <span className={SEV_TEXT[network.severity]}>{network.label}</span>
        </span>
      ) : null}
    </div>
  );
}
