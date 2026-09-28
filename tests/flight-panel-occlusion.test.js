import { describe, expect, it } from 'vitest';
import {
  FLIGHT_PANEL_PEEK,
  FLIGHT_PANEL_WIDTH_PX,
  centreForOcclusion,
  flightPanelOcclusion,
} from '../src/lib/flight-panel-occlusion.js';

describe('flightPanelOcclusion (audit F20)', () => {
  it('≥lg: only the part of the 448px right panel that overlaps the map counts', () => {
    // 1440 wide, map from 0 to 1120 (the 320px Live sidebar sits to its right).
    const map = { left: 0, top: 80, right: 1120, bottom: 900 };
    expect(flightPanelOcclusion(map, { width: 1440, height: 900 }, true)).toEqual({
      x: 1120 - (1440 - FLIGHT_PANEL_WIDTH_PX),
      y: 0,
    });
  });

  it('≥lg: a map that ends left of the panel is not covered at all', () => {
    const map = { left: 0, top: 0, right: 900, bottom: 800 };
    expect(flightPanelOcclusion(map, { width: 1440, height: 800 }, true)).toEqual({ x: 0, y: 0 });
  });

  it('<lg: the bottom sheet covers the map up to its 40dvh peek', () => {
    const map = { left: 0, top: 100, right: 390, bottom: 780 };
    const covered = 780 - 844 * (1 - FLIGHT_PANEL_PEEK);
    expect(flightPanelOcclusion(map, { width: 390, height: 844 }, false)).toEqual({ x: 0, y: covered });
  });

  it('gives up rather than centring in nothing when the panel covers the whole map', () => {
    const map = { left: 1000, top: 0, right: 1400, bottom: 800 };
    expect(flightPanelOcclusion(map, { width: 1440, height: 800 }, true)).toEqual({ x: 0, y: 0 });
  });

  it('is a no-op for a map with no size yet', () => {
    expect(flightPanelOcclusion({ left: 0, top: 0, right: 0, bottom: 0 }, { width: 800, height: 600 }, true)).toEqual({ x: 0, y: 0 });
  });
});

describe('centreForOcclusion', () => {
  it('moves the centre half the covered span towards the panel, so the target sits mid-visible', () => {
    expect(centreForOcclusion({ x: 500, y: 300 }, { x: 128, y: 0 })).toEqual({ x: 564, y: 300 });
    expect(centreForOcclusion({ x: 500, y: 300 }, { x: 0, y: 200 })).toEqual({ x: 500, y: 400 });
  });
});
