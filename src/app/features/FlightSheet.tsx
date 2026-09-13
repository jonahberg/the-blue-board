/**
 * The flight detail panel — the shadcn Sheet that replaces the old Leaflet popup.
 *
 * Moving out of the map's popup layer fixes three things the popup could not: it is a real
 * dialog (focus trap, Escape, an accessible name), it is not clipped by the map viewport,
 * and it survives a poll that moves or drops the marker underneath it.
 *
 * Behaviour carried over verbatim (inventory §18 "Flight popup", §16):
 *  - `?flight=<ident>` is written on open and removed on close, so the panel is shareable.
 *  - Route: FR24's own origin/dest when present, otherwise `estimateRoute()` with the
 *    "estimated route" note. An estimate is never presented as fact.
 *  - `/api/flight-times` is fetched per flight with precedence actual → estimated →
 *    scheduled, every time labelled with its airport's timezone.
 *  - Share falls back from the async clipboard to `execCommand` to `window.prompt`, because
 *    the first two are unavailable in exactly the mobile contexts that share most.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { cityFor } from '@/lib/airports.js';
import { normalizeWifi } from '@/lib/fleet-utils.js';
import { decodeSquawk, getPhase } from '@/lib/flight-phase.js';
import { matchAircraft } from '@/lib/fleet-match.js';
import { getFlightPopupMetrics } from '@/lib/flight-popup.js';
import { resolveFlightRoute } from '../data/route';
import { formatTimeWithTz } from '@/lib/time-format.js';
import { ApiError, fetchFlightTimes } from '../data/api';
import type { Flight, FlightTimes, TimeTriple } from '../data/types';
import { useFeed } from '../state/feed';
import { useFleet } from '../state/fleet';
import { useUi } from '../state/ui';
import { useWatch } from '../state/watch';

/** Write or clear `?flight=` without adding a history entry. */
function setFlightParam(ident: string | null) {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (ident) url.searchParams.set('flight', ident);
  else url.searchParams.delete('flight');
  window.history.replaceState(null, '', url);
}

/** Clipboard with the two fallbacks mobile browsers still need. */
async function shareUrl(url: string): Promise<'copied' | 'prompted'> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url);
      return 'copied';
    }
  } catch {
    /* fall through */
  }
  try {
    const input = document.createElement('textarea');
    input.value = url;
    input.setAttribute('readonly', '');
    input.style.position = 'fixed';
    input.style.opacity = '0';
    document.body.appendChild(input);
    input.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(input);
    if (ok) return 'copied';
  } catch {
    /* fall through */
  }
  window.prompt('Copy this link', url);
  return 'prompted';
}

/** actual → estimated → scheduled, with the delta against scheduled when it is material. */
function resolveTime(triple: TimeTriple | undefined, tz: string | null | undefined) {
  if (!triple) return null;
  const chosen = triple.actual ?? triple.estimated ?? triple.scheduled ?? null;
  if (!chosen) return null;
  const kind: 'Actual' | 'Est' | 'Sched' = triple.actual
    ? 'Actual'
    : triple.estimated
      ? 'Est'
      : 'Sched';
  const text = formatTimeWithTz(chosen, tz ?? undefined) as string | null;
  if (!text) return null;

  let delta: { label: string; tone: 'ok' | 'late' | 'early' } | null = null;
  let scheduledText: string | null = null;
  if (triple.scheduled && chosen !== triple.scheduled) {
    const diffMin = Math.round(
      (Date.parse(chosen) - Date.parse(triple.scheduled)) / 60000,
    );
    if (Number.isFinite(diffMin)) {
      if (Math.abs(diffMin) <= 5) delta = { label: 'On time', tone: 'ok' };
      else if (diffMin > 0) delta = { label: `+${diffMin}m`, tone: 'late' };
      // `${diffMin}m` already carries the minus sign; "-7m early" read as a double negative.
      else delta = { label: `${diffMin}m`, tone: 'early' };
      if (Math.abs(diffMin) > 5) {
        scheduledText = formatTimeWithTz(triple.scheduled, tz ?? undefined) as string | null;
      }
    }
  }
  return { kind, text, delta, scheduledText };
}

