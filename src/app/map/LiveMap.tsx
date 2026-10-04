/**
 * The Live Ops Leaflet map.
 *
 * Leaflet owns its own DOM, so this component holds the map in a ref and drives it through
 * effects rather than re-rendering it. Two details are load-bearing:
 *
 *  - Markers are DIFFED by `fr24id`. There are 600+ of them and a poll lands every 30 s;
 *    rebuilding the layer each time drops a click mid-gesture and churns the whole pane.
 *  - The wrapper is `isolate` (applied by the caller). Leaflet's panes sit at z-index 400+,
 *    which would paint straight over a shadcn Sheet or Dialog at z-50 — a new stacking
 *    context keeps the map's internal ladder from escaping into the page.
 *
 * Marker colours, sizes and the SVG come from `src/lib/plane-icon.js`; the phase, the
 * long-haul test and the great-circle maths come from `src/lib/flight-phase.js` and
 * `src/lib/geo.js`; the operating carrier from `src/lib/express-operators.js`; the region
 * presets from `src/lib/map-regions.js`. Nothing about those rules is re-implemented here.
 */

import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

import { AIRPORTS, AIRPORT_COORDS, IATA_CITIES } from '@/lib/airports.js';
import { resolveFlightRoute } from '../data/route';
import { centreForOcclusion, flightPanelOcclusion } from '@/lib/flight-panel-occlusion.js';
import { getPhase } from '@/lib/flight-phase.js';
import { operatorFromCallsign } from '@/lib/express-operators.js';
import { greatCirclePoints, isLonghaul, normalizeLonContinuity, wrapLonNear } from '@/lib/geo.js';
import { regionBounds } from '@/lib/map-regions.js';
import { prefersReducedMotion } from '@/lib/motion.js';
import { planeIconSpec } from '@/lib/plane-icon.js';
import type { Flight } from '../data/types';
import { makeBasemapLayer, makeRadarLayer } from './basemap';

/** The opening view when the viewer has no home hub. Region presets fly to bounds instead. */
export const US_VIEW = { center: [39, -98] as [number, number], zoom: 4 };

/**
 * A request to fly to a region preset. `key` changes on every pick, so choosing the region the
 * map was last sent to — after panning away from it — still recentres.
 */
export type RegionRequest = { id: string; key: number };

/**
 * A preset view's zoom for a map this wide. Zoom 4 spans the lower 48 in ~660px, so on a
 * phone it cropped SFO and LAX off the left edge (F78); one step out fits them.
 */
export function viewZoom(zoom: number, widthPx: number): number {
  return widthPx > 0 && widthPx < 640 ? zoom - 1 : zoom;
}

type Airport = { iata: string; lat: number; lon: number; hub?: boolean };

const HUBS: Airport[] = (AIRPORTS as Airport[]).filter((a) => a.hub);

export { prefersReducedMotion };

/**
 * Move the map, animated unless the visitor asked for reduced motion. The global CSS
 * reduced-motion rule cannot reach Leaflet's `flyTo`, which animates in JavaScript — a
 * 0.8–1.2 s zoom-and-pan sweep is exactly the vestibular trigger that setting exists for.
 */
export function flyOrJump(
  map: Pick<L.Map, 'flyTo' | 'setView'>,
  center: L.LatLngExpression,
  zoom: number,
  duration: number,
  reduce: boolean = prefersReducedMotion(),
): void {
  if (reduce) map.setView(center, zoom, { animate: false });
  else map.flyTo(center, zoom, { duration });
}

/**
 * Frame a region preset, animated unless the visitor asked for reduced motion — the bounds
 * counterpart of `flyOrJump`. `fitBounds` picks the zoom for the map's own size, so one box
 * serves a phone and a desktop.
 */
export function flyOrJumpToBounds(
  map: Pick<L.Map, 'flyToBounds' | 'fitBounds'>,
  bounds: L.LatLngBoundsExpression,
  duration: number,
  reduce: boolean = prefersReducedMotion(),
): void {
  if (reduce) map.fitBounds(bounds, { animate: false });
  else map.flyToBounds(bounds, { duration });
}

/**
 * The centre that puts `target` in the middle of the part of the map the flight panel leaves
 * visible (F20). The panel is open when an ancestor carries `data-flight-panel="open"` —
 * the same hook global.css uses to slide Leaflet's controls clear of it.
 */
