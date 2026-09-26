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
 * applied as soon as the map has a size again.
 */

import { cleanup, render } from '@testing-library/react';
import L from 'leaflet';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LiveMap } from '../src/app/map/LiveMap';
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
});

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
    view: 'us',
    ...overrides,
  } as LiveMapProps;
}

describe('LiveMap focus while the Live panel is hidden', () => {
  it('does not throw when focus arrives while the map has no size, and applies it once visible', () => {
    // Map mounted while visible, then the panel is hidden (another tab opened).
    hostSize = { w: 800, h: 600 };
    const { rerender, container } = render(<LiveMap {...props()} />);
    hostSize = { w: 0, h: 0 };
    resizeCallbacks.forEach((cb) => cb());

    const focus = { lat: 41.9786, lon: -87.9048, key: 1 };
    rerender(<LiveMap {...props({ focus })} />);
    expect(uncaught).toEqual([]);
    expect(container.querySelector('.leaflet-container')).not.toBeNull();

    // The panel is shown again: the ResizeObserver fires with a real size and the held
    // focus is applied then.
    hostSize = { w: 800, h: 600 };
    resizeCallbacks.forEach((cb) => cb());
    expect(uncaught).toEqual([]);
    expect(container.querySelector('.leaflet-container')).not.toBeNull();
  });

  it('does not throw when the US/Pacific view changes while hidden', () => {
    hostSize = { w: 800, h: 600 };
    const { rerender } = render(<LiveMap {...props()} />);
    hostSize = { w: 0, h: 0 };
    resizeCallbacks.forEach((cb) => cb());
    rerender(<LiveMap {...props({ view: 'pacific' })} />);
    hostSize = { w: 800, h: 600 };
    resizeCallbacks.forEach((cb) => cb());
    expect(uncaught).toEqual([]);
  });
});
