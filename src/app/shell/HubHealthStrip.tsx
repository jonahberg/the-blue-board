/**
 * On-time performance across the nine tracked airports.
 *
 * Two signals are blended into one chip per hub (inventory §3): the on-time percentage, and
 * whether the FAA currently has a program running there. The FAA marker WINS — a hub can be
 * at 85% on-time and under a ground stop at the same time, and the ground stop is the thing
 * a traveller needs to see. Severity is never colour-only: each chip carries a glyph.
 *
 * A chip opens that hub's Schedule board in place (`/?tab=schedule&hub=ORD`), where the
 * dashboard lists the flights behind the figure: a hub code on a status goes where that status is
 * shown (owner decision, Nov 12 2026). The hub guide is one link further, in the board's header.
 */

import { History, House } from 'lucide-react';

import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  HUB_ORDER,
  hubChipDestination,
  hubChipNoFigure,
  hubHealthSeverity,
  hubOtpDescription,
  hubReadingAge,
  hubReadingDayOffset,
  networkLabel,
} from '@/lib/hub-health.js';
import { networkUnknownText } from '@/lib/faa-freshness.js';
import { hubLink } from '@/lib/hub-link.js';
import { networkChipRepeatsBrief } from '@/lib/network-chip.js';
import { hubProgramMarker } from '@/lib/ops-health.js';
import { cn } from '@/lib/utils';
import { dashLinkClick } from '../features/DashLink';
import { useBrief } from '../state/brief';
import { useFollowDeepLink } from '../state/follow-link';
import { useIrops } from '../state/irops';
import { usePrefs } from '../state/prefs';
import { useHubHealth } from '../state/schedule';
import { useWeather } from '../state/weather';
import { SEV_TEXT, SeverityGlyph } from './Status';
import type { Severity } from './Status';

export function HubHealthStrip() {
  const follow = useFollowDeepLink();
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
  // Why a hub has no figure, and whether a server reading is yesterday's board, come from the
  // server's own metrics (v1.28.0). Before it answers, and on a payload without the counts, the
  // chip keeps its bare dash (src/lib/hub-health.js hubChipNoFigure).
  const hubMetrics = irops.data?.hubMetrics ?? null;

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
            // A chip with no reading says why (Guam: "n/a", its feed sends no departure times). A
            // tap opens the hub's board, so the reason lives in the link's name (fixed sr-only words,
            // so a poll that only moves a count announces nothing) and in the tooltip (the count).
            const noFigure =
              entry.otp === null
                ? (hubChipNoFigure(hubMetrics, entry.hub) as { label: string; text: string; sr: string } | null)
                : null;
            const dayOffset =
              entry.otp !== null && entry.source === 'server' ? hubReadingDayOffset(hubMetrics?.[entry.hub]) : 0;
            // The strip lists the nine hubs, so every chip has a board. A plain click follows it in
            // place; a modified click, a middle click and "copy link" get the address.
            const href = hubLink(entry.hub, 'dashboard')?.href;
            const destination = hubChipDestination(entry.hub);

            return (
              <Tooltip key={entry.hub}>
                <TooltipTrigger asChild>
                  <a
                    href={href}
                    onClick={href ? dashLinkClick(follow, href) : undefined}
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
                      {entry.otp === null ? (noFigure?.label ?? '—') : `${entry.otp}%`}
                    </span>
                    {noFigure ? (
                      <>
                        {' '}
                        <span className="sr-only">({noFigure.sr})</span>
                      </>
                    ) : null}
                    {dayOffset === -1 ? (
                      <>
                        {' '}
                        <span className="sr-only">{"(yesterday's departures)"}</span>
                      </>
                    ) : null}
                    {stale ? (
                      <>
                        <History aria-hidden="true" data-stale-reading="" className="size-3 shrink-0 text-muted-foreground" />
                        {' '}
                        <span className="sr-only">(stale reading)</span>
                      </>
                    ) : null}
                    {/* Where the tap goes, last, so the name still opens with the hub and its figure. */}
                    {' '}
                    <span className="sr-only" data-chip-destination="">
                      ({destination.sr})
                    </span>
                  </a>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  {/* One block: the content is an inline-flex row, so bare <p>s sat side by side
                      as columns ("United at GUM · schedule board" squeezed beside the reason). */}
                  <div className="space-y-0.5">
                    <p className="font-medium">{destination.tooltip}</p>
                    <p className="text-xs">
                      {noFigure ? noFigure.text : hubOtpDescription(entry.otp, dayOffset)}
                      {entry.source === 'client' ? ' (from the loaded board)' : ''}
                    </p>
                    {entry.otp !== null && age ? (
                      <p className="text-xs">
                        {age.label}
                        {age.stale ? ' — stale' : ''}
                      </p>
                    ) : null}
                    {program ? <p className="text-xs">{program.label}</p> : null}
                  </div>
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
