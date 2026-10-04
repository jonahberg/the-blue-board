// @vitest-environment jsdom
/**
 * The 24-hour airborne graph's dialog and sparkline, rendered with the real Dialog. The states that
 * must never look broken: launch day (no samples), a young table (90 minutes, with a gap), a full
 * day, and an unavailable history — plus the readout following a tap.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AirborneHistoryDialog, AirborneSparkline } from '../src/app/views/live/AirborneHistory';
import type { AirborneHistory } from '../src/app/data/types';

const MIN = 60_000;

function history(samples: AirborneHistory['samples'], extra: Partial<AirborneHistory> = {}): AirborneHistory {
  const now = Date.now();
  return {
    samples,
    hours: 24,
    since: new Date(now - 24 * 3600_000).toISOString(),
    generatedAt: new Date(now).toISOString(),
    ...extra,
  };
}

/** A sample every 5 minutes over the last `minutes`, skipping (from, to) minutes-ago. */
function recent(minutes: number, skip?: [number, number]) {
  const now = Math.floor(Date.now() / (5 * MIN)) * 5 * MIN;
  const out: AirborneHistory['samples'] = [];
  for (let ago = minutes; ago >= 0; ago -= 5) {
    if (skip && ago < skip[0] && ago > skip[1]) continue;
    out.push({ t: new Date(now - ago * MIN).toISOString(), airborne: 600 + (ago % 30), express: 120 });
  }
  return out;
}

const state = (data: AirborneHistory | null, more: Partial<{ error: Error | null; loading: boolean }> = {}) => ({
  data,
  error: null,
  loading: false,
  updatedAt: Date.now(),
  refresh: vi.fn(),
  ...more,
});

function renderDialog(data: AirborneHistory | null, more = {}) {
  return render(
    <AirborneHistoryDialog
      open
      onOpenChange={() => {}}
      history={state(data, more)}
      liveAirborne={612}
      liveFresh
    />,
  );
}

afterEach(cleanup);

describe('AirborneHistoryDialog', () => {
  it('launch day: an empty frame and the "fills in as data arrives" line, never a blank', () => {
    renderDialog(history([]));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText(/fills in as data arrives/)).toBeTruthy();
    expect(screen.getByText('No samples yet', { selector: 'text' })).toBeTruthy();
    expect(screen.queryAllByTestId('airborne-segment')).toHaveLength(0);
    // With no history yet, the readout leads with the live count rather than a dash.
    expect(screen.getByTestId('airborne-readout').textContent).toMatch(/612airborne now, on the live map/);
    expect(screen.queryByText(/Tap or hover/)).toBeNull();
  });

  it('young table: "Collecting since …", the line at the right edge, a gap as a break', () => {
    renderDialog(history(recent(90, [60, 35])));
    expect(screen.getByText(/^Collecting since .* the 24-hour graph fills in as data arrives\.$/)).toBeTruthy();
    expect(screen.getAllByTestId('airborne-segment')).toHaveLength(2);
    expect(screen.getAllByTestId('airborne-gap')).toHaveLength(1);
    expect(screen.getByTestId('airborne-uncollected')).toBeTruthy();
    expect(screen.getByText(/not a drop to zero/)).toBeTruthy();
  });

  it('full day: one line, no collecting notice, readout = latest 5-minute sample beside the live count', () => {
    renderDialog(history(recent(24 * 60 - 5)));
    expect(screen.getAllByTestId('airborne-segment')).toHaveLength(1);
    expect(screen.queryByText(/Collecting since/)).toBeNull();
    const readout = screen.getByTestId('airborne-readout');
    expect(readout.textContent).toMatch(/latest 5-minute sample/);
    expect(readout.textContent).toMatch(/480 mainline, 120 Express/);
    expect(screen.getByTestId('airborne-live-now').textContent).toMatch(/612/);
  });

  it('arrow keys walk the samples and the readout follows (slider semantics)', () => {
    renderDialog(history(recent(60)));
    const chart = screen.getByRole('slider');
    const last = Number(chart.getAttribute('aria-valuenow'));
    fireEvent.keyDown(chart, { key: 'ArrowLeft' });
    expect(Number(chart.getAttribute('aria-valuenow'))).toBe(last - 1);
    expect(screen.getByTestId('airborne-readout').textContent).not.toMatch(/latest 5-minute sample/);
    fireEvent.keyDown(chart, { key: 'End' });
    expect(screen.getByTestId('airborne-readout').textContent).toMatch(/latest 5-minute sample/);
    expect(chart.getAttribute('aria-valuetext')).toMatch(/airborne at/);
  });

  it('a picked sample stays picked when a refresh adds a sample and the oldest ages out', () => {
    const samples = recent(60);
    const { rerender } = renderDialog(history(samples));
    const chart = screen.getByRole('slider');
    fireEvent.keyDown(chart, { key: 'ArrowLeft' });
    fireEvent.keyDown(chart, { key: 'ArrowLeft' });
    const before = chart.getAttribute('aria-valuetext');
    // The next refresh: one newer sample, the oldest gone — every index shifts by one.
    const last = Date.parse(samples[samples.length - 1].t);
    const next = [...samples.slice(1), { t: new Date(last + 5 * MIN).toISOString(), airborne: 650, express: 120 }];
    rerender(
      <AirborneHistoryDialog open onOpenChange={() => {}} history={state(history(next))} liveAirborne={612} liveFresh />,
    );
    expect(screen.getByRole('slider').getAttribute('aria-valuetext')).toBe(before);
  });

  it('unavailable history: says so, and that the live count still holds', () => {
    renderDialog(history([], { note: 'History is unavailable right now.' }));
    expect(screen.getByText(/History is unavailable right now\. The live count on the map is still current\./)).toBeTruthy();
  });

  it('a failed request offers a retry', () => {
    const refresh = vi.fn();
    render(
      <AirborneHistoryDialog
        open
        onOpenChange={() => {}}
        history={{ ...state(null, { error: new Error('HTTP 502') }), refresh }}
        liveAirborne={0}
        liveFresh={false}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(refresh).toHaveBeenCalled();
    expect(screen.queryByTestId('airborne-live-now')).toBeNull();
  });
});

describe('AirborneSparkline', () => {
  it('shows an icon until there is a shape, then the line', () => {
    const { container, rerender } = render(<AirborneSparkline history={history(recent(10))} />);
    expect(screen.queryByTestId('airborne-sparkline')).toBeNull();
    expect(container.querySelector('svg')).toBeTruthy(); // the lucide icon
    rerender(<AirborneSparkline history={history(recent(180, [120, 90]))} />);
    const spark = screen.getByTestId('airborne-sparkline');
    expect(spark.querySelectorAll('path')).toHaveLength(2);
  });
});
