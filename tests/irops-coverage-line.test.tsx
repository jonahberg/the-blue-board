// @vitest-environment jsdom
/**
 * The IROPS card discloses how many hub boards behind its score are current (v1.28.0):
 * "2 of 3 hub boards current · LAX board 4 h old", one quiet line after the cancellation footnote.
 *
 * The words are src/lib/hub-health.js `iropsCoverageNote`. The card only prints them from a payload
 * that carries the coverage fields (`coverageGapSec`, `boardDayEndSec`, `boardDayOffset`):
 * production's /api/irops does not send them yet, and computed from `generatedAt` alone a final
 * yesterday board would read "N h old" — the error the server change exists to fix. The clock is
 * the moment the payload was fetched, so the line in this polite region changes with the data,
 * not with the minute.
 */

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TooltipProvider } from '@/components/ui/tooltip';
import type { IropsData, IropsHubMetrics } from '../src/app/data/types';

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
    score: (st.data as IropsData | null)?.score ?? null,
    reportClientScore: () => {},
  }),
}));
vi.mock('../src/app/state/schedule', () => ({ useSchedule: () => ({ boards: {} }) }));
vi.mock('../src/app/state/weather', () => ({ useWeather: () => ({ faaIndex: {} }) }));

const { IropsSection } = await import('../src/app/views/weather/IropsSection');

/** A hub board with the v1.28.0 fields, built `ageH` hours before NOW_SEC. */
function hub(ageH: number, over: Record<string, unknown> = {}) {
  const generatedAt = NOW_SEC - ageH * H;
  return {
    total: 300, operated: 150, onTime: 130, cancellations: 1, cancellationsLikely: 0, likelyCanceledSeenFlying: 0,
    delayed30: 10, delayed60: 4, diversions: 0,
    generatedAt, dataAgeSec: ageH * H, ageSec: ageH * H,
    coverageGapSec: ageH * H, boardDayOffset: 0, boardDayEndSec: NOW_SEC + 6 * H,
    departureTimesSeen: 200, departedWithoutTime: 0, pastDueUntimed: 0, holdsInferred: true,
    ...over,
  };
}

function payload(hubMetrics: Record<string, ReturnType<typeof hub> | Record<string, unknown>>): IropsData {
  return {
    score: 8.4, cancellations: 3, cancellationsLikely: 0, likelyCanceledSeenFlying: 0,
    delayed30: 30, delayed60: 12, diversions: 0, totalFlights: 900,
    hubMetrics: hubMetrics as IropsHubMetrics,
  };
}

/** Production today: no coverage fields, only the build time and its age. */
function withoutCoverageFields(m: ReturnType<typeof hub>) {
  const { coverageGapSec: _a, boardDayOffset: _b, boardDayEndSec: _c, ageSec: _d, ...rest } = m;
  return rest;
}

const renderCard = () =>
  render(
    <TooltipProvider>
      <IropsSection />
    </TooltipProvider>,
  );
const coverageLine = () => screen.queryByText(/hub boards? current/);

beforeEach(() => {
  st.fetchedAt = NOW_SEC * 1000;
});
afterEach(() => {
  cleanup();
  st.data = null;
});

describe('IROPS card: hub board coverage line', () => {
  it('names the boards that are not current, after the cancellation footnote, in its register', () => {
    st.data = payload({
      ORD: hub(0.2),
      // Yesterday's board, built after local midnight: final however old it is (gap 0).
      GUM: hub(10, { boardDayOffset: -1, boardDayEndSec: NOW_SEC - 11 * H, coverageGapSec: 0 }),
      LAX: hub(4),
    });
    renderCard();
    const line = coverageLine();
    expect(line?.textContent).toBe('2 of 3 hub boards current · LAX board 4 h old');
    expect(line?.tagName).toBe('P');
    expect(line?.className).toBe('border-t px-3 py-1.5 text-[10px] text-muted-foreground');
    // Inside the card, as its last line.
    expect(line?.parentElement?.lastElementChild).toBe(line);
  });

  it('says nothing when every board is current', () => {
    st.data = payload({ ORD: hub(0.5), DEN: hub(1), GUM: hub(10, { boardDayOffset: -1, boardDayEndSec: NOW_SEC - 11 * H, coverageGapSec: 0 }) });
    renderCard();
    expect(coverageLine()).toBeNull();
  });

  it('a board that went stale between the build and the fetch is named: the clock is the fetch time', () => {
    // The payload was computed when LAX was 2.5 h behind (current); fetched 40 minutes later it
    // is past the 3-hour line.
    st.data = payload({ ORD: hub(0.2), LAX: hub(3.2, { coverageGapSec: 2.5 * H }) });
    renderCard();
    expect(coverageLine()?.textContent).toBe('1 of 2 hub boards current · LAX board 3 h old');
  });

  it('a yesterday board missing the end of its day says how much it missed', () => {
    st.data = payload({
      ORD: hub(0.2),
      SFO: hub(5, { boardDayOffset: -1, boardDayEndSec: NOW_SEC - 1 * H, coverageGapSec: 4 * H }),
    });
    renderCard();
    expect(coverageLine()?.textContent).toBe('1 of 2 hub boards current · SFO board missing the last 4 h of yesterday');
  });

  it('fields absent (production before this release): no line, even with an old build time', () => {
    st.data = payload({
      ORD: withoutCoverageFields(hub(0.2)),
      GUM: withoutCoverageFields(hub(10, { boardDayOffset: -1 })),
      LAX: withoutCoverageFields(hub(4)),
    });
    renderCard();
    expect(coverageLine()).toBeNull();
    // The card itself is unchanged.
    expect(screen.getByText(/index 8\.4/)).toBeTruthy();
  });

  it('the client fallback never prints it', () => {
    st.data = null;
    renderCard();
    expect(coverageLine()).toBeNull();
  });
});
