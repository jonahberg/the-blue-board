/**
 * The IROPS bar — how disrupted the network is right now, in one line.
 *
 * Two paths, and which one is showing is never ambiguous (inventory §24, F002):
 *
 *  - SERVER (`/api/irops`): all nine hubs, one direction, one day, held-flight aware. This
 *    is the authoritative writer. Once it has answered, the client recompute may not touch
 *    the bar, the announcer or the ticker's score.
 *  - CLIENT FALLBACK: today's DEPARTURES boards this session happens to have loaded,
 *    labelled `est · loaded boards` so it can never masquerade as the network-wide figure.
 *
 * The headline is a severity WORD, not the 0–100 index: the number was not helpful to
 * anyone but the model that produces it. The index still exists — the ticker gates on it —
 * and the `?` tooltip states the exact weights, so the word is auditable rather than opaque.
 *
 * The level-change announcement is deliberately NOT here: `shell/IropsAnnouncer` owns it,
 * because it is mounted on every tab and this section is not (§17, §30).
 */

import { useEffect, useMemo } from 'react';

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { classifySchedStatus } from '@/lib/schedule-status.js';
import { countIropsFromBoards } from '@/lib/irops-client.js';
import { iropsScore, iropsScoreCls, iropsScoreLabel } from '@/lib/irops-score.js';
import { faaAlertLines } from '@/lib/weather-cards.js';
import { cn } from '@/lib/utils';
import { JargonTerm } from '../../features/JargonTerm';
import { useIrops } from '../../state/irops';
import { useSchedule } from '../../state/schedule';
import { useWeather } from '../../state/weather';

const SCORE_TONE: Record<string, string> = {
  low: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-400',
  med: 'border-amber-500/40 bg-amber-500/15 text-amber-400',
  high: 'border-red-500/40 bg-red-500/15 text-red-400',
};

const SERVER_TOOLTIP =
  'Network-wide severity across all United hubs, weighting cancellations (×3), diversions (×2), 60min+ delays (×2) and 30–60min delays (×1) — including flights held past schedule — per 100 scheduled flights: Normal · Minor · Significant.';

const CLIENT_TOOLTIP =
  'Estimated from the schedule boards loaded in your session (server IROPS feed unavailable). Severity weights cancellations (×3), diversions (×2), 60min+ delays (×2) and 30–60min delays (×1) per 100 scheduled flights: Normal · Minor · Significant.';

type Counts = {
  cancellations: number | null;
  delayed30: number;
  delayed60: number;
  diversions: number;
  total: number;
};

function Metric({ label, value, tone }: { label: string; value: number | string; tone: string }) {
  return (
    <div className="flex flex-col items-center px-2">
      <span className={cn('font-mono text-sm font-semibold tabular-nums', tone)}>{value}</span>
      <span className="text-[9px] uppercase tracking-wide text-muted-foreground">{label}</span>
    </div>
  );
}

function Placeholder({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border bg-card/40 px-3 py-2">
      <span className="font-mono text-sm text-muted-foreground">—</span>
      <span className="text-[11px] text-muted-foreground">{label}</span>
    </div>
  );
}

