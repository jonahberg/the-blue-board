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
import { decodeSquawk, getPhase } from '@/lib/flight-phase.js';
import { matchAircraft } from '@/lib/fleet-match.js';
import { getFlightPopupMetrics } from '@/lib/flight-popup.js';
import { estimateRoute } from '@/lib/route-estimate.js';
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
      else delta = { label: `${diffMin}m early`, tone: 'early' };
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
  const { fleetByReg, starlink, special } = useFleet();
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

  const route = useMemo(() => {
    if (!flight) return { origin: '', dest: '', estimated: false };
    if (flight.origin && flight.dest) {
      return { origin: flight.origin, dest: flight.dest, estimated: false };
    }
    const guess = estimateRoute(
      flight.lat,
      flight.lon,
      flight.hdg,
      flight.alt ? flight.alt * 3.28084 : null,
      flight.vr,
      flight.flightIATA || flight.callsign,
    ) as { origin: { iata: string } | null; dest: { iata: string } | null };
    return {
      origin: flight.origin || guess.origin?.iata || '',
      dest: flight.dest || guess.dest?.iata || '',
      estimated: true,
    };
  }, [flight]);

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
  const isStarlink = Boolean(reg) && starlink.tails.has(reg);
  const specialEntry = reg ? special.get(reg) : undefined;
  const watched = ident ? watch.isWatched(ident) : false;

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) select(null);
      }}
    >
      <SheetContent className="w-full overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-md">
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
            {route.origin || route.dest
              ? `${cityFor(route.origin) || route.origin || '?'} → ${cityFor(route.dest) || route.dest || '?'}`
              : 'Flight details'}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-5 px-4 pb-8">
          {squawk ? (
            <p className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm font-medium text-red-300">
              {squawk.text}
            </p>
          ) : null}

          <div className="rounded-lg border bg-card p-4">
            <div className="flex items-center justify-between">
              <div className="font-mono text-3xl font-semibold">{route.origin || '—'}</div>
              <span aria-hidden="true" className="text-muted-foreground">
                →
              </span>
              <div className="font-mono text-3xl font-semibold">{route.dest || '—'}</div>
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
                  className="h-7 text-xs"
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
                  {[aircraft.c, aircraft.w, aircraft.i].filter(Boolean).join(' · ') || '—'}
                </p>
                {aircraft.tot ? (
                  <p className="text-xs text-muted-foreground">{String(aircraft.tot)} seats</p>
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                {flight
                  ? `${flight.acType || 'Unknown type'}${flight.reg ? ` · ${flight.reg}` : ''} — not in the mainline fleet database; likely United Express.`
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
              variant={watched ? 'default' : 'outline'}
              onClick={() => {
                if (!ident) return;
                const nowWatched = watch.toggle(
                  ident,
                  `${route.origin}→${route.dest}`,
                  phase?.phase ?? '',
                );
                announce(nowWatched ? `Watching ${ident}` : `Stopped watching ${ident}`);
              }}
              aria-pressed={watched}
            >
              {watched ? '👁️ Watching' : '👁️ Watch'}
            </Button>
            <Button size="sm" variant="outline" onClick={() => void onShare()}>
              Share
            </Button>
          </div>

          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
            {ident ? (
              <a
                className="text-primary underline-offset-2 hover:underline"
                href={`https://flightaware.com/live/flight/UAL${ident.replace(/^UA/i, '')}`}
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
