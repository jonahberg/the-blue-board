// @vitest-environment jsdom
/**
 * "View on map" / "Centre map" with the flight panel open used to centre the flight under the
 * panel (audit F20). panelAwareCentre shifts the centre so it lands in the uncovered part.
 */
import L from 'leaflet';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { panelAwareCentre, viewZoom } from '../src/app/map/LiveMap';

function stubWide(wide: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: wide && query === '(min-width: 1024px)',
    media: query,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
}

/** A map whose projection is the identity, inside a Live panel host with the given state. */
function fakeMap(panel: 'open' | undefined, rect: { left: number; top: number; right: number; bottom: number }) {
  const host = document.createElement('div');
  if (panel) host.setAttribute('data-flight-panel', panel);
  const container = document.createElement('div');
  host.appendChild(container);
  container.getBoundingClientRect = () => ({ ...rect, x: rect.left, y: rect.top, width: rect.right - rect.left, height: rect.bottom - rect.top, toJSON() {} }) as DOMRect;
  return {
    getContainer: () => container,
    project: (ll: L.LatLngExpression) => {
      const [lat, lon] = ll as [number, number];
      return L.point(lon, lat);
    },
    unproject: (p: L.Point) => L.latLng(p.y, p.x),
  };
}

afterEach(() => {
  // @ts-expect-error — jsdom has no matchMedia by default; restore that.
  delete window.matchMedia;
});

describe('panelAwareCentre', () => {
  it('leaves the target alone when no flight panel is open', () => {
    stubWide(true);
    const map = fakeMap(undefined, { left: 0, top: 0, right: 1120, bottom: 800 });
    expect(panelAwareCentre(map, [10, 20], 6)).toEqual([10, 20]);
  });

  it('≥lg: shifts the centre right by half the panel overlap', () => {
    stubWide(true);
    window.innerWidth = 1440;
    window.innerHeight = 800;
    const map = fakeMap('open', { left: 0, top: 0, right: 1120, bottom: 800 });
    // overlap = 1120 − (1440 − 448) = 128 → centre moves 64px towards the panel.
    const centre = panelAwareCentre(map, [10, 20], 6) as L.LatLng;
    expect(centre.lng).toBe(20 + 64);
    expect(centre.lat).toBe(10);
  });

  it('<lg: shifts the centre down by half the bottom sheet peek over the map', () => {
    stubWide(false);
    window.innerWidth = 390;
    window.innerHeight = 800;
    const map = fakeMap('open', { left: 0, top: 100, right: 390, bottom: 700 });
    // peek top = 800 × 0.6 = 480 → 220px covered → centre moves 110px down.
    const centre = panelAwareCentre(map, [10, 20], 6) as L.LatLng;
    expect(centre.lat).toBe(10 + 110);
    expect(centre.lng).toBe(20);
  });
});

describe('viewZoom (F78: the phone map cropped SFO and LAX)', () => {
  it('steps a preset out one zoom level below 640px, and leaves wider maps alone', () => {
    expect(viewZoom(4, 390)).toBe(3);
    expect(viewZoom(4, 639)).toBe(3);
    expect(viewZoom(4, 640)).toBe(4);
    expect(viewZoom(4, 1440)).toBe(4);
  });

  it('does not guess for a map that has no width yet', () => {
    expect(viewZoom(4, 0)).toBe(4);
  });
});
