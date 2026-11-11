// @vitest-environment jsdom
/**
 * The clients of /api/faa never show an old program as a current one (TODOS: "Stale FAA programs
 * on the dashboard"): the weather provider's `faaIndex` (read by the hub strip, the ticker and the
 * delay risk), the NAS panel's "FAA status as of" line, and the /newark widget.
 */

import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  fetchFaa: vi.fn(),
  fetchNas: vi.fn(),
  fetchMetarBatch: vi.fn(),
}));
vi.mock('../src/app/data/api', () => api);
vi.mock('../src/app/state/schedule', () => ({ useSchedule: () => ({ boards: {} }) }));
vi.mock('../src/app/state/watch', () => ({ useWatch: () => ({ watched: [] }) }));

import { WeatherProvider, useWeather } from '../src/app/state/weather';
import { NasPanel } from '../src/app/views/weather/NasPanel';
import { hubProgramMarker } from '../src/lib/ops-health.js';
import { FAA_STALE_AFTER_MS } from '../src/lib/faa-freshness.js';

const NOW = Date.parse('2026-11-10T18:00:00Z');
const MIN = 60_000;

function ewrGroundStop(endTime: string) {
  return {
    airportCode: 'EWR',
    programs: [{ type: 'ground_stop', reason: 'WX:Thunderstorms', endTime }],
    delays: [{ type: 'ground_stop', reason: 'WX:Thunderstorms', endTime }],
    groundStop: true,
    groundDelay: false,
    departureDelay: false,
    arrivalDelay: false,
    closure: false,
  };
}

