// @vitest-environment jsdom
/**
 * F3 — the verification ledger must still arrive when the visitor leaves the tab mid-fetch.
 *
 * The ledger is fetched once, lazily, the first time the Starlink tab opens. The guard that
 * enforces "once" was being set BEFORE the request settled, while both settle handlers bailed
 * out early if the tab had changed in the meantime — so a visitor who clicked away during the
 * round trip latched the flag `true` with no data behind it, and the panel never appeared
 * again for the life of the page. The ledger is the tab's only honest self-audit, so silently
 * losing it is worse than showing it late.
 *
 * Views stay mounted after their first visit (`Dashboard.tsx` renders every visited tab with
 * `forceMount`), so the correct behaviour is to ACCEPT a result that lands while the tab is
 * off screen. The rule the fix has to keep: the flag is never `true` without data.
 */

import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FeedValue } from '../src/app/state/feed';
import type { FleetValue } from '../src/app/state/fleet';
import type { PrefsValue } from '../src/app/state/prefs';
import type { UiValue } from '../src/app/state/ui';
import StarlinkView from '../src/app/views/StarlinkView';

type Settler = { resolve: (value: unknown) => void; reject: (reason: unknown) => void };

const ctl = vi.hoisted(() => ({
  tab: 'starlink' as string,
  pending: [] as { resolve: (value: unknown) => void; reject: (reason: unknown) => void }[],
  calls: 0,
}));

vi.mock('../src/app/data/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/app/data/api')>()),
  fetchStarlinkMismatches: () => {
    ctl.calls += 1;
    return new Promise((resolve, reject) => {
      ctl.pending.push({ resolve, reject });
    });
  },
}));

const FLEET = {
  fleetDb: [],
  fleetByReg: {},
  starlink: {
    tails: new Set<string>(),
    flightsByTail: {},
    stats: null,
    aircraft: [],
    lastUpdated: null,
    syncedAt: null,
    degraded: false,
  },
  fleetSummary: null,
  special: {},
  loading: false,
  loadFailed: false,
  retry: () => {},
} as unknown as FleetValue;

const FEED = { flights: [] } as unknown as FeedValue;
const PREFS = { homeAirport: 'ORD' } as unknown as PrefsValue;

vi.mock('../src/app/state/fleet', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/app/state/fleet')>()),
  useFleet: () => FLEET,
}));

vi.mock('../src/app/state/feed', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/app/state/feed')>()),
  useFeed: () => FEED,
}));

vi.mock('../src/app/state/prefs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/app/state/prefs')>()),
  usePrefs: () => PREFS,
}));

vi.mock('../src/app/state/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/app/state/ui')>()),
  useUi: () =>
    ({
      tab: ctl.tab,
      setTab: () => {},
      select: () => {},
      focusOn: () => {},
      openAircraft: () => {},
      setStarlinkFilter: () => {},
    }) as unknown as UiValue,
}));

const LEDGER_PAYLOAD = {
  disputed: [
    {
      tail: 'N12345',
      aircraft: '737-900',
      operator: 'United',
      verifiedAs: 'Viasat',
      verifiedAt: '2026-09-01',
    },
  ],
  summary: { verifiedStarlink: 400, disputed: 1, unverified: 12, totalPlanes: 413 },
};

/** The one in-flight `fetchStarlinkMismatches()` call, which the test settles by hand. */
function inFlight(): Settler {
  const next = ctl.pending.shift();
  if (!next) throw new Error('no fetchStarlinkMismatches() call is in flight');
  return next;
}

function ledger(): HTMLElement | null {
  return screen.queryByLabelText('Starlink verification ledger');
}

beforeEach(() => {
  ctl.tab = 'starlink';
  ctl.pending = [];
  ctl.calls = 0;
});

afterEach(() => {
  cleanup();
});

describe('StarlinkView verification ledger fetch guard', () => {
  it('renders the ledger when the visitor leaves the tab before the fetch settles', async () => {
    const view = render(<StarlinkView />);
    expect(ctl.calls).toBe(1);
    expect(ledger()).toBeNull();

    // Away before the round trip lands.
    ctl.tab = 'live';
    await act(async () => {
      view.rerender(<StarlinkView />);
    });

    await act(async () => {
      inFlight().resolve(LEDGER_PAYLOAD);
    });

    // Back.
    ctl.tab = 'starlink';
    await act(async () => {
      view.rerender(<StarlinkView />);
    });

    expect(ledger()).not.toBeNull();
    expect(screen.getByText('N12345')).toBeTruthy();
    expect(ctl.calls).toBe(1);
  });

  it('renders the ledger when the visitor stays on the tab (control)', async () => {
    render(<StarlinkView />);
    expect(ctl.calls).toBe(1);

    await act(async () => {
      inFlight().resolve(LEDGER_PAYLOAD);
    });

    expect(ledger()).not.toBeNull();
    expect(ctl.calls).toBe(1);
  });

  it('retries on the next visit after the request fails', async () => {
    const view = render(<StarlinkView />);
    expect(ctl.calls).toBe(1);

    await act(async () => {
      inFlight().reject(new Error('Starlink mismatches 503'));
    });
    expect(ledger()).toBeNull();

    ctl.tab = 'live';
    await act(async () => {
      view.rerender(<StarlinkView />);
    });
    ctl.tab = 'starlink';
    await act(async () => {
      view.rerender(<StarlinkView />);
    });

    expect(ctl.calls).toBe(2);
    await act(async () => {
      inFlight().resolve(LEDGER_PAYLOAD);
    });
    expect(ledger()).not.toBeNull();
  });

  it('retries after an unrecognised payload, and never leaves the guard set without data', async () => {
    const view = render(<StarlinkView />);

    await act(async () => {
      inFlight().resolve({ nonsense: true });
    });
    expect(ledger()).toBeNull();

    ctl.tab = 'live';
    await act(async () => {
      view.rerender(<StarlinkView />);
    });
    ctl.tab = 'starlink';
    await act(async () => {
      view.rerender(<StarlinkView />);
    });

    expect(ctl.calls).toBe(2);
  });

  it('does not fire a second request when the tab is toggled while one is in flight', async () => {
    const view = render(<StarlinkView />);

    for (const tab of ['live', 'starlink', 'live', 'starlink']) {
      ctl.tab = tab;
      await act(async () => {
        view.rerender(<StarlinkView />);
      });
    }

    expect(ctl.calls).toBe(1);
    await act(async () => {
      inFlight().resolve(LEDGER_PAYLOAD);
    });
    expect(ledger()).not.toBeNull();
  });
});