export function IropsSection() {
  const irops = useIrops();
  const { boards } = useSchedule();
  const { faaIndex } = useWeather();
  const { reportClientScore } = irops;

  // `boards` is `Record<key, Board>`; the counter wants the rows themselves. `serverNowMs`
  // and `meta.hubDisruptionMinutes` come off the board that produced each row, so the
  // operated-inference grace matches what the Schedule tab would classify — a browser with
  // a skewed clock must not mint phantom cancellations here.
  const fallback = useMemo(() => {
    const rowsByKey: Record<string, Record<string, unknown>[]> = {};
    const nowByKey: Record<string, number> = {};
    const optsByKey: Record<string, { hubDisruptionMinutes: number }> = {};
    for (const [key, board] of Object.entries(boards)) {
      rowsByKey[key] = board.rows;
      nowByKey[key] = Math.floor((board.serverNowMs ?? Date.now()) / 1000);
      const disruption = Number(board.meta?.hubDisruptionMinutes);
      optsByKey[key] = {
        hubDisruptionMinutes: Number.isFinite(disruption) && disruption > 0 ? disruption : 0,
      };
    }
    return countIropsFromBoards(rowsByKey, {
      classify: (flight, dir, key) =>
        classifySchedStatus(flight, dir as 'departures' | 'arrivals', nowByKey[key], optsByKey[key]),
    }) as Counts & { cancellations: number };
  }, [boards]);

  const server = irops.data;
  const usingServer = Boolean(server);
  const hasFallbackRows = fallback.total > 0;

  const counts: Counts | null = usingServer
    ? {
        cancellations: server!.cancellations ?? null,
        delayed30: server!.delayed30,
        delayed60: server!.delayed60,
        diversions: server!.diversions,
        total: server!.totalFlights,
      }
    : hasFallbackRows
      ? fallback
      : null;

  const score = usingServer
    ? server!.score
    : hasFallbackRows
      ? (iropsScore(fallback) as number | string)
      : null;
  const scoreLabel = score === null ? null : (iropsScoreLabel(score) as string);
  const scoreCls = score === null ? null : (iropsScoreCls(score) as string);

  // Single writer: only the client path reports a score, and only while the server has none.
  useEffect(() => {
    if (usingServer) return;
    reportClientScore(hasFallbackRows ? Number(score) : null);
  }, [usingServer, hasFallbackRows, score, reportClientScore]);

  // The level-change announcement is NOT made here: it belongs to `shell/IropsAnnouncer`,
  // which is mounted on every tab. See that file for why.

  const faaLines = useMemo(() => faaAlertLines(faaIndex) as string[], [faaIndex]);

  return (
    <section id="irops-section" aria-labelledby="irops-label" className="scroll-mt-4">
      <h3 id="irops-label" className="sr-only">
        Network disruption index
      </h3>
      <div id="irops-content" aria-live="polite">
        {counts === null || scoreLabel === null ? (
          // Nothing loaded yet vs nothing to load: the server erroring with no boards is a
          // dead feed, not a slow one, and saying "loading" forever would be a lie.
          <Placeholder
            label={irops.error && !hasFallbackRows ? 'IROPS unavailable' : 'Loading schedule data…'}
          />
        ) : (
          <div className="rounded-lg border bg-card/40">
            <div className="flex flex-wrap items-center gap-x-1 gap-y-2 px-3 py-2">
              <span className="flex items-center gap-2 pr-2 text-[11px]">
                <JargonTerm term="irops">IROPS</JargonTerm>
                <span
                  className={cn(
                    'rounded-md border px-2 py-0.5 font-mono text-[11px] font-semibold',
                    SCORE_TONE[scoreCls ?? 'low'],
                  )}
                >
                  {scoreLabel}
                </span>
                {!usingServer ? (
                  <span className="font-mono text-[9px] text-muted-foreground">
                    est · loaded boards
                  </span>
                ) : null}
                <Tooltip>
                  <TooltipTrigger asChild>
                    {/* The GLYPH stays 16 px — it sits inside a dense metric bar — while
                        the TAP AREA is 44 px below `md:`. Padding the hit box rather than
                        growing the circle keeps both promises at once. */}
                    <button
                      type="button"
                      aria-label="What does this mean?"
                      className="flex min-h-11 min-w-11 items-center justify-center md:min-h-0 md:min-w-0"
                    >
                      <span
                        aria-hidden="true"
                        className="flex size-4 items-center justify-center rounded-full border text-[9px] text-muted-foreground"
                      >
                        ?
                      </span>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-[min(320px,80vw)]">
                    {usingServer ? SERVER_TOOLTIP : CLIENT_TOOLTIP}
                  </TooltipContent>
                </Tooltip>
              </span>

              <div className="ml-auto flex flex-wrap items-center divide-x divide-border">
                <Metric
                  label="Cancellations"
                  value={counts.cancellations ?? '—'}
                  tone="text-red-400"
                />
                <Metric label=">30m" value={counts.delayed30} tone="text-amber-400" />
                <Metric label=">60m" value={counts.delayed60} tone="text-red-400" />
                <Metric label="Diversions" value={counts.diversions} tone="text-fuchsia-400" />
                <Metric label="Total Flights" value={counts.total} tone="text-primary" />
              </div>
            </div>

            {/* Only the client path carried this strip: the server payload has no per-airport
                FAA detail, and duplicating it under an authoritative bar implies it came from
                the same computation. */}
            {!usingServer && faaLines.length ? (
              <p className="border-t px-3 py-1.5 font-mono text-[10px] text-muted-foreground">
                {faaLines.join(' · ')}
              </p>
            ) : null}
          </div>
        )}
      </div>
    </section>
  );
}

export default IropsSection;