export function panelAwareCentre(
  map: Pick<L.Map, 'getContainer' | 'project' | 'unproject'>,
  target: L.LatLngExpression,
  zoom: number,
): L.LatLngExpression {
  if (typeof window === 'undefined') return target;
  const container = map.getContainer();
  if (!container.closest('[data-flight-panel="open"]')) return target;
  const occlusion = flightPanelOcclusion(
    container.getBoundingClientRect(),
    { width: window.innerWidth, height: window.innerHeight },
    window.matchMedia?.('(min-width: 1024px)').matches ?? true,
  ) as { x: number; y: number };
  if (!occlusion.x && !occlusion.y) return target;
  const centre = centreForOcclusion(map.project(target, zoom), occlusion) as { x: number; y: number };
  return map.unproject(L.point(centre.x, centre.y), zoom);
}

export type LiveMapProps = {
  /** Every flight in the feed — the click handler resolves against the freshest row. */
  flights: Flight[];
  /** The subset the current filters allow on the map. */
  filtered: Flight[];
  selectedId: string | null;
  onSelect: (flight: Flight) => void;
  /** Registrations/idents drawn in the watched colour, at a raised z-index. */
  watchedIdents: Set<string>;
  starlinkTails: Set<string>;
  focus: { lat: number; lon: number; key: number } | null;
  layers: { hubs: boolean; wx: boolean; longhaul: boolean };
  /** The last region preset picked, or null until the viewer picks one. */
  regionRequest: RegionRequest | null;
  /** IATA of the viewer's home hub — decides the initial centre and zoom. */
  homeAirport?: string;
  className?: string;
};

/** Leaflet's icon cache, keyed the same way `planeIconSpec` keys its spec. */
const iconCache = new Map<string, L.DivIcon>();

