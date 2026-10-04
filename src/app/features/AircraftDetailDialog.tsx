/**
 * One airframe's whole story (inventory §27 "Aircraft detail").
 *
 * Opened from everywhere a registration appears — the flight sheet, both fleet tables, the
 * special panel, the search palette, `?aircraft=REG` — through the single `openAircraft(reg)`
 * in the UI store, so none of those callers has to know this file exists.
 *
 * Three states, and the distinction between the last two matters:
 *  - the fleet database is still loading → a skeleton, NOT "not in the fleet". A cold load
 *    that answers "unknown aircraft" for a tail the visitor is looking at right now is a
 *    lie with a 1.5-second window, and `?aircraft=` lands squarely inside it.
 *  - loaded, registration absent → this is a United Express regional or a foreign airframe;
 *    say so and offer Planespotters, which does know it. When the United Express fleet
 *    (`expressByReg`, discovered from United's own flying) knows the tail, the card shows what it
 *    knows instead — type, operator, a verified cabin, Starlink, first/last seen and the last
 *    United flight — and still never a guess.
 *  - loaded and found → the full card.
 *
 * Registrations are normalised the way the database stores them (dashes out, upper case)
 * because the feed, the schedule and hand-typed deep links all disagree about the dash.
 *
 * Escape and the backdrop close it: both come from Radix, which also restores focus to
 * whatever opened it — the row in the table you were reading, not the top of the page.
 */

import { Eye, Share2, Star, Zap } from 'lucide-react';
import { useCallback, useMemo, useRef } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { cityFor } from '@/lib/airports.js';
import { matchExpress } from '@/lib/express-fleet.js';
import {
  expressDateLabel,
  expressLastSeenLabel,
  expressOperatorLine,
  expressWifiLabel,
} from '@/lib/express-fleet-view.js';
import { categorizeFleetStatus, FLEET_HEALTH_CATEGORIES, normalizeWifi } from '@/lib/fleet-utils.js';
import { buildSeatBar, nonMainlineAircraftSummary } from '@/lib/fleet-view.js';
import { getPhase } from '@/lib/flight-phase.js';
import { ENGINE_BY_TYPE } from '@/lib/special-aircraft.js';
import { liveryForTail } from '@/lib/special-livery.js';
import { shareUrl } from '../data/share';
import type { ExpressAircraft, Flight } from '../data/types';
import { useFeed } from '../state/feed';
import { useFleet } from '../state/fleet';
import { useUi } from '../state/ui';
import { useWatch } from '../state/watch';
import { JargonTerm } from './JargonTerm';
import { SpecialLiveryBadge } from './SpecialLiveryBadge';

/** The fleet database stores `N17104`; the feed says `N17-104` and people type `n17104`. */
function normalizeReg(raw: string | null): string {
  return (raw ?? '').replace(/-/g, '').toUpperCase();
}

function planespottersUrl(reg: string) {
  return `https://www.planespotters.net/search?q=${encodeURIComponent(reg)}`;
}

/**
 * One cell of the biography grid. `min-w-0` + `overflow-wrap:anywhere` because a grid column
 * is ~111 px in the 512 px dialog, and a value with no spaces ("50J/24PE/46E+/156Y") used to
 * spill past it and get clipped at the dialog edge (F6/F62).
 */
function Fact({
  label,
  value,
  tone,
  className,
}: {
  label: string;
  value: string;
  tone?: string;
  className?: string;
}) {
  return (
    <div className={`min-w-0 ${className ?? ''}`}>
      <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={`mt-0.5 text-sm font-medium [overflow-wrap:anywhere] ${tone ?? ''}`}>{value}</dd>
    </div>
  );
}

