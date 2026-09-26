// @vitest-environment jsdom
/**
 * Asking the map to centre on something means showing the map. The legacy dashboard's
 * focusFlight() always switched to Live and then centred; after the v1.8.0 rebuild the flight
 * sheet's "Centre map" and the ⌘K "Airborne now" result left the viewer on whatever tab they
 * were on, looking at nothing. `focusOn` owns the tab switch so no caller can forget it.
 */

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { UiProvider, useUi } from '../src/app/state/ui';
import type { UiValue } from '../src/app/state/ui';

let ui: UiValue | null = null;
function Probe() {
  ui = useUi();
  return null;
}

afterEach(() => {
  cleanup();
  ui = null;
  window.history.replaceState(null, '', '/');
});

describe('focusOn', () => {
  it('switches to the Live tab and records the focus point', () => {
    render(
      <UiProvider>
        <Probe />
      </UiProvider>,
    );
    act(() => ui!.setTab('schedule'));
    expect(ui!.tab).toBe('schedule');

    act(() => ui!.focusOn(41.9786, -87.9048));
    expect(ui!.tab).toBe('live');
    expect(window.location.hash).toBe('#live');
    expect(ui!.focus).toMatchObject({ lat: 41.9786, lon: -87.9048 });
  });
});
