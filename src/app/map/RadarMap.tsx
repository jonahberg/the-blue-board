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
import {
  NEUTRAL_MARKER_COLOR,
  RADAR_FIT_HUBS,
  RADAR_FIT_PADDING,
  WX_HUBS,
  radarLabelPlacement,
} from '@/lib/weather-cards.js';
import { escapeHtml } from '@/lib/escape.js';
import { makeBasemapLayer, NEXRAD_TILES } from './basemap';

/**
 * `[39,-97]` zoom 4 — the initial view and the widest the map will frame itself. On load and
 * on resize the map fits the seven mainland hubs instead (see `frameHubs`), so a phone-width
 * panel shows SFO through EWR rather than DEN/ORD/IAH alone.
 */
export const RADAR_VIEW = { center: [39, -97] as [number, number], zoom: 4 };

/**
 * 0.6, not the Live map's 0.5. The radar IS the subject here rather than an optional
 * overlay, so the reflectivity has to read against the dark basemap without the map
 * underneath competing with it.
 */
export const RADAR_OPACITY = 0.6;

type Airport = { iata: string; lat: number; lon: number };

/**
 * What one hub marker shows: its colour, the short text after the bold code in the
 * permanent label, and the longer reason shown on hover (the label's `title`).
 */
export type RadarHub = { hub: string; color: string; label: string; detail?: string };

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

function bindHubTooltip(marker: L.CircleMarker, hub: string, label: string, detail = '') {
  const { direction, offset } = radarLabelPlacement(hub) as {
    direction: L.Direction;
    offset: [number, number];
  };
  const text = label ? ` ${escapeHtml(label)}` : '';
  const title = detail ? ` title="${escapeHtml(detail)}"` : '';
  marker.unbindTooltip();
  marker.bindTooltip(`<span${title}><b>${hub}</b>${text}</span>`, {
    permanent: true,
    direction,
    className: 'hub-tooltip',
    offset,
  });
}

const FIT_BOUNDS = L.latLngBounds(
  (RADAR_FIT_HUBS as string[])
    .map((hub) => HUB_COORDS.get(hub))
    .filter((c): c is [number, number] => Boolean(c)),
);

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
      // Half-steps so a phone settles near 2.5–3 instead of jumping to a distant 2.
      zoomSnap: 0.5,
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
    //
    // Re-framing on resize stops once the viewer pans or zooms, so a resize never undoes it.
    let userMoved = false;
    let framing = false;
    map.on('movestart zoomstart', () => {
      if (!framing) userMoved = true;
    });
    const frameHubs = () => {
      framing = true;
      try {
        map.invalidateSize();
        const size = map.getSize();
        // Hidden tab: display:none reports 0×0 — nothing to fit into yet.
        if (userMoved || !FIT_BOUNDS.isValid() || !size.x || !size.y) return;
        map.fitBounds(FIT_BOUNDS, {
          paddingTopLeft: RADAR_FIT_PADDING.topLeft as [number, number],
          paddingBottomRight: RADAR_FIT_PADDING.bottomRight as [number, number],
          maxZoom: RADAR_VIEW.zoom,
          animate: false,
        });
      } finally {
        framing = false;
      }
    };
    const resize = window.setTimeout(frameHubs, 200);
    const observer = new ResizeObserver(frameHubs);
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
    for (const { hub, color, label, detail } of hubs) {
      const marker = markersRef.current.get(hub);
      if (!marker) continue;
      marker.setStyle({ color, fillColor: color });
      bindHubTooltip(marker, hub, label, detail);
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