function planeIcon(
  flight: Flight,
  opts: { longhaul: boolean; phase: string; watched: boolean; starlink: boolean; express: boolean },
): L.DivIcon {
  const { size, svg, key, hdgRounded } = planeIconSpec(flight.hdg, opts) as {
    size: number;
    svg: string;
    key: string;
    hdgRounded: number;
  };
  const cached = iconCache.get(key);
  if (cached) return cached;
  const icon = L.divIcon({
    html: `<div style="transform:rotate(${hdgRounded}deg);width:${size}px;height:${size}px">${svg}</div>`,
    className: 'bb-plane-marker',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
  iconCache.set(key, icon);
  return icon;
}

/**
 * "UA123 ORD to DEN, cruising" — the marker's accessible name. An Express flight also says who
 * flies it, so the white marker is never the only signal.
 */
function markerLabel(flight: Flight, phase: string, operator: { name: string; express: boolean } | null): string {
  const ident = (flight.flightIATA || flight.callsign || 'Flight').trim();
  const base = `${ident} ${flight.origin || '?'} to ${flight.dest || '?'}, ${phase.toLowerCase()}`;
  return operator?.express ? `${base}, United Express (${operator.name})` : base;
}

/** Shift a layer's coordinates by whole turns of longitude (markers, rings and polylines). */
function shiftLayerLon(layer: L.Layer, delta: number): void {
  if (!delta) return;
  if (layer instanceof L.Polyline) {
    const shifted = (layer.getLatLngs() as L.LatLng[]).map((p) => L.latLng(p.lat, p.lng + delta));
    layer.setLatLngs(shifted);
  } else if (layer instanceof L.Marker || layer instanceof L.CircleMarker) {
    const p = layer.getLatLng();
    layer.setLatLng([p.lat, p.lng + delta]);
  }
}

export function LiveMap({
  flights,
  filtered,
  selectedId,
  onSelect,
  watchedIdents,
  starlinkTails,
  focus,
  layers,
  regionRequest,
  homeAirport,
  className,
}: LiveMapProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  /** A move requested while the map had no size; applied on the next non-zero resize. */
  const pendingMoveRef = useRef<((map: L.Map) => void) | null>(null);

  function hasSize(map: L.Map): boolean {
    const size = map.getSize();
    return size.x > 0 && size.y > 0;
  }

  function runMove(map: L.Map, move: (map: L.Map) => void): void {
    try {
      move(map);
    } catch {
      // A projection failure must never take the dashboard down with it.
    }
  }

  function requestMove(move: (map: L.Map) => void): void {
    const map = mapRef.current;
    if (!map) return;
    map.invalidateSize();
    if (hasSize(map)) {
      pendingMoveRef.current = null;
      runMove(map, move);
    } else {
      pendingMoveRef.current = move;
    }
  }

  function flushPendingMove(): void {
    const map = mapRef.current;
    const move = pendingMoveRef.current;
    if (!map || !move || !hasSize(map)) return;
    pendingMoveRef.current = null;
    runMove(map, move);
  }
  const planeLayerRef = useRef<L.LayerGroup>(L.layerGroup());
  const hubLayerRef = useRef<L.LayerGroup>(L.layerGroup());
  const radarRef = useRef<L.TileLayer | null>(null);
  const routeRef = useRef<L.LayerGroup | null>(null);
  /** The selected aircraft's longitude in the route group's own coordinates. */
  const routeAnchorLngRef = useRef<number | null>(null);
  const markersRef = useRef(new Map<string, L.Marker>());
  const flightsRef = useRef(flights);
  flightsRef.current = flights;
  // The init effect runs once; reading through a ref assigned during render means it can
  // never centre on a home hub that had not resolved yet.
  const homeAirportRef = useRef(homeAirport);
  homeAirportRef.current = homeAirport;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  // ── Map lifecycle ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!hostRef.current || mapRef.current) return undefined;

    const home = homeAirportRef.current
      ? (AIRPORTS as Airport[]).find((a) => a.iata === homeAirportRef.current)
      : undefined;
    const map = L.map(hostRef.current, {
      center: home ? [home.lat, home.lon] : US_VIEW.center,
      zoom: home ? 5 : viewZoom(US_VIEW.zoom, hostRef.current.clientWidth),
      zoomControl: false,
      // A flight crossing the antimeridian has to stay reachable by panning either way.
      worldCopyJump: true,
    });
    // ODbL: the attribution control stays on. Only the "Leaflet" prefix is dropped — the
    // OpenStreetMap/CARTO credit comes from the tile layer's own `attribution`.
    map.attributionControl.setPrefix('');
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    makeBasemapLayer().addTo(map);
    hubLayerRef.current.addTo(map);
    planeLayerRef.current.addTo(map);
    mapRef.current = map;

    // The map shares its box with a sidebar that collapses at breakpoints and with a Sheet
    // on mobile; without this Leaflet keeps its stale pixel size and tiles stop halfway.
    // It is also how a move requested while the Live panel was hidden gets applied: the
    // panel re-showing is a resize from 0×0.
    const observer = new ResizeObserver(() => {
      map.invalidateSize();
      flushPendingMove();
    });
    observer.observe(hostRef.current);

    // Leaflet draws one copy of each layer, and everything is snapped to the world copy
    // nearest the centre. A region move (US → East Asia or across the date line) changes which
    // copy that is, so without this the aircraft east of ~82°E sat a world away until the next
    // 30 s poll, the West Coast hub rings vanished from the Pacific view and a SFO→SYD route
    // drew off-screen. Re-snap on every settled move; it is a no-op unless a copy changed.
    const resnap = () => {
      const centerLng = map.getCenter().lng;
      for (const marker of markersRef.current.values()) {
        const { lng } = marker.getLatLng();
        shiftLayerLon(marker, wrapLonNear(lng, centerLng) - lng);
      }
      hubLayerRef.current.eachLayer((layer) => {
        if (!(layer instanceof L.CircleMarker)) return;
        const { lng } = layer.getLatLng();
        shiftLayerLon(layer, wrapLonNear(lng, centerLng) - lng);
      });
      const anchor = routeAnchorLngRef.current;
      if (routeRef.current && anchor !== null) {
        const delta = wrapLonNear(anchor, centerLng) - anchor;
        if (delta) {
          routeRef.current.eachLayer((layer) => shiftLayerLon(layer, delta));
          routeAnchorLngRef.current = anchor + delta;
        }
      }
    };
    map.on('moveend', resnap);

    return () => {
      map.off('moveend', resnap);
      observer.disconnect();
      map.remove();
      mapRef.current = null;
      markersRef.current.clear();
      routeRef.current = null;
      routeAnchorLngRef.current = null;
      radarRef.current = null;
    };
    // Home hub only seeds the FIRST render; changing it later must not yank the viewport
    // out from under someone who has panned somewhere.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Hub rings ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const group = hubLayerRef.current;
    group.clearLayers();
    if (!layers.hubs) return;
    const centerLng = mapRef.current?.getCenter().lng ?? 0;
    for (const hub of HUBS) {
      const lon = wrapLonNear(hub.lon, centerLng);
      L.circleMarker([hub.lat, lon], {
        radius: 8,
        color: '#005DAA',
        fillColor: '#005DAA',
        fillOpacity: 0.3,
        weight: 2,
      })
        .bindTooltip(hub.iata, {
          permanent: true,
          direction: 'top',
          className: 'hub-tooltip',
          offset: [0, -10],
        })
        .addTo(group);
      L.circleMarker([hub.lat, lon], {
        radius: 8,
        color: '#005DAA',
        fillOpacity: 0,
        weight: 1,
        className: 'hub-pulse',
      }).addTo(group);
    }
  }, [layers.hubs]);

  // ── Plane markers, diffed by fr24id ───────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const group = planeLayerRef.current;
    const markers = markersRef.current;
    const seen = new Set<string>();
    const centerLng = map.getCenter().lng;

    for (const flight of filtered) {
      seen.add(flight.fr24id);
      // Snap each aircraft to the world copy nearest the current centre, so an IDL-crossing
      // flight (SFO→SYD) is never drawn a world away from the rest of the fleet.
      const lon = wrapLonNear(flight.lon, centerLng);

      const phase = (getPhase(flight.alt, flight.vr, flight.spd) as { phase: string }).phase;
      const ident = flight.flightIATA || flight.callsign || '';
      const watched = Boolean(ident) && watchedIdents.has(ident);
      const starlink = Boolean(flight.reg) && starlinkTails.has(flight.reg);
      const longhaul =
        layers.longhaul &&
        Boolean(isLonghaul(flight.origin, flight.dest, flight.callsign, AIRPORT_COORDS));
      // The callsign, not the feed's always-'UAL' airline field, names the operator.
      const operator = operatorFromCallsign(flight.callsign) as
        | { code: string; name: string; express: boolean }
        | null;
      const express = Boolean(operator?.express);
      const icon = planeIcon(flight, { longhaul, phase, watched, starlink, express });
      const zIndexOffset = watched ? 1000 : flight.fr24id === selectedId ? 900 : 0;

      const existing = markers.get(flight.fr24id);
      const marker =
        existing ??
        L.marker([flight.lat, lon], { icon, zIndexOffset, keyboard: false })
          .on('click', () => {
            const fresh =
              flightsRef.current.find((f) => f.fr24id === flight.fr24id) ?? flight;
            onSelectRef.current(fresh);
          })
          .addTo(group);
      if (existing) {
        existing.setLatLng([flight.lat, lon]);
        existing.setIcon(icon);
        existing.setZIndexOffset(zIndexOffset);
      } else {
        markers.set(flight.fr24id, marker);
      }
      // The icon object is shared across markers by the cache, so the accessible name has to
      // be written onto each marker's own element rather than baked into the icon HTML.
      const element = marker.getElement();
      if (element) {
        element.setAttribute('role', 'img');
        element.setAttribute('aria-label', markerLabel(flight, phase, operator));
      }
    }

    for (const [id, marker] of markers) {
      if (!seen.has(id)) {
        group.removeLayer(marker);
        markers.delete(id);
      }
    }
  }, [filtered, selectedId, watchedIdents, starlinkTails, layers.longhaul]);

  // ── NEXRAD overlay ────────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (layers.wx && !radarRef.current) {
      radarRef.current = makeRadarLayer().addTo(map);
    } else if (!layers.wx && radarRef.current) {
      map.removeLayer(radarRef.current);
      radarRef.current = null;
    }
  }, [layers.wx]);

  // ── Great-circle route for the selected flight ────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return undefined;
    if (routeRef.current) {
      map.removeLayer(routeRef.current);
      routeRef.current = null;
      routeAnchorLngRef.current = null;
    }
    const flight = selectedId ? flights.find((f) => f.fr24id === selectedId) : null;
    // Estimated routes draw too — the panel already names them, and a flight whose feed
    // origin/dest are blank is exactly the one a viewer most wants a line for.
    const { origin, dest } = resolveFlightRoute(flight ?? null);
    if (!flight || !origin || !dest) return undefined;

    const rawTraveled = normalizeLonContinuity(
      greatCirclePoints(origin.lat, origin.lon, flight.lat, flight.lon, 60),
    ) as [number, number][];
    // The line is continuous from the ORIGIN, so a transpacific route can land a world away
    // from the marker. Move the whole route by whole turns so the aircraft's own point sits on
    // the copy the map is looking at — where the marker was snapped.
    const planeLng = rawTraveled[rawTraveled.length - 1][1];
    const shift = wrapLonNear(planeLng, map.getCenter().lng) - planeLng;
    const traveled = rawTraveled.map(([lat, lon]) => [lat, lon + shift]) as [number, number][];
    // greatCirclePoints answers in [-180, 180], so the remaining leg is re-joined to the
    // traveled one at the aircraft rather than trusted to start on the same copy.
    const rawRemaining = normalizeLonContinuity(
      greatCirclePoints(flight.lat, flight.lon, dest.lat, dest.lon, 60),
    ) as [number, number][];
    const joinShift = wrapLonNear(rawRemaining[0][1], planeLng + shift) - rawRemaining[0][1];
    const remaining = rawRemaining.map(([lat, lon]) => [lat, lon + joinShift]) as [number, number][];

    const label = (airport: Airport) =>
      airport.iata + (IATA_CITIES[airport.iata] ? ` — ${IATA_CITIES[airport.iata]}` : '');

    const group = L.layerGroup([
      L.polyline(traveled, { color: '#005DAA', weight: 2.5, opacity: 0.8 }),
      L.polyline(remaining, { color: '#005DAA', weight: 1.5, dashArray: '6,4', opacity: 0.4 }),
      // Endpoint dots reuse the route's own normalised longitudes so they land on the same
      // world copy as the line.
      L.circleMarker([origin.lat, traveled[0][1]], {
        radius: 5,
        color: '#005DAA',
        fillColor: '#005DAA',
        fillOpacity: 0.7,
        weight: 1,
      }).bindTooltip(label(origin), { direction: 'top' }),
      L.circleMarker([dest.lat, remaining[remaining.length - 1][1]], {
        radius: 5,
        color: '#005DAA',
        fillColor: '#fff',
        fillOpacity: 0.9,
        weight: 2,
      }).bindTooltip(label(dest), { direction: 'top' }),
    ]).addTo(map);
    routeRef.current = group;
    routeAnchorLngRef.current = planeLng + shift;

    return () => {
      map.removeLayer(group);
      if (routeRef.current === group) {
        routeRef.current = null;
        routeAnchorLngRef.current = null;
      }
    };
  }, [selectedId, flights]);

  // ── Focus + region presets ────────────────────────────────────────────────
  // Every view-on-map action outside Live Ops (My Flights, Starlink "Track", the aircraft
  // dialog, the flight sheet, ⌘K) switches to Live and requests a move in the same commit —
  // while the Live panel is still `display:none` and Leaflet's cached size is 0×0. Animating
  // against a zero-size map projects to NaN and throws "Invalid LatLng object: (NaN, NaN)",
  // which used to unmount the whole dashboard. So: measure first, and if the map has no size
  // yet, hold the move until the ResizeObserver sees the panel again.
  useEffect(() => {
    if (focus) {
      requestMove((map) => {
        const zoom = Math.max(map.getZoom(), 6);
        flyOrJump(map, panelAwareCentre(map, [focus.lat, focus.lon], zoom), zoom, 0.8);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);

  // The opening view comes from the map constructor (home hub or US_VIEW), so nothing moves
  // until the viewer actually picks a region.
  useEffect(() => {
    if (!regionRequest) return;
    const bounds = L.latLngBounds(regionBounds(regionRequest.id) as L.LatLngTuple[]);
    requestMove((m) => flyOrJumpToBounds(m, bounds, 1.2));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regionRequest?.key]);

  return (
    <div
      ref={hostRef}
      className={className}
      role="application"
      aria-label="Live map of United Airlines flights"
    />
  );
}