let seen: ReturnType<typeof useWeather> | null = null;
function Probe() {
  seen = useWeather();
  return null;
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('WeatherProvider: faaIndex is the CURRENT FAA picture', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'], now: NOW });
    seen = null;
    api.fetchMetarBatch.mockResolvedValue([]);
    api.fetchNas.mockResolvedValue({ active: [], planned: [] });
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('a held answer goes stale on the clock after failed refreshes: no program is current any more', async () => {
    api.fetchFaa.mockResolvedValueOnce({ airports: [ewrGroundStop(new Date(NOW + 4 * 3600_000).toISOString())], asOfMs: NOW });
    render(<WeatherProvider><Probe /></WeatherProvider>);
    await flush();
    expect(seen!.faaStale).toBe(false);
    expect(hubProgramMarker(seen!.faaIndex, 'EWR')).toMatchObject({ label: 'Ground stop' });

    // FAA keeps failing; the 5-minute refreshes keep the held answer, and the clock ages it.
    api.fetchFaa.mockRejectedValue(new Error('HTTP 502'));
    await act(async () => {
      vi.advanceTimersByTime(FAA_STALE_AFTER_MS + MIN);
    });
    await flush();
    expect(seen!.faaStale).toBe(true);
    expect(seen!.faaAsOf).toBe(NOW);
    expect(seen!.faaIndex).toEqual({});
    expect(hubProgramMarker(seen!.faaIndex, 'EWR')).toBe(null);
  });

  it('holds "unknown since" steady while the server keeps re-serving the same old snapshot, and clears it when current', async () => {
    const takenAt = NOW - FAA_STALE_AFTER_MS - MIN;
    api.fetchFaa.mockResolvedValueOnce({ airports: [], asOfMs: takenAt });
    render(<WeatherProvider><Probe /></WeatherProvider>);
    await flush();
    expect(seen!.faaStale).toBe(true);
    expect(seen!.faaUnknownSince).toBe(takenAt);

    // The next poll brings the same last-good answer back; its computed moment moved by a second.
    api.fetchFaa.mockResolvedValueOnce({ airports: [], asOfMs: takenAt + 1200 });
    await act(async () => {
      vi.advanceTimersByTime(5 * MIN);
    });
    await flush();
    expect(seen!.faaAsOf).toBe(takenAt + 1200);
    expect(seen!.faaUnknownSince).toBe(takenAt);

    // The FAA answers again: current, and no longer unknown.
    api.fetchFaa.mockResolvedValueOnce({ airports: [], asOfMs: Date.now() });
    await act(async () => {
      vi.advanceTimersByTime(5 * MIN);
    });
    await flush();
    expect(seen!.faaStale).toBe(false);
    expect(seen!.faaUnknownSince).toBeNull();
  });

  it('an answer that is already old on arrival never enters the index, so nothing announces it', async () => {
    api.fetchFaa.mockResolvedValueOnce({
      airports: [ewrGroundStop(new Date(NOW + 4 * 3600_000).toISOString())],
      asOfMs: NOW - FAA_STALE_AFTER_MS - MIN,
    });
    render(<WeatherProvider><Probe /></WeatherProvider>);
    await flush();
    expect(seen!.faaStale).toBe(true);
    expect(seen!.faaIndex).toEqual({});
  });

  it('a program past its own end time (plus the extension grace) drops out between refreshes', async () => {
    // Every refresh returns the same answer, taken at NOW: the FAA is not being re-read.
    api.fetchFaa.mockResolvedValue({ airports: [ewrGroundStop(new Date(NOW + 3 * MIN).toISOString())], asOfMs: NOW });
    render(<WeatherProvider><Probe /></WeatherProvider>);
    await flush();
    expect(hubProgramMarker(seen!.faaIndex, 'EWR')).toMatchObject({ label: 'Ground stop' });
    // Ended 5 min ago: still shown (an extension may be on its way).
    await act(async () => {
      vi.advanceTimersByTime(8 * MIN);
    });
    await flush();
    expect(hubProgramMarker(seen!.faaIndex, 'EWR')).toMatchObject({ label: 'Ground stop' });
    // Ended 16 min ago, answer 19 min old (not yet stale): cleared.
    await act(async () => {
      vi.advanceTimersByTime(11 * MIN);
    });
    await flush();
    expect(seen!.faaStale).toBe(false);
    expect(hubProgramMarker(seen!.faaIndex, 'EWR')).toBe(null);
  });

  it('coming back to a long-hidden tab refreshes first, so a live program is never blanked and re-announced', async () => {
    api.fetchFaa.mockResolvedValue({ airports: [ewrGroundStop(new Date(NOW + 4 * 3600_000).toISOString())], asOfMs: NOW });
    render(<WeatherProvider><Probe /></WeatherProvider>);
    await flush();
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    await act(async () => {
      vi.advanceTimersByTime(40 * MIN); // hidden: no refreshes, and no re-check either
    });
    expect(hubProgramMarker(seen!.faaIndex, 'EWR')).toMatchObject({ label: 'Ground stop' });

    const calls = api.fetchFaa.mock.calls.length;
    const freshAt = Date.now();
    api.fetchFaa.mockResolvedValue({ airports: [ewrGroundStop(new Date(freshAt + 3600_000).toISOString())], asOfMs: freshAt });
    const indexes: unknown[] = [];
    hidden.mockReturnValue(false);
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      indexes.push(seen!.faaIndex);
    });
    await flush();
    expect(api.fetchFaa.mock.calls.length).toBe(calls + 1);
    // The ground stop never left the index on the way back.
    expect(indexes.every((index) => hubProgramMarker(index as never, 'EWR') !== null)).toBe(true);
    expect(seen!.faaStale).toBe(false);
    expect(seen!.faaAsOf).toBe(freshAt);
    expect(hubProgramMarker(seen!.faaIndex, 'EWR')).toMatchObject({ label: 'Ground stop' });
    hidden.mockRestore();
  });

  it('an answer older than the one held does not replace it', async () => {
    api.fetchFaa.mockResolvedValueOnce({ airports: [], asOfMs: NOW });
    render(<WeatherProvider><Probe /></WeatherProvider>);
    await flush();
    // Another edge serves another server's older last good answer, with a ground stop in it.
    api.fetchFaa.mockResolvedValueOnce({ airports: [ewrGroundStop(new Date(NOW + 3600_000).toISOString())], asOfMs: NOW - 10 * MIN });
    await act(async () => {
      vi.advanceTimersByTime(5 * MIN);
    });
    await flush();
    expect(seen!.faaAsOf).toBe(NOW);
    expect(hubProgramMarker(seen!.faaIndex, 'EWR')).toBe(null);
  });
});

