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

import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { hubHealthSeverity, networkLabel } from '@/lib/hub-health.js';
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
  const network = networkLabel(readings) as { avg: number; label: string } | null;
  const loading = readings.length === 0 && irops.loading;

  return (
    <div
      aria-live="polite"
      aria-label="Hub on-time performance"
      className="flex shrink-0 items-center gap-1 overflow-x-auto border-b bg-card/40 px-3 py-1.5 text-xs [scrollbar-width:none] md:px-4"
    >
      <span className="mr-1 hidden shrink-0 text-[11px] uppercase tracking-wide text-muted-foreground sm:inline">
        Hub on-time
      </span>

      {loading
        ? Array.from({ length: 9 }).map((_, i) => (
            <Skeleton key={i} className="h-5 w-16 shrink-0" />
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

            return (
              <Tooltip key={entry.hub}>
                <TooltipTrigger asChild>
                  <a
                    href={`/hubs/${entry.hub.toLowerCase()}`}
                    className={cn(
                      'flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 no-underline hover:bg-accent',
                      isHome && 'border border-primary/40',
                    )}
                  >
                    {isHome ? (
                      <span aria-hidden="true" className="text-[10px]">
                        🏠
                      </span>
                    ) : null}
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
                    {entry.otp === null
                      ? 'No on-time reading yet'
                      : `${entry.otp}% of operated departures on time`}
                    {entry.source === 'client' ? ' (from the loaded board)' : ''}
                  </p>
                  {program ? <p className="text-xs">{program.label}</p> : null}
                </TooltipContent>
              </Tooltip>
            );
          })}

      {network ? (
        <span className="ml-auto shrink-0 pl-3 text-[11px] font-semibold uppercase tracking-wide">
          <SeverityGlyph severity={hubHealthSeverity(network.avg) as Severity} />{' '}
          <span className={SEV_TEXT[hubHealthSeverity(network.avg) as Severity]}>
            {network.label}
          </span>
        </span>
      ) : null}
    </div>
  );
}
