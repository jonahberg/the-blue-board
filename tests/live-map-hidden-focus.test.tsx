// @vitest-environment jsdom
/**
 * Production crash after the v1.8.0 rebuild (Sep 26 2026): every "View on map" / "Track" /
 * "Centre map" action fired from a tab other than Live Ops blanked the whole dashboard.
 *
 * The Live panel is `forceMount` + `display:none` while another tab is open, so Leaflet's cached
 * container size is 0×0. The focus effect called `map.flyTo()` in the same commit that switched
 * the tab back, before the ResizeObserver saw the panel again — Leaflet projected against a
 * zero-size map and threw "Invalid LatLng object: (NaN, NaN)" inside a React effect, and with no
 * error boundary the whole island unmounted. jsdom gives every element a 0×0 box, which is
 * exactly the hidden-panel condition.
 *
 * Contract: a focus/view request while the map has no size must NOT throw; it is held and
 * applied as soon as the map has a size again. The move itself is observed through a
 * `flyTo` spy — every move is wrapped in try/catch, so "nothing threw" alone would stay green
 * if the held move were silently dropped.
 */

import { cleanup, render } from '@testing-library/react';
import L from 'leaflet';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LiveMap } from '../src/app/map/LiveMap';
import { regionBounds } from '../src/lib/map-regions.js';
import type { LiveMapProps } from '../src/app/map/LiveMap';

let resizeCallbacks: Array<() => void> = [];
let hostSize = { w: 0, h: 0 };
let uncaught: string[] = [];
const onError = (event: ErrorEvent) => {
  uncaught.push(String(event.error?.message ?? event.message));
  event.preventDefault();
};

beforeEach(() => {
  resizeCallbacks = [];
  hostSize = { w: 0, h: 0 };
  uncaught = [];
  window.addEventListener('error', onError);
  // jsdom reports no CSS 3D support, so Leaflet's flyTo would silently fall back to setView.
  // Real browsers take the animated path — the one that projects against the cached size.
  (L.Browser as { any3d: boolean }).any3d = true;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      cb: () => void;
      constructor(cb: () => void) {
        this.cb = cb;
        resizeCallbacks.push(cb);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  // Leaflet reads the container size from clientWidth/clientHeight.
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get() {
      return hostSize.w;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get() {
      return hostSize.h;
    },
  });
});