describe('NasPanel: the "FAA status as of" line', () => {
  const weather = vi.hoisted(() => ({ value: null as null | Record<string, unknown> }));
  beforeEach(() => {
    weather.value = null;
  });
  afterEach(cleanup);

  it('renders with no NAS items when the FAA answer is stale, and says nothing is current', async () => {
    vi.resetModules();
    vi.doMock('../src/app/state/weather', () => ({ useWeatherOptional: () => weather.value }));
    const { NasPanel: Panel } = await import('../src/app/views/weather/NasPanel');
    weather.value = { faaAsOf: Date.parse('2026-11-10T14:05:00Z'), faaStale: true, nasAsOf: NOW, nasStale: false };
    render(<Panel nas={{ active: [], planned: [] }} />);
    expect(screen.getByText('NAS Status')).toBeTruthy();
    expect(screen.getByText('FAA status as of 14:05Z: airport programs have not updated since and are not shown as current.')).toBeTruthy();
    vi.doUnmock('../src/app/state/weather');
  });

  it('does not draw a stale NAS answer’s tiers (no red ground stop from an old answer)', async () => {
    vi.resetModules();
    vi.doMock('../src/app/state/weather', () => ({ useWeatherOptional: () => weather.value }));
    const { NasPanel: Panel } = await import('../src/app/views/weather/NasPanel');
    weather.value = { faaAsOf: NOW, faaStale: false, nasAsOf: Date.parse('2026-11-10T14:05:00Z'), nasStale: true };
    const nas = {
      active: [{ type: 'GS', airport: 'EWR', reason: 'WX', event: 'EWR GROUND STOP', decoded: 'EWR GROUND STOP', affectedAirports: ['EWR'] }],
      planned: [],
    };
    render(<Panel nas={nas as never} />);
    expect(screen.queryByText('Critical')).toBeNull();
    expect(screen.getByText(/^FAA status as of 14:05Z: system-wide programs/)).toBeTruthy();
    vi.doUnmock('../src/app/state/weather');
  });

  it('outside the provider it renders exactly as before', () => {
    expect(render(<NasPanel nas={{ active: [], planned: [] }} />).container.innerHTML).toBe('');
  });
});

describe('/newark widget', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    vi.resetModules();
    document.body.innerHTML =
      '<span id="newark-active"></span><span id="newark-program-status"></span><span id="newark-updated-time"></span>';
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  const faaResponse = (body: unknown, staleSeconds?: number) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...(staleSeconds ? { 'X-BB-FAA-Stale': String(staleSeconds) } : {}) },
    });
  const route = (faa: () => Response) =>
    vi.fn(async (url: string) => (String(url).startsWith('/api/faa') ? faa() : new Response('{}', { status: 503 })));

  it('a stale answer is reported as "FAA status as of", never as a confirmed "no program"', async () => {
    vi.stubGlobal('fetch', route(() => faaResponse([], 40 * 60)));
    await import('../src/scripts/newark-live.ts');
    const status = document.getElementById('newark-program-status')!;
    await vi.waitFor(() => expect(status.textContent).toMatch(/^FAA status as of /));
    expect(status.textContent).not.toMatch(/No active/);
  });

  it('a current answer lists the program; one past its end time is dropped', async () => {
    const live = ewrGroundStop(new Date(NOW + 3600_000).toISOString());
    const ended = { ...ewrGroundStop(new Date(NOW - 17 * MIN).toISOString()), airportCode: 'EWR' };
    vi.stubGlobal('fetch', route(() => faaResponse([live])));
    await import('../src/scripts/newark-live.ts');
    const status = document.getElementById('newark-program-status')!;
    await vi.waitFor(() => expect(status.textContent).toMatch(/^Ground Stop/));

    vi.resetModules();
    // Served 20 minutes stale: the stop ended 17 minutes ago, after that answer was taken.
    vi.stubGlobal('fetch', route(() => faaResponse([ended], 20 * 60)));
    await import('../src/scripts/newark-live.ts');
    await vi.waitFor(() => expect(status.textContent).toBe('No active FAA ground stop or delay program reported for EWR.'));
  });
});
