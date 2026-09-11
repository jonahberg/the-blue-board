/**
 * The one place a CARTO tile layer is constructed.
 *
 * Both Leaflet maps in the app — the Live Ops map and the Weather tab's radar map — call
 * `makeBasemapLayer()`. That is deliberate: CARTO began requiring an API key on its raster
 * basemaps in Sep 2026, and a second hand-built `L.tileLayer(...)` anywhere would silently
 * render every tile with an "API KEY REQUIRED" watermark. `tests/basemap.test.js` pins both
 * the single construction site and the `import.meta.env` expression.
 *
 * The key itself is never committed: it is read from `VITE_CARTO_BASEMAP_KEY` (Vercel
 * Production env, documented in `.env.example`) and inlined at build. A missing key falls
 * back to the bare template — the map still draws, just watermarked.
 *
 * ODbL: `attribution` is carried on the tile layer, so Leaflet's attribution control picks
 * it up automatically. Never pass `attributionControl: false` to `L.map()` — suppressing the
 * OpenStreetMap/CARTO credit is a licence violation (pinned by `tests/compliance.test.js`).
 */

import L from 'leaflet';

import { cartoBasemapUrl } from '@/lib/basemap.js';

export const CARTO_DARK_TILES: string = cartoBasemapUrl(import.meta.env.VITE_CARTO_BASEMAP_KEY);

/** NEXRAD composite radar, Iowa Environmental Mesonet. */
export const NEXRAD_TILES =
  'https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913/{z}/{x}/{y}.png';

export const OSM_CARTO_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>'
  + ' contributors &copy; <a href="https://carto.com/attributions" target="_blank" rel="noopener noreferrer">CARTO</a>';

/** Phones fetch from two subdomains and skip retina tiles — bandwidth over sharpness. */
function smallScreenViewport(): boolean {
  return typeof window !== 'undefined' && window.innerWidth <= 768;
}

export function basemapTileOptions(): L.TileLayerOptions {
  const small = smallScreenViewport();
  return {
    maxZoom: 18,
    subdomains: small ? 'ab' : 'abcd',
    tileSize: 256,
    detectRetina: !small && typeof window !== 'undefined' && window.devicePixelRatio > 1,
    attribution: OSM_CARTO_ATTRIBUTION,
  };
}

/** The keyed CARTO dark basemap. Every map in the app gets its tiles from here. */
export function makeBasemapLayer(): L.TileLayer {
  return L.tileLayer(CARTO_DARK_TILES, basemapTileOptions());
}

/** The NEXRAD overlay, at the same 0.5 opacity the shipped dashboard used. */
export function makeRadarLayer(): L.TileLayer {
  return L.tileLayer(NEXRAD_TILES, {
    opacity: 0.5,
    attribution: 'NEXRAD via Iowa Environmental Mesonet',
  });
}