export default function AircraftDetailDialog() {
  const { aircraftReg, openAircraft, select, focusOn, setTab, onboardingOpen, announce } = useUi();
  const { fleetByReg, expressByReg, starlink, special, loading, loadFailed, retry } = useFleet();
  const { flights } = useFeed();
  const watch = useWatch();
  const contentRef = useRef<HTMLDivElement>(null);

  const reg = normalizeReg(aircraftReg);
  // The onboarding overlay is the one thing allowed in front of this: a first-time visitor
  // arriving on a shared `?aircraft=` link should be walked in, then shown the aircraft.
  const open = Boolean(aircraftReg) && !onboardingOpen;
  const aircraft = reg ? fleetByReg[reg] : undefined;

  const liveFlight = useMemo<Flight | undefined>(
    () => (reg ? flights.find((f) => normalizeReg(f.reg) === reg && !f.onGround) : undefined),
    [flights, reg],
  );

  const onShare = useCallback(async () => {
    if (!reg || typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    url.searchParams.set('aircraft', reg);
    // The address bar is made to match what was copied, so a visitor who shares by
    // copying the bar instead of the button gets the same link.
    window.history.replaceState(null, '', url);
    const result = await shareUrl(url.toString());
    announce(result === 'copied' ? `Link to ${reg} copied` : `Link to ${reg} ready to copy`);
  }, [reg, announce]);

  const onClose = useCallback(() => openAircraft(null), [openAircraft]);

  /** The live block is a button: it sends the map to this aircraft and gets out of the way. */
  const onViewOnMap = useCallback(() => {
    if (!liveFlight) return;
    select({ kind: 'flight', flight: liveFlight });
    focusOn(liveFlight.lat, liveFlight.lon);
    setTab('live');
    openAircraft(null);
  }, [liveFlight, select, focusOn, setTab, openAircraft]);

  const isStarlink = Boolean(reg) && starlink.tails.has(reg);
  // D6: what the roster and the feed know about a tail the mainline database does not.
  const fallback = useMemo(
    () =>
      aircraft
        ? null
        : (nonMainlineAircraftSummary(reg, starlink.aircraft, liveFlight) as {
            starlink: boolean;
            type: string;
            operator: string;
            fleet: string;
            flight: { ident: string; origin: string; dest: string } | null;
          } | null),
    [aircraft, reg, starlink.aircraft, liveFlight],
  );
  // The United Express fleet's entry, preferred over the roster/feed fallback for identity; the
  // fallback still supplies the live "Airborne — View on map" flight.
  const express = useMemo(
    () => (aircraft ? null : (matchExpress(reg, expressByReg) as ExpressAircraft | null)),
    [aircraft, reg, expressByReg],
  );
  const expressStarlink = Boolean(express) && (express?.w === 'Starlink' || Boolean(fallback?.starlink));
  const specialEntry = reg ? special.get(reg) : undefined;
  const livery = liveryForTail(reg);

  const age = aircraft?.d ? new Date().getFullYear() - parseInt(String(aircraft.d), 10) : null;
  const category = categorizeFleetStatus(aircraft?.s) as string;
  const categoryInfo = (FLEET_HEALTH_CATEGORIES as { key: string; label: string; color: string }[])
    .find((c) => c.key === category) ?? { key: 'active', label: 'Active', color: '#22c55e' };

  const seats = Object.entries(aircraft?.seats ?? {}).filter(([, count]) => Number(count) > 0);
  const seatBar = buildSeatBar(aircraft?.seats, aircraft?.tot) as {
    cabin: string;
    count: number;
    flex: number;
    color: string;
    showLabel: boolean;
  }[];

  const phase = liveFlight
    ? (getPhase(liveFlight.alt, liveFlight.vr, liveFlight.spd) as { phase: string; icon: string })
    : null;
  const watchIdent = liveFlight ? liveFlight.flightIATA || liveFlight.callsign || '' : '';
  const watched = watchIdent ? watch.isWatched(watchIdent) : false;

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent
        ref={contentRef}
        aria-label="Aircraft detail"
        className="max-h-[85svh] gap-0 overflow-y-auto p-0 sm:max-w-lg"
        // Radix would otherwise focus the first focusable child, which is the jargon
        // trigger inside the title — opening the dialog with a tooltip already covering
        // its own header. Focus the panel instead: the trap still starts here, Escape
        // still closes, and the first Tab reaches the same controls.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          contentRef.current?.focus();
        }}
      >
        <DialogHeader className="gap-1 border-b p-4 pr-12">
          <DialogTitle className="font-mono text-2xl tracking-tight">
            <JargonTerm term="tail">{reg || '—'}</JargonTerm>
          </DialogTitle>
          {loading && !aircraft ? (
            <DialogDescription>Loading the fleet database…</DialogDescription>
          ) : loadFailed && !aircraft ? (
            <DialogDescription>Fleet database unavailable</DialogDescription>
          ) : aircraft ? (
            <>
              <DialogDescription className="flex flex-wrap items-center gap-2 text-sm">
                <JargonTerm term="equipment">{String(aircraft.t ?? '')}</JargonTerm>
                {aircraft.a ? (
                  <span className="font-mono text-xs text-muted-foreground">
                    AC# {String(aircraft.a)}
                  </span>
                ) : null}
              </DialogDescription>
              {specialEntry || isStarlink || livery ? (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {specialEntry ? (
                    <Badge variant="outline">
                      <Star aria-hidden="true" /> {specialEntry.name}
                    </Badge>
                  ) : null}
                  <SpecialLiveryBadge livery={livery} />
                  {isStarlink ? (
                    <Badge className="border-bb-starlink/30 bg-bb-starlink/10 text-bb-starlink">
                      <Zap aria-hidden="true" /> STARLINK
                    </Badge>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : express ? (
            <>
              <DialogDescription className="flex flex-wrap items-center gap-2 text-sm">
                <span>{express.t || 'Type unknown'}</span>
                <span className="text-xs text-muted-foreground">{expressOperatorLine(express)}</span>
              </DialogDescription>
              {expressStarlink ? (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  <Badge className="border-bb-starlink/30 bg-bb-starlink/10 text-bb-starlink">
                    <Zap aria-hidden="true" /> STARLINK
                  </Badge>
                </div>
              ) : null}
            </>
          ) : fallback ? (
            <>
              <DialogDescription className="flex flex-wrap items-center gap-2 text-sm">
                {fallback.type ? <span>{fallback.type}</span> : null}
                {fallback.operator ? (
                  <span className="text-xs text-muted-foreground">{fallback.operator}</span>
                ) : null}
              </DialogDescription>
              {fallback.starlink ? (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  <Badge className="border-bb-starlink/30 bg-bb-starlink/10 text-bb-starlink">
                    <Zap aria-hidden="true" /> STARLINK
                  </Badge>
                </div>
              ) : null}
            </>
          ) : (
            <DialogDescription>Not in mainline fleet database</DialogDescription>
          )}
        </DialogHeader>

        {loading && !aircraft ? (
          <div className="space-y-3 p-4">
            <Skeleton className="h-4 w-32" />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
            <Skeleton className="h-20 w-full" />
          </div>
        ) : loadFailed && !aircraft ? (
          // F035 again, at dialog scale: when the database did not load, "not in the fleet"
          // is a claim about THIS aircraft that nothing supports. Say which of the two
          // happened, and offer the retry rather than a dead end.
          <>
            <div className="p-6 text-center text-sm text-muted-foreground">
              <p>
                The fleet database could not be loaded, so there is nothing to look{' '}
                {reg} up in.
              </p>
              <p className="mt-1 font-medium text-foreground">
                This is a load error — not an unknown aircraft.
              </p>
            </div>
            <DialogFooter className="mx-0 mb-0 flex-row flex-wrap justify-center gap-2 sm:justify-center">
              <Button size="lg" className="min-h-11 pointer-fine:md:min-h-0" onClick={retry}>
                ↻ Retry
              </Button>
              <Button variant="outline" size="lg" className="min-h-11 pointer-fine:md:min-h-0" asChild>
                <a href={planespottersUrl(reg)} target="_blank" rel="noopener noreferrer">
                  Planespotters ↗
                </a>
              </Button>
            </DialogFooter>
          </>
        ) : !aircraft ? (
          <>
            {express ? (
              <div className="space-y-4 p-4">
                <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Fact label="Type" value={express.t || '—'} />
                  <Fact label="Operator" value={express.o || '—'} className="col-span-2" />
                  <Fact
                    label="Starlink"
                    value={expressStarlink ? 'Yes ⚡' : 'Not on the roster'}
                    tone={expressStarlink ? 'text-bb-ok' : 'text-muted-foreground'}
                  />
                  {/* "No Wi-Fi" only for a type verified to have none; unknown is a dash. */}
                  <Fact label="WiFi" value={(expressWifiLabel(express, expressStarlink) as string) || '—'} />
                  {/* A cabin only when one is verified for this type and operator. */}
                  {express.c ? <Fact label="Config" value={express.c} className="col-span-2" /> : null}
                  {express.c && express.tot ? <Fact label="Total Seats" value={String(express.tot)} /> : null}
                  <Fact label="Last United flight" value={express.lf || '—'} tone="font-mono" />
                  <Fact label="First seen" value={expressDateLabel(express.fs) || '—'} />
                  <Fact label="Last seen" value={expressLastSeenLabel(express.ls) || '—'} />
                </dl>
                {fallback?.flight ? (
                  <button
                    type="button"
                    onClick={onViewOnMap}
                    aria-label={`View ${fallback.flight.ident} on the map`}
                    className="w-full rounded-lg border bg-card p-3 text-left transition-colors hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-bb-ok">
                        Airborne — {fallback.flight.ident}
                      </span>
                      <span className="text-[10px] text-muted-foreground">View on map →</span>
                    </div>
                    <div className="mt-1 text-[10px] text-muted-foreground">
                      {fallback.flight.origin || '?'} → {fallback.flight.dest || '?'}
                    </div>
                  </button>
                ) : (
                  <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
                    On ground / Not currently tracked
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  A United Express (regional) aircraft — not in the United mainline fleet database.
                  {express.fs
                    ? ' First and last seen are when The Blue Board saw it flying a United flight.'
                    : ' Listed by the Starlink roster; not yet seen flying a United flight here.'}
                </p>
              </div>
            ) : fallback ? (
              <div className="space-y-4 p-4">
                <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Fact label="Type" value={fallback.type || '—'} />
                  <Fact label="Operator" value={fallback.operator || '—'} className="col-span-2" />
                  <Fact
                    label="Starlink"
                    value={fallback.starlink ? 'Yes ⚡' : 'Not on the roster'}
                    tone={fallback.starlink ? 'text-bb-ok' : 'text-muted-foreground'}
                  />
                </dl>
                {fallback.flight ? (
                  <button
                    type="button"
                    onClick={onViewOnMap}
                    aria-label={`View ${fallback.flight.ident} on the map`}
                    className="w-full rounded-lg border bg-card p-3 text-left transition-colors hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-bb-ok">
                        Airborne — {fallback.flight.ident}
                      </span>
                      <span className="text-[10px] text-muted-foreground">View on map →</span>
                    </div>
                    <div className="mt-1 text-[10px] text-muted-foreground">
                      {fallback.flight.origin || '?'} → {fallback.flight.dest || '?'}
                    </div>
                  </button>
                ) : (
                  <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
                    On ground / Not currently tracked
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  Not in the United mainline fleet database
                  {fallback.fleet === 'Express' ? ' — a United Express (regional) aircraft.' : '.'}
                </p>
              </div>
            ) : (
              <div className="p-6 text-center text-sm text-muted-foreground">
                <p>This aircraft is not in the United mainline fleet database.</p>
                <p className="mt-1">It may be a United Express (regional) aircraft.</p>
              </div>
            )}
            <DialogFooter className="mx-0 mb-0 justify-center">
              <Button variant="outline" size="lg" className="min-h-11 pointer-fine:md:min-h-0" asChild>
                <a href={planespottersUrl(reg)} target="_blank" rel="noopener noreferrer">
                  Planespotters ↗
                </a>
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <div className="space-y-4 p-4">
              <section>
                <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Biography
                </h3>
                <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Fact
                    label="Delivered"
                    value={`${aircraft.d || '—'}${age !== null && !Number.isNaN(age) ? ` (${age} yrs)` : ''}`}
                  />
                  <Fact label="Total Seats" value={aircraft.tot ? String(aircraft.tot) : '—'} />
                  <Fact label="WiFi" value={(normalizeWifi(aircraft.w) as string) || '—'} />
                  <Fact label="IFE" value={aircraft.i || '—'} />
                  <Fact label="Power" value={aircraft.p || '—'} />
                  <Fact
                    label="Engine"
                    value={(ENGINE_BY_TYPE as Record<string, string>)[aircraft.t] || 'Unknown'}
                  />
                  <Fact
                    label="Starlink"
                    value={isStarlink ? 'Yes ⚡' : 'No'}
                    tone={isStarlink ? 'text-bb-ok' : 'text-muted-foreground'}
                  />
                  {/* The cabin string is the longest value here: it gets two columns so it
                      reads on one line at desktop width. */}
                  {aircraft.c ? (
                    <Fact label="Config" value={aircraft.c} className="col-span-2" />
                  ) : null}
                </dl>
              </section>

              <Separator />

              <section>
                <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Status
                </h3>
                <div className="flex flex-wrap items-center gap-2">
                  {/* The dot carries the fleet-health colour; the label carries the meaning,
                      so the badge never depends on colour alone. */}
                  <Badge variant="outline" className="gap-1.5">
                    <span
                      aria-hidden="true"
                      className="inline-block size-2 rounded-full"
                      style={{ background: categoryInfo.color }}
                    />
                    {categoryInfo.label}
                  </Badge>
                  {/* A leading '*' is the fleet site's marker for a NAME, not a status —
                      it is already shown as the ⭐ badge above. */}
                  {aircraft.s && !aircraft.s.startsWith('*') ? (
                    <span className="text-xs text-muted-foreground">{aircraft.s}</span>
                  ) : null}
                </div>
              </section>

              <section>
                <h3 className="mb-2 flex items-center justify-between text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Live Status
                </h3>
                {liveFlight && phase ? (
                  <button
                    type="button"
                    onClick={onViewOnMap}
                    // Without this the accessible name is the whole card concatenated —
                    // "Airborne UA360 View on map Denver Seattle 33,950 ft 413 kts …".
                    aria-label={`View ${liveFlight.flightIATA || liveFlight.callsign || reg} on the map`}
                    className="w-full rounded-lg border bg-card p-3 text-left transition-colors hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-bb-ok">
                        {phase.icon} Airborne — {liveFlight.flightIATA || liveFlight.callsign || '?'}
                      </span>
                      <span className="text-[10px] text-muted-foreground">View on map →</span>
                    </div>
                    <div className="mt-1 text-xs font-medium">
                      {cityFor(liveFlight.origin) && cityFor(liveFlight.dest)
                        ? `${cityFor(liveFlight.origin)} → ${cityFor(liveFlight.dest)} `
                        : null}
                      <span className="text-[10px] text-muted-foreground">
                        {liveFlight.origin || '?'} → {liveFlight.dest || '?'}
                      </span>
                    </div>
                    <dl className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <Fact
                        label="Altitude"
                        value={
                          liveFlight.alt
                            ? `${Math.round(liveFlight.alt * 3.28084).toLocaleString()} ft`
                            : '—'
                        }
                      />
                      <Fact
                        label="Speed"
                        value={liveFlight.spd ? `${Math.round(liveFlight.spd * 1.944)} kts` : '—'}
                      />
                      <Fact
                        label="Heading"
                        value={liveFlight.hdg ? `${Math.round(liveFlight.hdg)}°` : '—'}
                      />
                      <Fact label="Phase" value={phase.phase} />
                    </dl>
                  </button>
                ) : (
                  <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
                    On ground / Not currently tracked
                  </p>
                )}
              </section>

              {seats.length > 0 ? (
                <section>
                  <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Seat Configuration
                  </h3>
                  <div className="mb-2 flex flex-wrap items-center gap-1.5">
                    {seats.map(([cabin, count]) => (
                      <span
                        key={cabin}
                        className="rounded border px-1.5 py-0.5 font-mono text-xs tabular-nums"
                      >
                        {count}
                        {cabin}
                      </span>
                    ))}
                    {aircraft.tot ? (
                      <span className="text-[10px] text-muted-foreground">
                        ({aircraft.tot} total)
                      </span>
                    ) : null}
                  </div>
                  {/* Flex basis is the raw seat count, so the browser divides the row and a
                      rounding error can never leave a gap between two cabins. */}
                  <div
                    className="flex h-6 w-full overflow-hidden rounded"
                    role="img"
                    aria-label={`Cabin split: ${seatBar.map((s) => `${s.count} ${s.cabin}`).join(', ')}`}
                  >
                    {seatBar.map((segment) => (
                      <div
                        key={segment.cabin}
                        className="flex items-center justify-center text-[10px] font-medium text-foreground"
                        style={{ flex: segment.flex, background: segment.color }}
                      >
                        {segment.showLabel ? `${segment.count}${segment.cabin}` : ''}
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}
            </div>

            <DialogFooter className="mx-0 mb-0 flex-row flex-wrap justify-start gap-2 sm:justify-start">
              {liveFlight && watchIdent ? (
                <Button
                  variant={watched ? 'secondary' : 'outline'}
                  size="lg"
                  className="min-h-11 pointer-fine:md:min-h-0"
                  onClick={() => {
                    const nowWatched = watch.toggle(
                      watchIdent,
                      `${liveFlight.origin || '?'}→${liveFlight.dest || '?'}`,
                      'airborne',
                    );
                    announce(
                      nowWatched ? `Watching ${watchIdent}` : `Stopped watching ${watchIdent}`,
                    );
                  }}
                >
                  <Eye aria-hidden="true" /> {watched ? 'Watching' : 'Watch'}
                </Button>
              ) : null}
              <Button variant="outline" size="lg" className="min-h-11 pointer-fine:md:min-h-0" asChild>
                <a href={planespottersUrl(reg)} target="_blank" rel="noopener noreferrer">
                  Planespotters ↗
                </a>
              </Button>
              <Button variant="outline" size="lg" className="min-h-11 pointer-fine:md:min-h-0" asChild>
                <a
                  href={`https://flightaware.com/resources/registration/${encodeURIComponent(reg)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  FlightAware ↗
                </a>
              </Button>
              <Button
                variant="outline"
                size="lg"
                className="min-h-11 pointer-fine:md:min-h-0"
                onClick={onShare}
              >
                <Share2 aria-hidden="true" /> Share
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
