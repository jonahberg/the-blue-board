// @vitest-environment jsdom
/**
 * Retina tile density (audit F55/F59). On a DPR-2 desktop, `detectRetina: true` plus the
 * template's `{r}` requested a 512 px tile for every 128 CSS px — 63 tiles for the first US
 * view instead of ~20, and 3x the CARTO quota. The layer must request one `@2x` tile per
 * 256 CSS px at the map's own zoom.
 */
import { beforeAll, describe, expect, it } from 'vitest';

let mod: typeof import('../src/app/map/basemap');
let L: typeof import('leaflet').default;

beforeAll(async () => {
  // Leaflet reads the DPR once, at import: make this a retina desktop first.
  Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 2 });
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
  L = (await import('leaflet')).default;
  mod = await import('../src/app/map/basemap');
});

describe('basemap tile density', () => {
  it('never combines detectRetina with the {r} template', () => {
    expect(mod.CARTO_DARK_TILES).toContain('{r}');
    expect(mod.basemapTileOptions().detectRetina).toBe(false);
  });

  it('asks for the @2x tile at the map zoom, not zoom+1 at half size', () => {
    expect(L.Browser.retina).toBe(true);
    const host = document.createElement('div');
    Object.defineProperty(host, 'clientWidth', { value: 800 });
    Object.defineProperty(host, 'clientHeight', { value: 600 });
    document.body.append(host);
    const map = L.map(host, { center: [39, -97], zoom: 4 });
    const layer = mod.makeBasemapLayer().addTo(map);
    expect(layer.getTileSize().x).toBe(256);
    const url = layer.getTileUrl(Object.assign(L.point(3, 5), { z: 4 }) as L.Coords);
    expect(url).toMatch(/\/dark_all\/4\/3\/5@2x\.png/);
    map.remove();
  });

  it('uses the two subdomains the homepage preconnects to, on every viewport', async () => {
    expect(mod.basemapTileOptions().subdomains).toBe('ab');
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const index = readFileSync(resolve(__dirname, '../src/pages/index.astro'), 'utf8');
    for (const s of ['a', 'b']) {
      expect(index).toContain(`<link rel="preconnect" href="https://${s}.basemaps.cartocdn.com" />`);
    }
  });
});
