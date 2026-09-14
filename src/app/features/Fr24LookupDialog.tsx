/**
 * Flightradar24 flight lookup (inventory §27).
 *
 * The answer to "where is UA328?" when UA328 is not in the live feed — reached from the
 * search palette's lookup row, from `?flight=` when nothing matches, and from the My
 * Flights quick-add. Opened through `useUi().openFr24(query)`, so no caller knows this
 * file exists.
 *
 * FAILURE IS NEVER A MODAL (audit Jul 3 2026). Someone typing a flight number into a
 * search box wants an answer or a shrug, not a full-screen dead end they have to
 * dismiss. A failed lookup closes the dialog and leaves a small dismissable line at the
 * foot of the screen, plus one sentence through the shell's single polite announcer.
 * The line is plain markup with no `aria-live` of its own: §17 has exactly one writer.
 *
 * F048: the live tier returns whichever LEG of this flight number is active or most
 * recent, which is very often not the visitor's. The leg date and a one-line disclaimer
 * are shown whenever that tier answered, so the card is never silently authoritative
 * about somebody else's departure.
 */

import { useEffect, useRef, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { normalizeWifi } from '@/lib/fleet-utils.js';
import {
  formatFr24Time,
  fr24Attribution,
  fr24FailureMessage,
  fr24LegDisclaimer,
  fr24StatusColor,
  fr24StatusLabel,
  normalizeFr24Query,
} from '@/lib/fr24-lookup.js';
import { fetchFr24Flight } from '../data/api';
import { shareUrl } from '../data/share';
import { useFleet } from '../state/fleet';
import { useUi } from '../state/ui';

/**
 * Whether the lookup can actually answer.
 *
 * While this is false, nothing may OFFER the lookup: the search palette hides its row and
 * the `?flight=` deep link says so out loud instead of silently doing nothing. A control
 * that opens a dialog rendering `null` is worse than no control — it reads as a bug to the
 * one person most likely to try it, someone whose flight is not in the air yet.
 */
export const FR24_LOOKUP_AVAILABLE = true;

/** The `flight` object `/api/fr24-flight` returns (inventory §28). */
type Fr24Flight = {
  flightNumber?: string;
  callsign?: string;
  status?: string;
  origin?: { iata?: string; name?: string };
  destination?: { iata?: string; name?: string };
  aircraft?: { type?: string; reg?: string };
  departure?: { scheduled?: string | number; actual?: string | number };
  arrival?: { scheduled?: string | number; estimated?: string | number };
  position?: { lat?: number; lon?: number; alt?: number; speed?: number; heading?: number };
};

type LookupState =
  | { phase: 'loading' }
  | { phase: 'done'; flight: Fr24Flight; source?: string; cached?: boolean; meta?: { liveLeg?: boolean; legDate?: string } };

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] text-muted-foreground">{label}</dt>
      <dd className="font-mono tabular-nums">{value}</dd>
    </div>
  );
}

