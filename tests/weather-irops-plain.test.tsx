// @vitest-environment jsdom
/**
 * Nothing inside the IROPS block's polite live region is a link or a new button (links everywhere,
 * ruling 7): a link's name would be re-read with every change of the region. So the two places it
 * prints hub codes stay text: the client fallback's FAA lines ("EWR: Ground Stop · LGA: Ground
 * Delay Program") and the server path's coverage line ("LAX board 3 h old"). The hubs they name
 * are linked elsewhere on the tab (the NAS panel's tags, the hub cards).
 */

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TooltipProvider } from '@/components/ui/tooltip';

const NOW_SEC = 1_794_434_400;
const H = 3600;

const st = vi.hoisted(() => ({ data: null as unknown, fetchedAt: null as number | null }));

vi.mock('../src/app/state/irops', () => ({
  useIrops: () => ({
    data: st.data,
    fetchedAt: st.fetchedAt,
    loading: false,
    error: null,
    refresh: () => {},
    hubRates: {},
    score: null,
    reportClientScore: () => {},
  }),
}));
vi.mock('../src/app/state/schedule', () => ({ useSchedule: () => ({ boards: {} }) }));
vi.mock('../src/app/state/weather', () => ({
  useWeather: () => ({
    faaIndex: {
      EWR: { delays: [{ type: 'ground_stop', reason: 'WX' }] },
      LGA: { delays: [{ type: 'ground_delay', reason: 'VOL' }] },
    },
  }),
}));
// The fallback path shows only with loaded boards behind it; its counts are not under test here.
vi.mock('../src/lib/irops-client.js', () => ({
  countIropsFromBoards: () => ({
    cancellations: 2,
    cancellationsLikely: 0,
    likelyCanceledSeenFlying: 0,
    delayed30: 3,
    delayed60: 1,
    diversions: 0,
    total: 120,
  }),
}));

const { IropsSection } = await import('../src/app/views/weather/IropsSection');

const renderCard = () =>
  render(
    <TooltipProvider>
      <IropsSection />
    </TooltipProvider>,
  );

/** The links inside the live region, and its buttons (the block has always had two: IROPS and "?"). */
function controlsInLiveRegion() {
  const region = document.querySelector('[aria-live]') as HTMLElement;
  expect(region).toBeTruthy();
  return {
    links: region.querySelectorAll('a').length,
    buttons: [...region.querySelectorAll('button')].map((b) => b.getAttribute('aria-label') || b.textContent),
  };
}

afterEach(() => {
  cleanup();
  st.data = null;
  st.fetchedAt = null;
});

describe('IROPS block: hub codes in its live region stay text', () => {
  it('the client fallback prints its FAA lines as text', () => {
    renderCard();
    expect(screen.getByText(/EWR: Ground Stop/)).toBeTruthy();
    expect(screen.getByText(/LGA: Ground Delay Program/)).toBeTruthy();
    expect(controlsInLiveRegion()).toEqual({ links: 0, buttons: ['IROPS', 'What does this mean?'] });
  });

  it('the server path prints its coverage line as text', () => {
    const hub = (ageH: number) => ({
      total: 300, operated: 150, onTime: 130, cancellations: 1, cancellationsLikely: 0, likelyCanceledSeenFlying: 0,
      delayed30: 10, delayed60: 4, diversions: 0,
      generatedAt: NOW_SEC - ageH * H, dataAgeSec: ageH * H, ageSec: ageH * H,
      coverageGapSec: ageH * H, boardDayOffset: 0, boardDayEndSec: NOW_SEC + 6 * H,
      departureTimesSeen: 200, departedWithoutTime: 0, pastDueUntimed: 0, holdsInferred: true,
    });
    st.data = {
      score: 8.4, cancellations: 3, cancellationsLikely: 0, likelyCanceledSeenFlying: 0,
      delayed30: 30, delayed60: 12, diversions: 0, totalFlights: 900,
      hubMetrics: { ORD: hub(0.5), DEN: hub(0.5), LAX: hub(4) },
    };
    st.fetchedAt = NOW_SEC * 1000;
    renderCard();
    expect(screen.getByText(/LAX board/)).toBeTruthy();
    expect(controlsInLiveRegion()).toEqual({ links: 0, buttons: ['IROPS', 'What does this mean?'] });
  });
});
