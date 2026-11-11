// @vitest-environment jsdom
/**
 * The schedule stat strip passes no verdict on the hub from a status-picked subset.
 *
 * "Late arrivals into denver" showed "Showing 8 arrivals at DEN · Late" over a strip reading
 * "0% On-Time ROUGH (5 operated)": true of the late rows, false of Denver. The board's own Status
 * select had the same flaw (Status: Departed on a departures board scored only the flights still in
 * the air). While either picks rows by outcome, the percentage and its word are withheld and the
 * counts stay; a filter that picks by aircraft keeps the percentage (it is a fact about that fleet).
 */

import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

beforeAll(() => {
  // Radix positions the explanation with floating-ui, which needs a ResizeObserver jsdom lacks.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

import { TooltipProvider } from '@/components/ui/tooltip';
import { ScheduleStats } from '@/app/views/schedule/ScheduleStats';
import { EMPTY_FILTERS, useBoardModel } from '@/app/views/schedule/useBoardModel';
import type { BoardModel, BoardModelInput } from '@/app/views/schedule/useBoardModel';
import { makeScheduleAskPredicate, withholdOtpWhenStatusFiltered } from '@/lib/ask-apply.js';
import { getStartOfHubDay } from '@/lib/hubTz.js';
import { OTP_SEVERITY_LABEL } from '@/lib/schedule-row-model.js';

afterEach(cleanup);

const DAY = getStartOfHubDay('DEN', 0, new Date('2026-11-10T19:00:00Z'));
const NOW = DAY + 22 * 3600;

/** A DEN arrival that landed `delayMin` after its scheduled time. */
function landed(n: number, delayMin: number, code = 'B738') {
  const sched = DAY + (8 + n) * 3600;
  return {
    identification: { number: { default: `UA${500 + n}` } },
    airport: { origin: { code: { iata: 'SFO' } }, destination: { code: { iata: 'DEN' } } },
    aircraft: { model: { code, text: '' }, registration: '' },
    time: {
      scheduled: { departure: sched - 2 * 3600, arrival: sched },
      real: { departure: sched - 2 * 3600 + delayMin * 60, arrival: sched + delayMin * 60 },
      estimated: {},
    },
    status: { text: 'Landed', generic: { status: { text: 'landed' } } },
  };
}

// Two on time, three late (past the 30-minute rule): the hub is 40% on time.
const ROWS = [landed(0, 5), landed(1, 0, 'B789'), landed(2, 45), landed(3, 52), landed(4, 75)];

function input(patch: Partial<BoardModelInput> = {}): BoardModelInput {
  return {
    rows: ROWS,
    hub: 'DEN',
    dir: 'arrivals',
    day: 0,
    dayStartSec: DAY,
    nowSec: NOW,
    meta: null,
    filters: EMPTY_FILTERS,
    sort: { column: 'time', asc: true },
    swaps: [],
    liveFlights: [],
    liveFeedTs: null,
    lookupReg: () => null,
    fleetDb: [],
    fleetByReg: {},
    starlinkTails: new Set(),
    special: new Map(),
    faaIndex: {},
    weatherOpsByHub: {},
    nas: null,
    hubOtp: {},
    iropsHubRates: {},
    ...patch,
  };
}

describe('withholdOtpWhenStatusFiltered', () => {
  const stats = { otp: 40, operated: 5, onTime: 2, late: 3 };
  it('keeps the percentage with no status filter, withholds it under either kind', () => {
    expect(withholdOtpWhenStatusFiltered(stats, {})).toEqual({ ...stats, otpWithheld: false });
    expect(withholdOtpWhenStatusFiltered(stats, { statusFilter: 'landed' })).toEqual({ ...stats, otp: null, otpWithheld: true });
    expect(withholdOtpWhenStatusFiltered(stats, { askStatus: true })).toEqual({ ...stats, otp: null, otpWithheld: true });
  });
});

describe('the board model', () => {
  it('unfiltered, the strip scores the whole board', () => {
    const { result } = renderHook(() => useBoardModel(input()));
    expect(result.current.stats).toEqual(expect.objectContaining({ total: 5, operated: 5, onTime: 2, late: 3, otp: 40, otpWithheld: false }));
  });

  it('an ask for late arrivals keeps the counts and withholds the percentage', () => {
    const askFilter = makeScheduleAskPredicate({ hub: 'DEN', direction: 'arrivals', status: 'delayed' }, 'arrivals') as BoardModelInput['askFilter'];
    const { result } = renderHook(() => useBoardModel(input({ askFilter, askNarrowsStatus: true })));
    expect(result.current.rows).toHaveLength(3);
    expect(result.current.stats).toEqual(expect.objectContaining({ total: 3, operated: 3, onTime: 0, late: 3, otp: null, otpWithheld: true }));
  });

  it('the board\'s own Status select is treated the same way', () => {
    const { result } = renderHook(() => useBoardModel(input({ filters: { ...EMPTY_FILTERS, status: 'landed' } })));
    expect(result.current.stats).toEqual(expect.objectContaining({ otp: null, otpWithheld: true }));
  });

  it('a filter that picks by aircraft keeps the percentage: it is a fact about that fleet', () => {
    const { result } = renderHook(() => useBoardModel(input({ filters: { ...EMPTY_FILTERS, fleetFamily: '737' } })));
    expect(result.current.stats).toEqual(expect.objectContaining({ total: 4, operated: 4, onTime: 1, late: 3, otp: 25, otpWithheld: false }));
  });
});

describe('the strip', () => {
  const LATE_ONLY: BoardModel['stats'] = {
    total: 8, onTime: 0, late: 5, untimed: 0, inAir: 1, upcoming: 2, canceled: 0, canceledUncertain: 0,
    canceledConfirmed: 0, presumed: 0, operated: 5, otp: null, uncategorized: 0, otpWithheld: true,
  };
  for (const compact of [false, true]) {
    it(`${compact ? 'phone' : 'desktop'}: no percentage, no verdict word, and the reason behind the On-Time term`, async () => {
      const { container } = render(
        <TooltipProvider>
          <ScheduleStats stats={LATE_ONLY} dir="arrivals" dayLabel="Tue, Nov 10" hub="DEN" hubDisruptionMinutes={null} compact={compact} />
        </TooltipProvider>,
      );
      const text = container.textContent || '';
      // The verdict words are OTP_SEVERITY_LABEL's (src/lib/schedule-row-model.js), upper-cased in CSS.
      for (const word of Object.values(OTP_SEVERITY_LABEL) as string[]) expect(text.toLowerCase()).not.toContain(word);
      expect(text).not.toContain('%');
      expect(text).toContain('—');
      expect(text).toContain('5 operated');
      // The reason is the On-Time term's explanation (hover, focus or a tap), no longer a card
      // title= that a touch screen never shows (Nov 2026).
      await act(async () => {
        fireEvent.focus(screen.getByRole('button', { name: 'On-Time' }));
      });
      expect(screen.getByRole('tooltip').textContent).toMatch(/No on-time percentage while the board is filtered by status/);
    });
  }
});
