import { describe, it, expect } from 'vitest';
import { buildFaaIndex, explainFAAStatus, getFAADelayContext } from '../src/lib/faa-context.js';

const FAA_RESPONSE = [
  { airportCode: 'EWR', delays: [{ type: 'Ground Stop', reason: 'thunderstorms', avgDelay: 45 }] },
  { airportCode: 'ORD', delays: [{ type: 'Ground Delay Program', reason: 'wind' }] },
  { airportCode: 'DEN', delays: [] },
];

describe('buildFaaIndex', () => {
  it('keys the /api/faa array by airport code, storing each object as-is', () => {
    const idx = buildFaaIndex(FAA_RESPONSE);
    expect(Object.keys(idx).sort()).toEqual(['DEN', 'EWR', 'ORD']);
    expect(idx.EWR).toBe(FAA_RESPONSE[0]);
  });

  it('skips entries with no airport code', () => {
    const idx = buildFaaIndex([{ delays: [] }, { airportCode: 'SFO', delays: [] }]);
    expect(Object.keys(idx)).toEqual(['SFO']);
  });

  it('returns an empty index for a non-array payload (edge case — API outage)', () => {
    expect(buildFaaIndex(null)).toEqual({});
    expect(buildFaaIndex(undefined)).toEqual({});
    expect(buildFaaIndex({ error: 'upstream' })).toEqual({});
    expect(buildFaaIndex([])).toEqual({});
  });

  it('lets a later entry win when an airport appears twice (edge case)', () => {
    const idx = buildFaaIndex([
      { airportCode: 'ORD', delays: [{ type: 'Departure' }] },
      { airportCode: 'ORD', delays: [{ type: 'Arrival' }] },
    ]);
    expect(idx.ORD.delays[0].type).toBe('Arrival');
  });
});

describe('explainFAAStatus', () => {
  it('says an airport is normal when there are no delays', () => {
    expect(explainFAAStatus('ORD', [], {})).toBe('ORD is operating normally — no reported delays or restrictions.');
    expect(explainFAAStatus('ORD', null, {})).toBe('ORD is operating normally — no reported delays or restrictions.');
  });

  it('names the delay kind and quantifies it', () => {
    expect(explainFAAStatus('EWR', [{ type: 'Departure', reason: 'weather / low ceilings', avgDelay: 45 }], {}))
      .toBe('EWR is currently experiencing departure delays of approximately 45 minutes due to weather / low ceilings.');
    expect(explainFAAStatus('ORD', [{ type: 'Arrival', reason: 'wind', minDelay: 15, maxDelay: 60, trend: 'increasing' }], {}))
      .toBe('ORD is currently experiencing arrival delays of 15-60 minutes due to wind. This is an increasing trend — delays may get worse.');
  });

  it('recognises ground stops and ground delay programs', () => {
    expect(explainFAAStatus('SFO', [{ type: 'Ground Stop', reason: 'thunderstorms', avgDelay: 90, trend: 'decreasing' }], {}))
      .toBe('SFO is currently experiencing a ground stop of approximately 90 minutes due to thunderstorms. Delays are decreasing — conditions improving.');
    expect(explainFAAStatus('DEN', [{ type: 'Ground Delay Program', reason: 'snow' }], {}))
      .toBe('DEN is currently experiencing a ground delay program due to snow.');
  });

  it('short-circuits a closure into its own NOTAM sentence', () => {
    expect(explainFAAStatus('GUM', [{ type: 'Closure', reason: 'typhoon', startTime: '0200Z', endTime: '0800Z' }], {}))
      .toBe('GUM is closed from 0200Z to 0800Z due to typhoon per NOTAM. This is a recurring restriction.');
  });

  it('joins multiple delays into one paragraph', () => {
    expect(explainFAAStatus('ORD', [{ type: 'Departure', reason: 'wind' }, { type: 'Arrival', reason: 'volume' }], {}))
      .toBe('ORD is currently experiencing departure delays due to wind. ORD is currently experiencing arrival delays due to volume.');
  });

  it('degrades to generic wording for an untyped delay (edge case)', () => {
    expect(explainFAAStatus('IAD', [{}], {})).toBe('IAD is currently experiencing delays due to unknown causes.');
  });
});

describe('getFAADelayContext', () => {
  const index = buildFaaIndex([
    { airportCode: 'EWR', delays: [{ type: 'Ground Stop', reason: 'thunderstorms', avgDelay: 45 }] },
    { airportCode: 'ORD', delays: [{ type: 'Ground Delay Program', reason: 'wind' }] },
    { airportCode: 'SFO', delays: [{ type: 'Departure Delay', avgDelay: 20 }, { type: 'Arrival Delay', avgDelay: 35 }] },
    { airportCode: 'DEN', delays: [] },
  ]);

  it('summarises both ends of a route, origin first', () => {
    expect(getFAADelayContext(index, 'EWR', 'ORD')).toBe('Ground Stop at EWR, avg 45 min · GDP at ORD');
  });

  it('abbreviates departure and arrival delays and lists each one', () => {
    expect(getFAADelayContext(index, 'SFO', 'DEN')).toBe('Dep Delay at SFO, avg 20 min · Arr Delay at SFO, avg 35 min');
  });

  it('returns an empty string when neither airport has delays', () => {
    expect(getFAADelayContext(index, 'DEN', 'LAX')).toBe('');
    expect(getFAADelayContext({}, 'EWR', 'ORD')).toBe('');
  });

  it('skips missing route endpoints (edge case)', () => {
    expect(getFAADelayContext(index, 'EWR', undefined)).toBe('Ground Stop at EWR, avg 45 min');
    expect(getFAADelayContext(index, undefined, 'ORD')).toBe('GDP at ORD');
    expect(getFAADelayContext(index, undefined, undefined)).toBe('');
  });

  it('falls back to a generic "Delay" label for an unrecognised type (edge case)', () => {
    const idx = buildFaaIndex([{ airportCode: 'IAH', delays: [{ type: 'Runway construction' }] }]);
    expect(getFAADelayContext(idx, 'IAH', null)).toBe('Delay at IAH');
  });
});