export default function Fr24LookupDialog() {
  const { fr24Query, openFr24, openAircraft, announce } = useUi();
  const { fleetDb } = useFleet();
  const [state, setState] = useState<LookupState>({ phase: 'loading' });
  const [failure, setFailure] = useState<string | null>(null);
  const [shareLabel, setShareLabel] = useState('Share');
  const generation = useRef(0);

  const query = fr24Query ? normalizeFr24Query(fr24Query) : '';
  const open = Boolean(fr24Query);

  useEffect(() => {
    if (!fr24Query) return undefined;
    const normalised = normalizeFr24Query(fr24Query);
    const run = generation.current + 1;
    generation.current = run;
    setState({ phase: 'loading' });
    setFailure(null);
    setShareLabel('Share');

    let cancelled = false;
    /** Close, say what happened, and get out of the way. */
    const fail = (message: string) => {
      if (cancelled || generation.current !== run) return;
      setFailure(message);
      announce(message);
      openFr24(null);
    };

    fetchFr24Flight(normalised).then(
      (data) => {
        if (cancelled || generation.current !== run) return;
        if (!data.success || !data.flight) {
          fail(fr24FailureMessage(normalised, data.error));
          return;
        }
        setState({
          phase: 'done',
          flight: data.flight as Fr24Flight,
          source: data.source,
          cached: data.cached,
          meta: data.meta,
        });
      },
      () => fail(`Lookup failed for ${normalised} — try again in a moment.`),
    );
    return () => {
      cancelled = true;
    };
  }, [fr24Query, announce, openFr24]);

  const flight = state.phase === 'done' ? state.flight : null;
  const statusColor = fr24StatusColor(flight?.status);
  const statusLabel = fr24StatusLabel(flight?.status);
  const disclaimer =
    state.phase === 'done' ? fr24LegDisclaimer(state.source, state.meta) : { show: false, legDateLabel: '', text: '' };
  const fleetMatch = flight?.aircraft?.reg
    ? fleetDb.find((row) => row.r === flight.aircraft?.reg)
    : undefined;

  async function onShare() {
    if (!flight?.flightNumber) return;
    const url = new URL(window.location.href);
    url.searchParams.set('flight', flight.flightNumber);
    url.hash = '';
    const result = await shareUrl(url.toString());
    setShareLabel(result === 'copied' ? '✓ Copied!' : 'Copy it');
    announce(
      result === 'copied'
        ? `Link to ${flight.flightNumber} copied`
        : `Link to ${flight.flightNumber} ready to copy`,
    );
    setTimeout(() => setShareLabel('Share'), 2000);
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => (next ? undefined : openFr24(null))}>
        <DialogContent
          aria-label="Flight lookup"
          className="max-w-[min(420px,calc(100vw-2rem))]"
        >
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2 font-mono">
              <span className="text-base font-bold text-primary">
                {flight?.flightNumber || query || '?'}
              </span>
              {flight ? (
                <Badge
                  variant="outline"
                  className="text-[9px] font-semibold"
                  style={{
                    backgroundColor: `${statusColor}22`,
                    color: statusColor,
                    borderColor: `${statusColor}44`,
                  }}
                >
                  {statusLabel}
                </Badge>
              ) : null}
            </DialogTitle>
            <DialogDescription className="font-mono text-[10px]">
              {flight?.callsign || (state.phase === 'loading' ? `Looking up ${query}…` : '')}
            </DialogDescription>
          </DialogHeader>

          {state.phase === 'loading' ? (
            <div className="space-y-2" aria-busy="true">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-3 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          ) : null}

          {flight ? (
            <div className="space-y-3 text-xs">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 text-center">
                  <div className="font-mono text-lg font-bold">{flight.origin?.iata || '?'}</div>
                  <div className="truncate text-[9px] text-muted-foreground">
                    {flight.origin?.name || ''}
                  </div>
                </div>
                <div className="flex-1 text-center text-muted-foreground" aria-hidden="true">
                  ✈ →
                </div>
                <div className="min-w-0 text-center">
                  <div className="font-mono text-lg font-bold">
                    {flight.destination?.iata || '?'}
                  </div>
                  <div className="truncate text-[9px] text-muted-foreground">
                    {flight.destination?.name || ''}
                  </div>
                </div>
              </div>

              {disclaimer.show ? (
                <p className="rounded-r border-l-[3px] border-amber-500 bg-amber-500/10 px-2.5 py-1.5 text-[9px] leading-relaxed text-muted-foreground">
                  {disclaimer.legDateLabel ? (
                    <>
                      <span className="font-semibold text-amber-400">
                        Leg date: {disclaimer.legDateLabel}
                      </span>
                      <br />
                    </>
                  ) : null}
                  {disclaimer.text}
                </p>
              ) : null}

              {flight.aircraft?.type || flight.aircraft?.reg ? (
                <p className="text-[10px]">
                  <span className="text-muted-foreground">Aircraft: </span>
                  {flight.aircraft?.type || '?'}
                  {flight.aircraft?.reg ? (
                    <>
                      {' • '}
                      <button
                        type="button"
                        className="font-mono underline decoration-dotted underline-offset-2 hover:text-primary"
                        onClick={() => {
                          openFr24(null);
                          openAircraft(flight.aircraft?.reg ?? null);
                        }}
                      >
                        {flight.aircraft.reg}
                      </button>
                    </>
                  ) : null}
                </p>
              ) : null}

              <dl className="grid grid-cols-2 gap-2 text-[10px]">
                <Field label="Dep Sched" value={formatFr24Time(flight.departure?.scheduled)} />
                <Field label="Dep Actual" value={formatFr24Time(flight.departure?.actual)} />
                <Field label="Arr Sched" value={formatFr24Time(flight.arrival?.scheduled)} />
                <Field label="Arr Est" value={formatFr24Time(flight.arrival?.estimated)} />
              </dl>

              {fleetMatch ? (
                <p className="rounded bg-primary/10 p-2 text-[10px]">
                  <span className="text-primary">Fleet Match:</span> {fleetMatch.t}
                  {fleetMatch.c ? ` • ${fleetMatch.c}` : ''}
                  {fleetMatch.w ? ` • WiFi: ${normalizeWifi(fleetMatch.w)}` : ''}
                </p>
              ) : null}

              {flight.position?.lat != null && flight.position?.lon != null ? (
                <p className="rounded bg-muted/40 p-2 font-mono text-[10px] tabular-nums">
                  <span className="text-muted-foreground">Position: </span>
                  {Number(flight.position.lat).toFixed(2)}°, {Number(flight.position.lon).toFixed(2)}°
                  {flight.position.alt != null ? ` • ${flight.position.alt.toLocaleString()} ft` : ''}
                  {flight.position.speed != null ? ` • ${flight.position.speed} kts` : ''}
                  {flight.position.heading != null ? ` • hdg ${flight.position.heading}°` : ''}
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="flex items-center justify-between gap-2 border-t pt-2.5">
            <p className="text-[9px] text-muted-foreground">
              {fr24Attribution(state.phase === 'done' ? state.cached : false)}
            </p>
            {flight?.flightNumber ? (
              <Button
                size="sm"
                variant="ghost"
                className="h-auto min-h-11 px-2 py-0 text-[11px] md:min-h-0 md:py-1"
                onClick={() => void onShare()}
                aria-label={`Share a link to ${flight.flightNumber}`}
              >
                {shareLabel}
              </Button>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>

      {/* Not a modal and not a live region: the announcer already said this once. */}
      {failure ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex justify-center px-4">
          <div className="pointer-events-auto flex max-w-md items-start gap-2 rounded-md border border-amber-500/40 bg-card px-3 py-2 text-[11px] leading-relaxed shadow-lg">
            <span className="flex-1">{failure}</span>
            <Button
              size="sm"
              variant="ghost"
              className="h-auto min-h-11 shrink-0 px-2 py-0 text-[11px] md:min-h-0"
              onClick={() => setFailure(null)}
            >
              Dismiss
            </Button>
          </div>
        </div>
      ) : null}
    </>
  );
}
