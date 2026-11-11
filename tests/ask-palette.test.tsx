// @vitest-environment jsdom
/**
 * Ask the board in the ⌘K palette (src/app/features/SearchPalette.tsx). Pins:
 *  - a plain question gets "Ask: <query>" as the first, pre-selected row (Enter acts on it, F7);
 *    a flight number, a tail or a strong live match does not;
 *  - a question the rules read is applied with NO network call: the answer is published to the
 *    ask store, the view's tab opens, the palette closes, one `ask` event with source 'rules' and
 *    no query text ('model', 'unsupported' and 'unavailable' for the other outcomes);
 *  - a question outside the vocabulary stays in the palette with the plain line and three example
 *    questions; a capped/unavailable server (or the preview's 404) says "simple searches";
 *  - a late answer for a query the visitor has since changed is dropped.
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FeedValue } from '../src/app/state/feed';
import type { ScheduleValue } from '../src/app/state/schedule';
import type { UiValue } from '../src/app/state/ui';
import { SearchPalette } from '../src/app/features/SearchPalette';
import { __peekAskStateForTests, __resetAskStateForTests } from '../src/app/state/ask';

const ctl = vi.hoisted(() => ({
  flights: [] as unknown[],
  select: vi.fn(),
  setSearchOpen: vi.fn(),
  openAircraft: vi.fn(),
  setTab: vi.fn(),
  track: vi.fn(),
}));

vi.mock('../src/lib/track.js', () => ({ track: ctl.track }));

vi.mock('../src/app/state/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/app/state/ui')>()),
  useUi: () =>
    ({
      searchOpen: true,
      setSearchOpen: ctl.setSearchOpen,
      select: ctl.select,
      openFr24: () => {},
      openAircraft: ctl.openAircraft,
      setTab: ctl.setTab,
      focusOn: () => {},
    }) as unknown as UiValue,
}));

vi.mock('../src/app/state/feed', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/app/state/feed')>()),
  useFeed: () => ({ flights: ctl.flights }) as unknown as FeedValue,
}));

vi.mock('../src/app/state/schedule', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/app/state/schedule')>()),
  useSchedule: () =>
    ({ boards: {}, goto: () => {}, preload: () => {}, current: { hub: 'ORD', dir: 'departures', day: 0 } }) as unknown as ScheduleValue,
}));

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.useFakeTimers();
  for (const fn of [ctl.select, ctl.setSearchOpen, ctl.openAircraft, ctl.setTab, ctl.track]) fn.mockReset();
  ctl.flights = [];
  __resetAskStateForTests();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function type(value: string) {
  fireEvent.change(screen.getByRole('combobox'), { target: { value } });
  await act(async () => {
    vi.advanceTimersByTime(200);
  });
}
async function enter() {
  await act(async () => {
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
    await vi.runAllTimersAsync();
  });
}
const respond = (status: number, body: unknown) => ({ status, json: async () => body });

describe('the Ask row', () => {
  it('is the first, pre-selected row for a plain question', async () => {
    render(<SearchPalette />);
    await type('late arrivals into denver');
    const options = screen.getAllByRole('option');
    expect(options[0].textContent).toBe('Ask: late arrivals into denver');
    expect(options[0].getAttribute('aria-selected')).toBe('true');
  });

  it('is not offered for a flight number, a tail, or a strong live match', async () => {
    ctl.flights = [{ fr24id: 'x', flightIATA: 'UA14', callsign: 'UAL14', reg: 'N28912', origin: 'EWR', dest: 'LHR', lat: 50, lon: -30, acType: 'B788' }];
    render(<SearchPalette />);
    for (const q of ['UA1432', 'N12345', 'EWR LHR']) {
      await type(q);
      expect(document.querySelector('[cmdk-item][data-value="ask"]'), q).toBeNull();
    }
  });
});

describe('asking', () => {
  it('a question the rules read is applied with no network call', async () => {
    render(<SearchPalette />);
    await type('late arrivals into denver');
    await enter();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(__peekAskStateForTests().result).toEqual({ view: 'schedule', filters: { hub: 'DEN', direction: 'arrivals', status: 'delayed' } });
    expect(ctl.setTab).toHaveBeenCalledWith('schedule');
    expect(ctl.setSearchOpen).toHaveBeenCalledWith(false);
    expect(ctl.track).toHaveBeenCalledTimes(1);
    expect(ctl.track).toHaveBeenCalledWith('ask', { source: 'rules' });
  });

  it('a board question with no hub gets the board on screen, shown as its hub', async () => {
    render(<SearchPalette />);
    await type('late flights');
    await enter();
    expect(__peekAskStateForTests().result).toEqual({ view: 'schedule', filters: { hub: 'ORD', status: 'delayed' } });
  });

  it('a model answer is re-validated before it is applied', async () => {
    fetchMock.mockResolvedValue(respond(200, { ok: true, source: 'model', result: { view: 'live', filters: { family: '777', airborne: true, label: 'HACKED' } } }));
    render(<SearchPalette />);
    await type('which polaris 777s are flying tonight');
    await enter();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(__peekAskStateForTests().result).toEqual({ view: 'live', filters: { family: '777', airborne: true } });
    expect(ctl.track).toHaveBeenCalledWith('ask', { source: 'model' });
    expect(JSON.stringify(ctl.track.mock.calls)).not.toMatch(/polaris/);
  });

  it('a question outside the vocabulary stays here with the plain line and three examples', async () => {
    fetchMock.mockResolvedValue(respond(200, { ok: true, source: 'unsupported' }));
    render(<SearchPalette />);
    await type('tell me a joke');
    await enter();
    expect(ctl.setSearchOpen).not.toHaveBeenCalled();
    expect(screen.getByTestId('ask-help').textContent).toMatch(/^I can filter by hub/);
    const examples = document.querySelectorAll('[cmdk-item][data-value^="ask-example-"]');
    expect(examples).toHaveLength(3);
    expect(ctl.track).toHaveBeenCalledWith('ask', { source: 'unsupported' });
    // Enter now runs the first example, which the rules answer.
    await enter();
    expect(__peekAskStateForTests().result?.view).toBe('schedule');
  });

  it('an unavailable server (cap, rate limit, the preview proxy\'s 404) says "simple searches"', async () => {
    fetchMock.mockResolvedValue(respond(404, null));
    render(<SearchPalette />);
    await type('which polaris 777s are flying tonight');
    await enter();
    expect(screen.getByTestId('ask-help').textContent).toMatch(/^I can only do simple searches right now\./);
    expect(__peekAskStateForTests().result).toBeNull();
    // Counted apart from questions outside the vocabulary.
    expect(ctl.track).toHaveBeenCalledTimes(1);
    expect(ctl.track).toHaveBeenCalledWith('ask', { source: 'unavailable' });
  });

  it('a late answer for a query that has since changed is dropped', async () => {
    let resolve: (v: unknown) => void = () => {};
    fetchMock.mockReturnValue(new Promise((r) => { resolve = r; }));
    render(<SearchPalette />);
    await type('which polaris 777s are flying tonight');
    await act(async () => {
      fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
    });
    expect(screen.getAllByRole('option')[0].textContent).toMatch(/^Working on it/);
    await type('something else entirely');
    await act(async () => {
      resolve(respond(200, { ok: true, source: 'model', result: { view: 'live', filters: { family: '777' } } }));
      await vi.runAllTimersAsync();
    });
    expect(__peekAskStateForTests().result).toBeNull();
    expect(ctl.setSearchOpen).not.toHaveBeenCalled();
  });
});
