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

import { House } from 'lucide-react';

import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  HUB_ORDER,
  hubHealthSeverity,
  hubOtpDescription,
  hubReadingAge,
  networkLabel,
} from '@/lib/hub-health.js';
import { hubProgramMarker } from '@/lib/ops-health.js';
import { cn } from '@/lib/utils';
import { useIrops } from '../state/irops';
import { usePrefs } from '../state/prefs';
import { useHubHealth } from '../state/schedule';
import { useWeather } from '../state/weather';
import { SEV_TEXT, SeverityGlyph } from './Status';
import type { Severity } from './Status';

export function HubHealthStrip() {
  const { hubs } = useHubHealth();
  const { faaIndex } = useWeather();
  const { homeAirport } = usePrefs();
  const irops = useIrops();

  const readings = hubs.map((entry) => entry.otp).filter((otp): otp is number => otp !== null);
  // The network chip follows the same networkStatus() rule as the ticker and the IROPS
  // badge, so it cannot read "Smooth Ops" beside a ground stop (F5/F33/F68).
  const network = networkLabel(readings, {
    iropsScore: irops.score,
    faaIndex,
    hubCodes: HUB_ORDER,
  }) as { avg: number; label: string; severity: Severity } | null;
  const loading = readings.length === 0 && irops.loading;
  const nowMs = Date.now();

  return (
    <div
      aria-live="polite"
      aria-label="Hub on-time performance"
      // No vertical padding on a touch screen: the 44 px chips already give the row its height.
      className="flex shrink-0 items-center gap-1.5 overflow-x-auto border-b bg-card/40 px-3 py-1 text-xs [scrollbar-width:none] pointer-coarse:py-0 md:px-4"
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
                      // 24 px for a mouse (WCAG 2.5.8) keeps the desktop strip at ~33 px; a
                      // finger gets the full 44 px (audit Oct 3 2026 — the chips are links to
                      // the hub guides, and 24 px was a miss-tap on a phone). Keyed to the
                      // POINTER, not the width: an iPad at desktop width is a touch screen too.
                      'flex min-h-6 shrink-0 items-center gap-1 rounded-md px-1.5 no-underline hover:bg-accent pointer-coarse:min-h-11',
                      isHome && 'border border-primary/40',
                      // An hours-old board still shows its number, but visibly receded (F91).
                      stale && 'opacity-60',
                    )}
                  >
                    {isHome ? <House aria-hidden="true" className="size-3" /> : null}
                    <SeverityGlyph severity={severity} program={program?.marker} />
                    <span className="font-medium">{entry.hub}</span>
                    <span
                      className={cn(
                        'font-mono tabular-nums',
                        severity ? SEV_TEXT[severity] : 'text-muted-foreground',
                      )}
                    >
                      {entry.otp === null ? '—' : `${entry.otp}%`}
                    </span>
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

      {network ? (
        <span className="ml-auto shrink-0 pl-3 text-[11px] font-semibold uppercase tracking-wide">
          <SeverityGlyph severity={network.severity} />{' '}
          <span className={SEV_TEXT[network.severity]}>{network.label}</span>
        </span>
      ) : null}
    </div>
  );
}
