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
 * `src/lib/geo.js`. Nothing about those rules is re-implemented here.
 */

import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

import { AIRPORTS, AIRPORT_COORDS, IATA_CITIES } from '@/lib/airports.js';
import { getPhase } from '@/lib/flight-phase.js';
import { greatCirclePoints, isLonghaul, normalizeLonContinuity } from '@/lib/geo.js';
import { planeIconSpec } from '@/lib/plane-icon.js';
import type { Flight } from '../data/types';
import { makeBasemapLayer, makeRadarLayer } from './basemap';

export type MapView = 'us' | 'pacific';

export const US_VIEW = { center: [39, -98] as [number, number], zoom: 4 };
export const PACIFIC_VIEW = { center: [25, 145] as [number, number], zoom: 4 };

type Airport = { iata: string; lat: number; lon: number; hub?: boolean };

const HUBS: Airport[] = (AIRPORTS as Airport[]).filter((a) => a.hub);

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
  view: MapView;
  /** IATA of the viewer's home hub — decides the initial centre and zoom. */
  homeAirport?: string;
  className?: string;
};

/** Leaflet's icon cache, keyed the same way `planeIconSpec` keys its spec. */
const iconCache = new Map<string, L.DivIcon>();

function planeIcon(
  flight: Flight,
  opts: { longhaul: boolean; phase: string; watched: boolean; starlink: boolean },
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

/** "UA123 ORD to DEN, cruising" — the marker's accessible name. */
function markerLabel(flight: Flight, phase: string): string {
  const ident = (flight.flightIATA || flight.callsign || 'Flight').trim();
  return `${ident} ${flight.origin || '?'} to ${flight.dest || '?'}, ${phase.toLowerCase()}`;
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
  view,
  homeAirport,
  className,
}: LiveMapProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const planeLayerRef = useRef<L.LayerGroup>(L.layerGroup());
  const hubLayerRef = useRef<L.LayerGroup>(L.layerGroup());
  const radarRef = useRef<L.TileLayer | null>(null);
  const routeRef = useRef<L.LayerGroup | null>(null);
  const markersRef = useRef(new Map<string, L.Marker>());
  const flightsRef = useRef(flights);
  flightsRef.current = flights;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  // ── Map lifecycle ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!hostRef.current || mapRef.current) return undefined;

    const home = homeAirport
      ? (AIRPORTS as Airport[]).find((a) => a.iata === homeAirport)
      : undefined;
    const map = L.map(hostRef.current, {
      center: home ? [home.lat, home.lon] : US_VIEW.center,
      zoom: home ? 5 : US_VIEW.zoom,
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
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(hostRef.current);

    return () => {
      observer.disconnect();
      map.remove();
      mapRef.current = null;
      markersRef.current.clear();
      routeRef.current = null;
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
    for (const hub of HUBS) {
      L.circleMarker([hub.lat, hub.lon], {
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
      L.circleMarker([hub.lat, hub.lon], {
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
      let lon = flight.lon;
      while (lon - centerLng > 180) lon -= 360;
      while (lon - centerLng < -180) lon += 360;

      const phase = (getPhase(flight.alt, flight.vr, flight.spd) as { phase: string }).phase;
      const ident = flight.flightIATA || flight.callsign || '';
      const watched = Boolean(ident) && watchedIdents.has(ident);
      const starlink = Boolean(flight.reg) && starlinkTails.has(flight.reg);
      const longhaul =
        layers.longhaul &&
        Boolean(isLonghaul(flight.origin, flight.dest, flight.callsign, AIRPORT_COORDS));
      const icon = planeIcon(flight, { longhaul, phase, watched, starlink });
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
        element.setAttribute('aria-label', markerLabel(flight, phase));
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
    }
    const flight = selectedId ? flights.find((f) => f.fr24id === selectedId) : null;
    if (!flight || !flight.origin || !flight.dest) return undefined;
    const origin = (AIRPORTS as Airport[]).find((a) => a.iata === flight.origin);
    const dest = (AIRPORTS as Airport[]).find((a) => a.iata === flight.dest);
    if (!origin || !dest) return undefined;

    const traveled = normalizeLonContinuity(
      greatCirclePoints(origin.lat, origin.lon, flight.lat, flight.lon, 60),
    ) as [number, number][];
    const remaining = normalizeLonContinuity(
      greatCirclePoints(flight.lat, flight.lon, dest.lat, dest.lon, 60),
    ) as [number, number][];

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

    return () => {
      map.removeLayer(group);
      if (routeRef.current === group) routeRef.current = null;
    };
  }, [selectedId, flights]);

  // ── Focus + US/Pacific view ───────────────────────────────────────────────
  useEffect(() => {
    if (focus && mapRef.current) {
      mapRef.current.flyTo([focus.lat, focus.lon], Math.max(mapRef.current.getZoom(), 6), {
        duration: 0.8,
      });
    }
  }, [focus]);

  const firstViewRender = useRef(true);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (firstViewRender.current) {
      firstViewRender.current = false;
      return;
    }
    const target = view === 'pacific' ? PACIFIC_VIEW : US_VIEW;
    map.flyTo(target.center, target.zoom, { duration: 1.2 });
  }, [view]);

  return (
    <div
      ref={hostRef}
      className={className}
      role="application"
      aria-label="Live map of United Airlines flights"
    />
  );
}
