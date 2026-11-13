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
 *
 * The names it prints link to their homes (links part 2). The hub ends and the type are
 * `fromOverlay`, so following one closes this dialog (and any other overlay) and lands as an
 * arrival: a hub end on its Schedule board, the type on the Fleet tab filtered to it (by the tail's
 * fleet type: FR24 sends an ICAO code, which never decides a link on its own). The tail opens its
 * aircraft dialog in place of this one and closes nothing else, as its button did (`TailAnchor`):
 * a flight sheet open under the lookup stays open.
 */

import { Plane } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  focusContentOnOpen,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { fleetTypeCodeFor } from '@/lib/fleet-type-link.js';
import { normalizeWifi } from '@/lib/fleet-utils.js';
import { tailLink } from '@/lib/tail-link.js';
import { cn } from '@/lib/utils';
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
import { useFollowDeepLink } from '../state/follow-link';
import { useUi } from '../state/ui';
import { dashLinkClick } from './DashLink';
import { HubLink, TypeLink } from './EntityLinks';
import { FlightLink } from './FlightLink';
import { LINK_HIT, LINK_TONE } from './link-style';

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
  arrival?: { scheduled?: string | number; estimated?: string | number; actual?: string | number };
  position?: { lat?: number; lon?: number; alt?: number; speed?: number; heading?: number };
};

type LookupState =
  | { phase: 'loading' }
  | {
      phase: 'done';
      flight: Fr24Flight;
      source?: string;
      cached?: boolean;
      meta?: { liveLeg?: boolean; legDate?: string };
      previousLeg?: boolean;
      legDate?: string;
    };

/** "Sat, Sep 26" for a leg's ISO date, or '' when it has none. */
function fr24PreviousLegDate(iso: string | undefined): string {
  const date = iso ? new Date(iso) : null;
  return date && !Number.isNaN(date.getTime())
    ? date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
    : '';
}

/**
 * The lookup's tail: a link to its aircraft dialog that closes this dialog and nothing else, as
 * the button it replaced did (`openFr24(null)`, then the dialog). A `TailLink` with `fromOverlay`
 * would also close a flight sheet open under the lookup; one without it would leave this dialog
 * open under the aircraft dialog. So it is the contract's anchor recipe: followed in place
 * (`dashLinkClick`), then this dialog closes. A modified click is the browser's and closes nothing.
 */
function TailAnchor({ reg, onFollowed }: { reg: string; onFollowed: () => void }) {
  const follow = useFollowDeepLink();
  const link = tailLink(reg);
  if (!link) return <span className="font-mono">{reg}</span>;
  return (
    <a
      href={link.href}
      data-tail-link={link.reg}
      className={cn(LINK_TONE.quiet, LINK_HIT.inline, 'font-mono')}
      onClick={(event) => {
        if (dashLinkClick(follow, link.href)(event)) onFollowed();
      }}
    >
      {reg}
    </a>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      {/* The aircraft dialog's label style, so the two dialogs a tail link moves between match. */}
      <dt className="text-[9px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="font-mono tabular-nums">{value}</dd>
    </div>
  );
}

