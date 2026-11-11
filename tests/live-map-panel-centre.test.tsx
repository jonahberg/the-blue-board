// @vitest-environment jsdom
/**
 * "View on map" / "Centre map" with the flight panel open used to centre the flight under the
 * panel (audit F20). panelAwareCentre shifts the centre so it lands in the uncovered part.
 */
import L from 'leaflet';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PORTRAIT_ZOOM_SNAP, US_VIEW, panelAwareCentre, portraitUsView, viewZoom } from '../src/app/map/LiveMap';

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

describe('portraitUsView (Nov 2026: the phone map opened with its top third on Canada)', () => {
  it('opens a phone or upright-tablet map on the lower 48, north-anchored, at a snapped zoom', () => {
    for (const size of [{ x: 393, y: 509 }, { x: 375, y: 517 }, { x: 820, y: 950 }]) {
      const view = portraitUsView(size)!;
      expect(view).not.toBeNull();
      // North-anchored: the centre sits south of the box's own middle (~38°N) and of US_VIEW.
      expect(view.center[0]).toBeLessThan(US_VIEW.center[0]);
      expect(view.center[1]).toBeCloseTo(-95.75, 5);
      expect(Math.abs(view.zoom / PORTRAIT_ZOOM_SNAP - Math.round(view.zoom / PORTRAIT_ZOOM_SNAP))).toBeLessThan(1e-6);
      // Tighter than the old whole-level phone view (zoom 3) on a phone.
      if (size.x < 640) expect(view.zoom).toBeGreaterThan(3);
    }
  });

  it('leaves a landscape desktop map, and a map with no size, on the old view', () => {
    expect(portraitUsView({ x: 1120, y: 660 })).toBeNull();
    expect(portraitUsView({ x: 0, y: 0 })).toBeNull();
  });
});
