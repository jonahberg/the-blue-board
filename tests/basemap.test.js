import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { cartoBasemapUrl, CARTO_DARK_TILE_TEMPLATE } from '../src/lib/basemap.js';

// CARTO started requiring an API key on its raster basemaps (Sep 2026). Without `?key=` on the
// request every tile is served with a diagonal "API KEY REQUIRED" watermark. These pins make sure
// both Leaflet maps go through the one keyed template and that the key is wired in at build time.

const basemapModule = readFileSync(new URL('../src/app/map/basemap.ts', import.meta.url), 'utf8');
const liveMap = readFileSync(new URL('../src/app/map/LiveMap.tsx', import.meta.url), 'utf8');
const astroConfig = readFileSync(new URL('../astro.config.mjs', import.meta.url), 'utf8');
const envExample = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');

/** Comments describe the rules; only code counts as a call site. */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/[^\n]*/g, '$1');
}

describe('cartoBasemapUrl', () => {
  it('appends the key as a query parameter', () => {
    expect(cartoBasemapUrl('abc123')).toBe(`${CARTO_DARK_TILE_TEMPLATE}?key=abc123`);
  });

  it('keeps every Leaflet placeholder intact and puts the query after the extension', () => {
    const url = cartoBasemapUrl('abc123');
    for (const placeholder of ['{s}', '{z}', '{x}', '{y}', '{r}']) expect(url).toContain(placeholder);
    expect(url).toMatch(/\{r\}\.png\?key=abc123$/);
  });

  it('falls back to the bare template when the key is missing (watermarked, but the map still draws)', () => {
    expect(cartoBasemapUrl('')).toBe(CARTO_DARK_TILE_TEMPLATE);
    expect(cartoBasemapUrl(undefined)).toBe(CARTO_DARK_TILE_TEMPLATE);
    expect(cartoBasemapUrl(null)).toBe(CARTO_DARK_TILE_TEMPLATE);
    expect(cartoBasemapUrl('   ')).toBe(CARTO_DARK_TILE_TEMPLATE);
    expect(cartoBasemapUrl('')).not.toContain('?');
  });

  it('URL-encodes the key so a stray character cannot break the tile URL', () => {
    expect(cartoBasemapUrl('a b&c')).toBe(`${CARTO_DARK_TILE_TEMPLATE}?key=a%20b%26c`);
  });

  it('template is the CARTO dark raster basemap with subdomain + retina placeholders', () => {
    expect(CARTO_DARK_TILE_TEMPLATE).toBe('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png');
  });
});

describe('the dashboard builds every CARTO tile layer in one place', () => {
  const basemapCode = stripComments(basemapModule);

  it('no L.tileLayer call carries a bare basemaps.cartocdn.com literal', () => {
    // A hand-built layer would skip the key and render "API KEY REQUIRED" across the map.
    for (const [name, source] of [
      ['basemap.ts', basemapCode],
      ['LiveMap.tsx', stripComments(liveMap)],
    ]) {
      const bare = source.match(/L\.tileLayer\(\s*['"`]https?:\/\/[^'"`]*basemaps\.cartocdn\.com[^)]*/g) || [];
      expect(bare, name).toEqual([]);
    }
  });

  it('exactly one module constructs the keyed CARTO layer', () => {
    // Both Leaflet maps — Live Ops and the Weather tab's radar map — call
    // makeBasemapLayer(); centralising the construction is what makes the key impossible
    // to forget on a second map.
    const constructions = basemapCode.match(/L\.tileLayer\(CARTO_DARK_TILES/g) || [];
    expect(constructions).toHaveLength(1);
    expect(basemapCode).toMatch(/export function makeBasemapLayer\(\)/);
  });

  it('the live map gets its basemap from that factory rather than building its own', () => {
    expect(stripComments(liveMap)).toContain('makeBasemapLayer()');
  });

  it('the key is read from VITE_CARTO_BASEMAP_KEY at build time', () => {
    expect(basemapCode).toContain('cartoBasemapUrl(import.meta.env.VITE_CARTO_BASEMAP_KEY)');
  });

  it('Astro exposes the VITE_ prefix to client code, or that expression inlines as undefined', () => {
    // Astro defaults Vite's envPrefix to PUBLIC_ only. Without VITE_ in the list the key is
    // silently dropped at build: green build, watermarked map, and no source-level test
    // above would notice.
    const envPrefix = astroConfig.match(/envPrefix:\s*\[([^\]]*)\]/);
    expect(envPrefix, 'astro.config.mjs must declare envPrefix').toBeTruthy();
    expect(envPrefix[1]).toContain("'VITE_'");
  });

  it('.env.example documents VITE_CARTO_BASEMAP_KEY', () => {
    expect(envExample).toMatch(/^VITE_CARTO_BASEMAP_KEY=/m);
  });
});