afterEach(() => {
  window.removeEventListener('error', onError);
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function fireResize() {
  resizeCallbacks.forEach((cb) => cb());
}

function props(overrides: Partial<LiveMapProps> = {}): LiveMapProps {
  return {
    flights: [],
    filtered: [],
    selectedId: null,
    onSelect: () => {},
    watchedIdents: new Set(),
    starlinkTails: new Set(),
    focus: null,
    layers: { hubs: false, wx: false, longhaul: false },
    regionRequest: null,
    ...overrides,
  } as LiveMapProps;
}

describe('LiveMap focus while the Live panel is hidden', () => {
  it('does not throw when focus arrives while the map has no size, and applies it once visible', () => {
    // Map mounted while visible, then the panel is hidden (another tab opened).
    hostSize = { w: 800, h: 600 };
    const { rerender, container } = render(<LiveMap {...props()} />);
    hostSize = { w: 0, h: 0 };
    fireResize();
    const fly = vi.spyOn(L.Map.prototype, 'flyTo');

    const focus = { lat: 41.9786, lon: -87.9048, key: 1 };
    rerender(<LiveMap {...props({ focus })} />);
    expect(uncaught).toEqual([]);
    expect(container.querySelector('.leaflet-container')).not.toBeNull();
    // Held, not attempted against the 0×0 map.
    expect(fly).not.toHaveBeenCalled();

    // The panel is shown again: the ResizeObserver fires with a real size and the held
    // focus is applied then — exactly once, at the requested point.
    hostSize = { w: 800, h: 600 };
    fireResize();
    expect(uncaught).toEqual([]);
    expect(fly).toHaveBeenCalledTimes(1);
    const target = L.latLng(fly.mock.calls[0][0] as L.LatLngExpression);
    expect(target.lat).toBeCloseTo(41.9786, 4);
    expect(target.lng).toBeCloseTo(-87.9048, 4);
    expect(fly.mock.calls[0][1]).toBeGreaterThanOrEqual(6);

    // The pending move is cleared: a later resize does not replay it.
    fireResize();
    expect(fly).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.leaflet-container')).not.toBeNull();
  });

  it('applies a focus immediately when the map is already visible', () => {
    hostSize = { w: 800, h: 600 };
    const { rerender } = render(<LiveMap {...props()} />);
    const fly = vi.spyOn(L.Map.prototype, 'flyTo');
    rerender(<LiveMap {...props({ focus: { lat: 37.6213, lon: -122.379, key: 2 } })} />);
    expect(fly).toHaveBeenCalledTimes(1);
    expect(L.latLng(fly.mock.calls[0][0] as L.LatLngExpression).lat).toBeCloseTo(37.6213, 4);
  });

  it('does not throw when a region preset is picked while hidden, and flies there once visible', () => {
    hostSize = { w: 800, h: 600 };
    const { rerender } = render(<LiveMap {...props()} />);
    hostSize = { w: 0, h: 0 };
    fireResize();
    const fly = vi.spyOn(L.Map.prototype, 'flyTo');
    rerender(<LiveMap {...props({ regionRequest: { id: 'pacific', key: 1 } })} />);
    expect(fly).not.toHaveBeenCalled();

    hostSize = { w: 800, h: 600 };
    fireResize();
    expect(uncaught).toEqual([]);
    // flyToBounds resolves to one flyTo at the box's centre and fitted zoom.
    expect(fly).toHaveBeenCalledTimes(1);
    const target = L.latLng(fly.mock.calls[0][0] as L.LatLngExpression);
    const [[south, west], [north, east]] = regionBounds('pacific');
    expect(target.lat).toBeGreaterThan(south);
    expect(target.lat).toBeLessThan(north);
    // The Pacific box crosses the antimeridian: its centre is past 180°, not back over Africa.
    expect(target.lng).toBeGreaterThan(180);
    expect(target.lng).toBeGreaterThan(west);
    expect(target.lng).toBeLessThan(east);
    expect(Number.isFinite(fly.mock.calls[0][1] as number)).toBe(true);
  });

  it('does not move the map on mount, before any region is picked', () => {
    hostSize = { w: 800, h: 600 };
    const fly = vi.spyOn(L.Map.prototype, 'flyTo');
    render(<LiveMap {...props()} />);
    expect(fly).not.toHaveBeenCalled();
  });

  it('flies again when the same region is picked twice (recentre after panning away)', () => {
    hostSize = { w: 800, h: 600 };
    const { rerender } = render(<LiveMap {...props()} />);
    const fly = vi.spyOn(L.Map.prototype, 'flyTo');
    rerender(<LiveMap {...props({ regionRequest: { id: 'europe', key: 1 } })} />);
    rerender(<LiveMap {...props({ regionRequest: { id: 'europe', key: 2 } })} />);
    expect(fly).toHaveBeenCalledTimes(2);
    // A re-render with the same request is not a new pick.
    rerender(<LiveMap {...props({ regionRequest: { id: 'europe', key: 2 } })} />);
    expect(fly).toHaveBeenCalledTimes(2);
  });

  it('survives an unknown or legacy region id (edge case)', () => {
    hostSize = { w: 800, h: 600 };
    const { rerender } = render(<LiveMap {...props()} />);
    const fly = vi.spyOn(L.Map.prototype, 'flyTo');
    rerender(<LiveMap {...props({ regionRequest: { id: 'atlantis', key: 1 } })} />);
    expect(uncaught).toEqual([]);
    expect(fly).toHaveBeenCalledTimes(1);
    const [[south, west], [north, east]] = regionBounds('us');
    const target = L.latLng(fly.mock.calls[0][0] as L.LatLngExpression);
    expect(target.lat).toBeGreaterThan(south);
    expect(target.lat).toBeLessThan(north);
    expect(target.lng).toBeGreaterThan(west);
    expect(target.lng).toBeLessThan(east);
  });
});
