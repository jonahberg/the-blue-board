// @vitest-environment jsdom
/**
 * NasPanel renders tierNasEventsRaw() output as JSX text. Two things are pinned here:
 *  - upstream text is escaped by React (the old innerHTML-escaping wrapper is gone), and
 *  - an ATCSCC "POSSIBLE" outlook lands under Monitoring with a muted badge, never a red
 *    CRITICAL ground stop, while /api/nas reports nothing active.
 */

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { NasPanel } from '../src/app/views/weather/NasPanel';
import type { NasData } from '../src/app/data/types';

afterEach(cleanup);

describe('NasPanel', () => {
  it('renders hostile upstream text as literal text, with no injected element', () => {
    const nas = {
      active: [],
      planned: [{ event: 'MIT', decoded: '<img src=x onerror=alert(1)> & co', time: '', affectedAirports: [] }],
    } as unknown as NasData;
    const { container } = render(<NasPanel nas={nas} />);
    expect(screen.getByText('<img src=x onerror=alert(1)> & co')).toBeTruthy();
    expect(container.querySelector('img')).toBeNull();
  });

  it('shows a planned POSSIBLE ground-stop outlook under Monitoring with a muted badge', () => {
    const nas = {
      active: [],
      planned: [
        { time: '', event: 'AFTER 1500\t-EWR GROUND STOP/DELAY PROGRAM POSSIBLE', decoded: 'AFTER 1500\t-EWR GROUND STOP/DELAY PROGRAM POSSIBLE', affectedAirports: ['EWR'], type: 'terminal' },
      ],
    } as unknown as NasData;
    const { container } = render(<NasPanel nas={nas} />);
    expect(screen.queryByText('Critical')).toBeNull();
    expect(screen.getByText('Monitoring')).toBeTruthy();
    expect(screen.getByText('planned')).toBeTruthy();
    expect(screen.getByText(/after 1500Z/)).toBeTruthy();
    const badge = [...container.querySelectorAll('span, div')].find((el) => el.textContent === 'GS');
    expect(badge?.className).not.toMatch(/red/);
  });

  it('keeps an ACTIVE ground stop critical and red', () => {
    const nas = {
      active: [{ name: 'GS-EWR', reason: 'WX', affectedFacilities: ['EWR'] }],
      planned: [],
    } as unknown as NasData;
    const { container } = render(<NasPanel nas={nas} />);
    expect(screen.getByText('Critical')).toBeTruthy();
    const badge = [...container.querySelectorAll('span, div')].find((el) => el.textContent === 'GS');
    expect(badge?.className).toMatch(/red/);
  });
});