export default function Fr24LookupDialog() {
  const { fr24Query, openFr24, announce } = useUi();
  const { fleetDb, fleetByReg } = useFleet();
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
          // The live endpoint carries `liveLeg`/`legDate` at the top level, which is
          // what the shipped modal read (it was handed the whole response as its meta).
          meta: data.meta ?? { liveLeg: data.liveLeg, legDate: data.legDate },
          previousLeg: data.previousLeg,
          legDate: data.legDate,
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
  // F0: the answer is an earlier leg (no leg is flying or just landed). Say so, with its date,
  // instead of letting "LANDED" read as the flight the visitor is about to take.
  const previousLegDate =
    state.phase === 'done' && state.previousLeg ? fr24PreviousLegDate(state.legDate) : null;
  const fleetMatch = flight?.aircraft?.reg
    ? fleetDb.find((row) => row.r === flight.aircraft?.reg)
    : undefined;
  // Both type mentions link by the tail's fleet type; with no tail the feed's ICAO code is plain.
  const typeCode = fleetTypeCodeFor({ reg: flight?.aircraft?.reg, fleetByReg });

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
        // The title's flight number is a link now; Radix would land on it and Enter would leave
        // the dialog. Focus the dialog itself; the first Tab reaches the link (AircraftDetailDialog).
        onOpenAutoFocus={focusContentOnOpen}
          className="max-w-[min(420px,calc(100vw-2rem))]"
        >
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2 font-mono">
              {/* A link to the flight's page when it is a United number, body text when not. */}
              <FlightLink ident={flight?.flightNumber || query || '?'} className="text-base font-bold" />
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
                {/* A hub end links to its Schedule board (quiet); any other airport is plain. */}
                <div className="min-w-0 text-center">
                  <div className="font-mono text-lg font-bold">
                    {flight.origin?.iata ? <HubLink code={flight.origin.iata} fromOverlay /> : '?'}
                  </div>
                  <div className="truncate text-[9px] text-muted-foreground">
                    {flight.origin?.name || ''}
                  </div>
                </div>
                <div className="flex flex-1 justify-center text-muted-foreground" aria-hidden="true">
                  <Plane className="size-4" />
                </div>
                <div className="min-w-0 text-center">
                  <div className="font-mono text-lg font-bold">
                    {flight.destination?.iata ? <HubLink code={flight.destination.iata} fromOverlay /> : '?'}
                  </div>
                  <div className="truncate text-[9px] text-muted-foreground">
                    {flight.destination?.name || ''}
                  </div>
                </div>
              </div>

              {previousLegDate !== null ? (
                <p className="rounded-r border-l-[3px] border-bb-warn bg-bb-warn/10 px-2.5 py-1.5 text-[9px] leading-relaxed text-muted-foreground">
                  <span className="font-semibold text-bb-warn">
                    Last operated{previousLegDate ? ` ${previousLegDate}` : ''}
                  </span>
                  <br />
                  No {flight?.flightNumber || query} is flying right now. This is its most recent
                  completed leg — not today&rsquo;s flight, which has not departed yet.
                </p>
              ) : null}

              {disclaimer.show ? (
                <p className="rounded-r border-l-[3px] border-bb-warn bg-bb-warn/10 px-2.5 py-1.5 text-[9px] leading-relaxed text-muted-foreground">
                  {disclaimer.legDateLabel ? (
                    <>
                      <span className="font-semibold text-bb-warn">
                        Leg date: {disclaimer.legDateLabel}
                      </span>
                      <br />
                    </>
                  ) : null}
                  {disclaimer.text}
                </p>
              ) : null}

              {flight.aircraft?.type || flight.aircraft?.reg ? (
                // Both names quiet and 44 px tall on touch (`hit="inline"`), side by side without boxes
                // that could overlap. The tail replaces this dialog with its aircraft dialog.
                <p className="text-[10px]">
                  <span className="text-muted-foreground">Aircraft: </span>
                  <TypeLink typeCode={typeCode} hit="inline" fromOverlay>
                    {flight.aircraft?.type || '?'}
                  </TypeLink>
                  {flight.aircraft?.reg ? (
                    <>
                      {' · '}
                      <TailAnchor reg={flight.aircraft.reg} onFollowed={() => openFr24(null)} />
                    </>
                  ) : null}
                </p>
              ) : null}

              <dl className="grid grid-cols-2 gap-2 text-[10px]">
                <Field label="Dep Sched" value={formatFr24Time(flight.departure?.scheduled)} />
                <Field label="Dep Actual" value={formatFr24Time(flight.departure?.actual)} />
                <Field label="Arr Sched" value={formatFr24Time(flight.arrival?.scheduled)} />
                {flight.arrival?.actual ? (
                  <Field label="Arr Actual" value={formatFr24Time(flight.arrival.actual)} />
                ) : (
                  <Field label="Arr Est" value={formatFr24Time(flight.arrival?.estimated)} />
                )}
              </dl>

              {fleetMatch ? (
                // A label in the muted colour of this dialog's other labels ("Aircraft:", "Position:"),
                // not link colour. The type links to the Fleet tab.
                <p className="rounded bg-primary/10 p-2 text-[10px]">
                  <span className="text-muted-foreground">Fleet Match:</span>{' '}
                  <TypeLink typeCode={typeCode} fromOverlay>
                    {fleetMatch.t}
                  </TypeLink>
                  {fleetMatch.c ? ` · ${fleetMatch.c}` : ''}
                  {fleetMatch.w ? ` · WiFi: ${normalizeWifi(fleetMatch.w)}` : ''}
                </p>
              ) : null}

              {flight.position?.lat != null && flight.position?.lon != null ? (
                <p className="rounded bg-muted/40 p-2 font-mono text-[10px] tabular-nums">
                  <span className="text-muted-foreground">Position: </span>
                  {Number(flight.position.lat).toFixed(2)}°, {Number(flight.position.lon).toFixed(2)}°
                  {flight.position.alt != null ? ` · ${flight.position.alt.toLocaleString()} ft` : ''}
                  {flight.position.speed != null ? ` · ${flight.position.speed} kts` : ''}
                  {flight.position.heading != null ? ` · hdg ${flight.position.heading}°` : ''}
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
                className="h-auto min-h-11 px-2 py-0 text-[11px] pointer-fine:md:min-h-0 md:py-1"
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
          <div className="pointer-events-auto flex max-w-md items-start gap-2 rounded-md border border-bb-warn/40 bg-card px-3 py-2 text-[11px] leading-relaxed shadow-lg">
            <span className="flex-1">{failure}</span>
            <Button
              size="sm"
              variant="ghost"
              className="h-auto min-h-11 shrink-0 px-2 py-0 text-[11px] pointer-fine:md:min-h-0"
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
