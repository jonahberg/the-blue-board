// @vitest-environment jsdom
// useBoardModel end-to-end on real board row shapes (api/schedule AeroDataBox rows).
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';

import { EMPTY_FILTERS, useBoardModel } from '@/app/views/schedule/useBoardModel';
import type { BoardModelInput } from '@/app/views/schedule/useBoardModel';
import { getStartOfHubDay } from '@/lib/hubTz.js';

const DAY = getStartOfHubDay('SFO', 0, new Date('2026-09-26T19:00:00Z'));
const NOW = DAY + 20 * 3600;

function row(ident: string, model: string, registration = '', regSource?: string) {
  return {
    identification: { number: { default: ident } },
    airport: { origin: { code: { iata: 'SFO' } }, destination: { code: { iata: 'ORD' } } },
    aircraft: { model: { code: model, text: '' }, registration, ...(regSource ? { regSource } : {}) },
    time: { scheduled: { departure: DAY + 14 * 3600, arrival: DAY + 18 * 3600 }, real: {}, estimated: {} },
    status: { generic: { status: { text: 'scheduled' } } },
  };
}

function input(rows: Record<string, unknown>[], lookupReg: BoardModelInput['lookupReg']): BoardModelInput {
  return {
    rows,
    hub: 'SFO',
    dir: 'departures',
    day: 0,
    dayStartSec: DAY,
    nowSec: NOW,
    meta: null,
    filters: EMPTY_FILTERS,
    sort: { column: 'time', asc: true },
    swaps: [],
    liveFlights: [],
    liveFeedTs: null,
    lookupReg,
    fleetDb: [],
    fleetByReg: {
      N76265: { r: 'N76265', t: '737-800', c: '16F/54E+/96Y', d: '2001' },
      N14502: { r: 'N14502', t: 'A321neo', c: '20F/57E+/119Y' },
    } as unknown as BoardModelInput['fleetByReg'],
    starlinkTails: new Set(),
    special: new Map(),
    faaIndex: {},
    weatherOpsByHub: {},
    nas: null,
    hubOtp: {},
    iropsHubRates: {},
  };
}

describe('useBoardModel — backfilled tails must fit the scheduled type (F15)', () => {
  it('drops a ledger tail from another aircraft family (UA2278 A21N ← 737-800 N76265)', () => {
    const { result } = renderHook(() => useBoardModel(input([row('UA2278', 'A21N')], () => 'N76265')));
    const r = result.current.rows[0];
    expect(r.reg).toBe('');
    expect(r.fleet).toBeNull();
  });

  it('drops a server-merged live-feed tail from another family, but keeps a provider tail', () => {
    const { result } = renderHook(() =>
      useBoardModel(
        input(
          [row('UA2278', 'A21N', 'N76265', 'live_feed'), row('UA1', 'A21N', 'N76265')],
          () => null,
        ),
      ),
    );
    const byIdent = Object.fromEntries(result.current.rows.map((r) => [r.ident, r]));
    expect(byIdent.UA2278.reg).toBe('');
    expect(byIdent.UA1.reg).toBe('N76265'); // provider-sent: a real swap is the swap detector's job
  });

  it('keeps a matching ledger tail', () => {
    const { result } = renderHook(() => useBoardModel(input([row('UA2278', 'A21N')], () => 'N14502')));
    expect(result.current.rows[0].reg).toBe('N14502');
    expect(result.current.rows[0].regFromLive).toBe(true);
  });
});
