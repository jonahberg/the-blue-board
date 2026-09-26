/**
 * The Weather tab's NEXRAD radar — a second Leaflet instance, independent of the Live map.
 *
 * Separate instances rather than one shared map: the two answer different questions (where
 * is this aircraft vs where is the weather), sit on different tabs, and Leaflet cannot show
 * one container in two places. Everything they DO share goes through `makeBasemapLayer()`,
 * so the keyed CARTO basemap is still constructed in exactly one place (`tests/basemap.test.js`
 * pins that) and a second hand-built tile layer can never reintroduce the Sep 2026
 * "API KEY REQUIRED" watermark.
 *
 * Three details are load-bearing:
 *
 *  - The map is created ONCE and torn down on unmount. The retry button refreshes the store,
 *    it does not remount this component: `L.map()` on a container that still carries a
 *    previous instance throws "Map container is already initialized", which is exactly how
 *    the shipped weather-retry broke (Audit P1: weather-retry-double-map-init).
 *  - The nine hub markers are created once and RECOLOURED in place. Recreating them each
 *    cycle would drop a click mid-gesture and make the permanent tooltips flicker.
 *  - The wrapper is `isolate z-0` (applied by the caller). Leaflet's panes sit at z-index
 *    400+, which would paint straight over a shadcn Sheet or Dialog at z-50.
 */

import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

import { AIRPORTS } from '@/lib/airports.js';
import { NEUTRAL_MARKER_COLOR, WX_HUBS } from '@/lib/weather-cards.js';
import { makeBasemapLayer, NEXRAD_TILES } from './basemap';

/** `[39,-97]` zoom 4 — the shipped framing: the CONUS radar mosaic, edge to edge. */
export const RADAR_VIEW = { center: [39, -97] as [number, number], zoom: 4 };

/**
 * 0.6, not the Live map's 0.5. The radar IS the subject here rather than an optional
 * overlay, so the reflectivity has to read against the dark basemap without the map
 * underneath competing with it.
 */
export const RADAR_OPACITY = 0.6;

type Airport = { iata: string; lat: number; lon: number };

/** What one hub marker shows: its colour and the text after the bold code in the tooltip. */
export type RadarHub = { hub: string; color: string; label: string };

export type RadarMapProps = {
  hubs: RadarHub[];
  /** A marker click — the detail panel scrolls to that hub's card and flashes its border. */
  onSelectHub: (hub: string) => void;
  className?: string;
};

const HUB_COORDS = new Map(
  (AIRPORTS as Airport[])
    .filter((a) => (WX_HUBS as string[]).includes(a.iata))
    .map((a) => [a.iata, [a.lat, a.lon] as [number, number]]),
);

function bindHubTooltip(marker: L.CircleMarker, hub: string, label: string) {
  marker.unbindTooltip();
  marker.bindTooltip(`<b>${hub}</b>${label ? ` ${label}` : ''}`, {
    permanent: true,
    direction: 'top',
    className: 'hub-tooltip',
    offset: [0, -8],
  });
}

export function RadarMap({ hubs, onSelectHub, className }: RadarMapProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef(new Map<string, L.CircleMarker>());
  const onSelectRef = useRef(onSelectHub);
  onSelectRef.current = onSelectHub;

  // ── Map lifecycle ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!hostRef.current || mapRef.current) return undefined;

    const map = L.map(hostRef.current, {
      center: RADAR_VIEW.center,
      zoom: RADAR_VIEW.zoom,
      zoomControl: false,
    });
    // ODbL: the attribution control stays on. Only the "Leaflet" prefix is dropped — the
    // OpenStreetMap/CARTO credit comes from the tile layer's own `attribution`.
    map.attributionControl.setPrefix('');
    L.control.zoom({ position: 'bottomleft' }).addTo(map);
    makeBasemapLayer().addTo(map);
    L.tileLayer(NEXRAD_TILES, {
      opacity: RADAR_OPACITY,
      attribution: 'NEXRAD via Iowa Environmental Mesonet',
    }).addTo(map);
    mapRef.current = map;

    // Neutral markers immediately, before any METAR has landed: nine grey dots say "these
    // are the hubs, their weather is still loading", an empty map says nothing.
    for (const hub of WX_HUBS as string[]) {
      const coords = HUB_COORDS.get(hub);
      if (!coords) continue;
      const marker = L.circleMarker(coords, {
        radius: 8,
        color: NEUTRAL_MARKER_COLOR,
        fillColor: NEUTRAL_MARKER_COLOR,
        fillOpacity: 0.8,
        weight: 2,
      }).addTo(map);
      bindHubTooltip(marker, hub, '');
      marker.on('click', () => onSelectRef.current(hub));
      markersRef.current.set(hub, marker);
    }

    // The panel is display:none while another tab is showing and it shares its box with a
    // column that stacks at 1024 px; without both of these Leaflet keeps a stale pixel size
    // and the tiles stop halfway across.
    const resize = window.setTimeout(() => map.invalidateSize(), 200);
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(hostRef.current);

    return () => {
      window.clearTimeout(resize);
      observer.disconnect();
      map.remove();
      mapRef.current = null;
      markersRef.current.clear();
    };
  }, []);

  // ── Recolour in place ─────────────────────────────────────────────────────
  useEffect(() => {
    for (const { hub, color, label } of hubs) {
      const marker = markersRef.current.get(hub);
      if (!marker) continue;
      marker.setStyle({ color, fillColor: color });
      bindHubTooltip(marker, hub, label);
    }
  }, [hubs]);

  return (
    <div
      ref={hostRef}
      role="application"
      aria-label="NEXRAD weather radar map"
      className={className}
    />
  );
}

export default RadarMap;
