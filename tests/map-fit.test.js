// The portrait map's opening framing (src/lib/map-fit.js): the lower 48 fitted to the width,
// north edge under the toolbar, spare height to the south (Nov 2026: "the first paint spends the
// top third on Canada").
import { describe, expect, it } from 'vitest';

import { northAnchoredView } from '../src/lib/map-fit.js';
import { getRegion } from '../src/lib/map-regions.js';

const US = getRegion('us').box;

/** EPSG:3857 pixel position of a point at a zoom (Leaflet's projection, 256 px tiles). */
function project([lat, lon], zoom) {
  const scale = 256 * 2 ** zoom;
  const phi = (lat * Math.PI) / 180;
  return {
    x: ((lon + 180) / 360) * scale,
    y: (0.5 - Math.log(Math.tan(Math.PI / 4 + phi / 2)) / (2 * Math.PI)) * scale,
  };
}

/** Where a point lands on a map of `size` showing `view`, in px from the map's top-left. */
function onMap(point, view, size) {
  const c = project(view.center, view.zoom);
  const p = project(point, view.zoom);
  return { x: p.x - c.x + size.x / 2, y: p.y - c.y + size.y / 2 };
}

describe('northAnchoredView', () => {
  for (const size of [
    { x: 375, y: 517 },
    { x: 393, y: 509 },
    { x: 393, y: 702 },
    { x: 430, y: 782 },
    { x: 820, y: 950 },
  ]) {
    it(`fits the lower 48 across a ${size.x}×${size.y} map with its north edge under the toolbar`, () => {
      const pad = { top: 52, bottom: 8, side: 4, snap: 0.1 };
      const view = northAnchoredView(US, size, pad);
      expect(view.anchored).toBe(true);
      // The zoom is a multiple of the snap, so Leaflet keeps it as given.
      expect(Math.abs(view.zoom * 10 - Math.round(view.zoom * 10))).toBeLessThan(1e-9);
      const nw = onMap([US.north, US.west], view, size);
      const se = onMap([US.south, US.east], view, size);
      // Every edge of the box is on the map, inside the side pad.
      expect(nw.x).toBeGreaterThanOrEqual(pad.side - 0.5);
      expect(se.x).toBeLessThanOrEqual(size.x - pad.side + 0.5);
      // The north edge sits exactly at the toolbar clearance; the south edge is above the bottom.
      expect(nw.y).toBeCloseTo(pad.top, 3);
      expect(se.y).toBeLessThan(size.y - pad.bottom);
      // And the snap is the only slack: one more step would overflow the width.
      const wider = northAnchoredView(US, size, { ...pad, snap: 0 });
      expect(wider.zoom - view.zoom).toBeLessThan(0.1 + 1e-9);
    });
  }

  it('centres a height-bound box in the space between the overlays (a landscape phone)', () => {
    const size = { x: 800, y: 240 };
    const pad = { top: 52, bottom: 8, side: 4, snap: 0.1 };
    const view = northAnchoredView(US, size, pad);
    expect(view.anchored).toBe(false);
    const nw = onMap([US.north, US.west], view, size);
    const se = onMap([US.south, US.east], view, size);
    expect(nw.y).toBeGreaterThanOrEqual(pad.top - 0.5);
    expect(se.y).toBeLessThanOrEqual(size.y - pad.bottom + 0.5);
    expect(nw.y - pad.top).toBeCloseTo(size.y - pad.bottom - se.y, 3);
  });

  it('answers null for a map with no size yet', () => {
    expect(northAnchoredView(US, { x: 0, y: 0 })).toBeNull();
    expect(northAnchoredView(US, { x: 390, y: 40 }, { top: 52 })).toBeNull();
  });
});