function TimeRow({
  label,
  triple,
  tz,
}: {
  label: string;
  triple: TimeTriple | undefined;
  tz: string | null | undefined;
}) {
  const resolved = resolveTime(triple, tz);
  if (!resolved) return null;
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
      <span className="w-28 shrink-0 text-muted-foreground">{label}</span>
      <span className="font-mono tabular-nums">{resolved.text}</span>
      <span className="text-[10px] uppercase text-muted-foreground">{resolved.kind}</span>
      {resolved.delta ? (
        <Badge
          variant="outline"
          className={
            resolved.delta.tone === 'late'
              ? 'border-amber-500/30 text-amber-400'
              : resolved.delta.tone === 'early'
                ? 'border-sky-500/30 text-sky-400'
                : 'border-emerald-500/30 text-emerald-400'
          }
        >
          {resolved.delta.label}
        </Badge>
      ) : null}
      {resolved.scheduledText ? (
        <span className="text-[11px] text-muted-foreground">Sched {resolved.scheduledText}</span>
      ) : null}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className="font-mono tabular-nums">{value}</dd>
    </div>
  );
}

export function FlightSheet() {
  const { selection, select, focusOn, openAircraft, announce } = useUi();
  const { flights } = useFeed();
  const { fleetByReg, starlink, special, loading: fleetLoading } = useFleet();
  const watch = useWatch();

  const open = selection !== null;

  /** The freshest row for the selected aircraft, so the panel tracks the poll. */
  const flight: Flight | null = useMemo(() => {
    if (!selection) return null;
    if (selection.kind === 'flight') {
      return flights.find((f) => f.fr24id === selection.flight.fr24id) ?? selection.flight;
    }
    return (
      flights.find(
        (f) => f.flightIATA === selection.ident || f.callsign === selection.ident,
      ) ?? null
    );
  }, [selection, flights]);

  const ident =
    selection?.kind === 'ident'
      ? selection.ident
      : flight
        ? flight.flightIATA || flight.callsign
        : null;

  const [times, setTimes] = useState<{
    data: FlightTimes | null;
    error: string | null;
    loading: boolean;
  }>({ data: null, error: null, loading: false });

  // `?flight=` mirrors the open panel — but only ever CLEARS the param on a real close.
  // Clearing it on mount would wipe the incoming deep link before the feed has answered and
  // `useDeepLinks` has had a chance to resolve it, so `/?flight=UA188` would silently do
  // nothing on a cold load.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && ident) setFlightParam(ident);
    else if (wasOpen.current) setFlightParam(null);
    wasOpen.current = open;
  }, [open, ident]);

  useEffect(() => {
    if (!open || !ident) {
      setTimes({ data: null, error: null, loading: false });
      return undefined;
    }
    const controller = new AbortController();
    setTimes({ data: null, error: null, loading: true });
    fetchFlightTimes(ident, controller.signal).then(
      (data) =>
        setTimes({
          data: data.success ? data : null,
          error: data.success ? null : (data.error ?? 'No schedule data for this flight today.'),
          loading: false,
        }),
      (err: unknown) => {
        if (controller.signal.aborted) return;
        setTimes({
          data: null,
          error:
            err instanceof ApiError && err.status === 404
              ? 'No schedule data for this flight today.'
              : err instanceof Error
                ? err.message
                : String(err),
          loading: false,
        });
      },
    );
    return () => controller.abort();
  }, [open, ident]);

  // Resolved once in src/app/data/route.ts so the map draws exactly the route this panel
  // names — including an estimated one.
  const route = useMemo(() => resolveFlightRoute(flight), [flight]);

  const aircraft = useMemo(
    () => (flight ? (matchAircraft(flight, fleetByReg) as Record<string, unknown> | null) : null),
    [flight, fleetByReg],
  );

  const onShare = useCallback(async () => {
    if (!ident) return;
    const url = new URL(window.location.href);
    url.hash = '';
    url.searchParams.set('flight', ident);
    const result = await shareUrl(url.toString());
    announce(result === 'copied' ? `Link to ${ident} copied` : `Link to ${ident} ready to copy`);
  }, [ident, announce]);

  const phase = flight
    ? (getPhase(flight.alt, flight.vr, flight.spd) as { phase: string; icon: string })
    : null;
  const squawk = flight
    ? (decodeSquawk(flight.squawk) as { text: string; cls: string } | null)
    : null;
  const metrics = flight
    ? (getFlightPopupMetrics(flight) as { altFt: number | null; altPct: number; speedText: string })
    : null;
  const reg = (aircraft?.r as string | undefined) ?? flight?.reg ?? '';
  /** Per-cabin blocks, in the database's own order (NJ / NPP / NE+ / NY etc). */
  const seats = Object.entries(
    (aircraft?.seats as Record<string, number> | undefined) ?? {},
  ).filter(([, count]) => Number(count) > 0);
  const isStarlink = Boolean(reg) && starlink.tails.has(reg);
  const specialEntry = reg ? special.get(reg) : undefined;
  const watched = ident ? watch.isWatched(ident) : false;

  return (
    <Sheet
      open={open}
      modal={false}
      onOpenChange={(next) => {
        if (!next) select(null);
      }}
    >
      {/*
        Non-modal, with no overlay and no close-on-outside-interaction. This panel sits
        BESIDE the live map rather than over it: a modal Radix dialog dims the map, makes it
        inert to pan, zoom and marker clicks, and closes itself on the first map click — so
        "Centre map" would fly a map the viewer could not see or touch. Escape and the ✕ still
        close it, and clicking another aircraft swaps the panel's subject instead.
      */}
      <SheetContent
        showOverlay={false}
        onPointerDownOutside={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
        className="w-full overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-md"
      >
        <SheetHeader>
          <div className="flex flex-wrap items-center gap-2">
            <SheetTitle className="font-mono text-xl">{ident ?? 'Flight'}</SheetTitle>
            {phase ? (
              <Badge variant="secondary">
                <span aria-hidden="true">{phase.icon}</span> {phase.phase}
              </Badge>
            ) : (
              <Badge variant="outline">Not in the live feed</Badge>
            )}
            {times.data?.cancelled ? <Badge variant="destructive">Cancelled</Badge> : null}
            {times.data?.diverted ? <Badge variant="destructive">Diverted</Badge> : null}
          </div>
          <SheetDescription>
            {route.originIata || route.destIata
              ? `${cityFor(route.originIata) || route.originIata || '?'} → ${cityFor(route.destIata) || route.destIata || '?'}`
              : 'Flight details'}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-5 px-4 pb-8">
          {/* Only the three emergency codes get the red banner. decodeSquawk() also decodes
              1200 (VFR) with an empty class, which is routine — the Ticker filters on the
              same `squawk-alert` class for the same reason. */}
          {squawk && squawk.cls === 'squawk-alert' ? (
            <p className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm font-medium text-red-300">
              {squawk.text}
            </p>
          ) : null}

          <div className="rounded-lg border bg-card p-4">
            <div className="flex items-center justify-between">
              <div className="font-mono text-3xl font-semibold">{route.originIata || '—'}</div>
              <span aria-hidden="true" className="text-muted-foreground">
                →
              </span>
              <div className="font-mono text-3xl font-semibold">{route.destIata || '—'}</div>
            </div>
            {route.estimated ? (
              <p className="mt-2 text-[11px] text-muted-foreground">
                Route estimated from position and heading — not reported by the feed.
              </p>
            ) : null}
          </div>

          {flight && metrics ? (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Live position
                </h3>
                <Button
                  size="sm"
                  variant="ghost"
                  className="min-h-11 text-xs md:h-7 md:min-h-0"
                  onClick={() => focusOn(flight.lat, flight.lon)}
                >
                  Centre map
                </Button>
              </div>
              <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <Metric
                  label="Altitude"
                  value={metrics.altFt ? `${metrics.altFt.toLocaleString()} ft` : 'N/A'}
                />
                <Metric label="Speed" value={metrics.speedText} />
                <Metric label="Heading" value={`${Math.round(flight.hdg || 0)}°`} />
                <Metric
                  label="V/S"
                  value={
                    flight.vr ? `${Math.round(flight.vr * 196.85).toLocaleString()} fpm` : '—'
                  }
                />
              </dl>
              <div
                className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted"
                aria-hidden="true"
              >
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${metrics.altPct}%` }}
                />
              </div>
            </div>
          ) : null}

          <Separator />

          <div>
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Aircraft
            </h3>
            {aircraft ? (
              <div className="space-y-1.5 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{String(aircraft.t ?? '')}</span>
                  <Button
                    variant="link"
                    className="h-auto p-0 font-mono text-sm"
                    onClick={() => openAircraft(reg)}
                  >
                    {reg}
                  </Button>
                  {isStarlink ? (
                    <Badge className="border-violet-500/30 bg-violet-500/10 text-violet-300">
                      ⚡ Starlink confirmed
                    </Badge>
                  ) : null}
                  {specialEntry ? <Badge variant="outline">⭐ {specialEntry.name}</Badge> : null}
                </div>
                <p className="text-xs text-muted-foreground">
                  {/* normalizeWifi turns the database's raw codes ("Satl Ku") into the
                      names the rest of the site shows ("Satellite Ku"). */}
                  {[aircraft.c, normalizeWifi(aircraft.w), aircraft.i].filter(Boolean).join(' · ') ||
                    '—'}
                </p>
                {seats.length > 0 ? (
                  <p className="flex flex-wrap items-center gap-1 text-xs">
                    {seats.map(([cabin, count]) => (
                      <span
                        key={cabin}
                        className="rounded border px-1.5 py-0.5 font-mono tabular-nums"
                      >
                        {count}
                        {cabin}
                      </span>
                    ))}
                    {aircraft.tot ? (
                      <span className="text-muted-foreground">({String(aircraft.tot)} total)</span>
                    ) : null}
                  </p>
                ) : aircraft.tot ? (
                  <p className="text-xs text-muted-foreground">{String(aircraft.tot)} seats</p>
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                {/* "Loading" and "not in the database" are different facts. Asserting the
                    second while the fleet is still downloading tells a mainline passenger
                    their aircraft is a United Express jet. */}
                {flight
                  ? `${flight.acType || 'Unknown type'}${flight.reg ? ` · ${flight.reg}` : ''} (${
                      fleetLoading
                        ? 'Loading aircraft data…'
                        : 'not in mainline fleet DB — likely United Express'
                    })`
                  : 'No aircraft reported.'}
              </p>
            )}
          </div>

          <Separator />

          <div>
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Times
            </h3>
            {times.loading ? (
              <div className="space-y-2">
                <Skeleton className="h-5" />
                <Skeleton className="h-5" />
                <Skeleton className="h-5" />
              </div>
            ) : times.data ? (
              <div className="space-y-1.5">
                <TimeRow
                  label="Gate departure"
                  triple={times.data.departure?.gate}
                  tz={times.data.origin?.tz}
                />
                <TimeRow
                  label="Takeoff"
                  triple={times.data.departure?.takeoff}
                  tz={times.data.origin?.tz}
                />
                <TimeRow
                  label="Landing"
                  triple={times.data.arrival?.landing}
                  tz={times.data.destination?.tz}
                />
                <TimeRow
                  label="Gate arrival"
                  triple={times.data.arrival?.gate}
                  tz={times.data.destination?.tz}
                />
                <p className="pt-1 text-[11px] text-muted-foreground">
                  Source: {times.data.source ?? 'AeroDataBox'}. united.com and the airport display
                  remain the systems of record.
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                {times.error ?? 'No schedule data for this flight today.'}
              </p>
            )}
          </div>

          <Separator />

          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              className="min-h-11 md:min-h-9"
              variant={watched ? 'default' : 'outline'}
              onClick={() => {
                if (!ident) return;
                const nowWatched = watch.toggle(
                  ident,
                  `${route.originIata}→${route.destIata}`,
                  phase?.phase ?? '',
                );
                announce(nowWatched ? `Watching ${ident}` : `Stopped watching ${ident}`);
              }}
              aria-pressed={watched}
            >
              {watched ? '👁️ Watching' : '👁️ Watch'}
            </Button>
            <Button size="sm" variant="outline" className="min-h-11 md:min-h-9" onClick={() => void onShare()}>
              Share
            </Button>
          </div>

          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
            {ident ? (
              <a
                className="text-primary underline-offset-2 hover:underline"
                // `ident` can be an IATA number (UA123) or a callsign (UAL123); strip either
                // prefix before re-adding UAL, or a callsign becomes UALL123.
                href={`https://flightaware.com/live/flight/UAL${ident.replace(/^UAL?/i, '')}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                FlightAware
              </a>
            ) : null}
            {reg ? (
              <a
                className="text-primary underline-offset-2 hover:underline"
                href={`https://www.planespotters.net/search?q=${encodeURIComponent(reg)}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                Planespotters
              </a>
            ) : null}
            {flight?.icao24 ? (
              <a
                className="text-primary underline-offset-2 hover:underline"
                href={`https://globe.adsbexchange.com/?icao=${encodeURIComponent(flight.icao24)}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                ADS-B Exchange
              </a>
            ) : null}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
