import { beforeAll, describe, it, expect } from 'vitest';
import { buildFaaIndex, explainFAAStatus, faaTypeLabel, getFAADelayContext } from '../src/lib/faa-context.js';
import { serverFaaResponse } from './fixtures/faa-server-shape.js';

// Delay types are the snake_case vocabulary api/faa.ts actually sends
// ('ground_stop' | 'ground_delay' | 'departure_delay' | 'arrival_delay' | 'closure').
const FAA_RESPONSE = [
  { airportCode: 'EWR', delays: [{ type: 'ground_stop', reason: 'thunderstorms', avgDelay: 45 }] },
  { airportCode: 'ORD', delays: [{ type: 'ground_delay', reason: 'wind' }] },
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
    expect(explainFAAStatus('EWR', [{ type: 'departure_delay', reason: 'weather / low ceilings', avgDelay: 45 }], {}))
      .toBe('EWR is currently experiencing departure delays of approximately 45 minutes due to weather / low ceilings.');
    expect(explainFAAStatus('ORD', [{ type: 'arrival_delay', reason: 'wind', minDelay: 15, maxDelay: 60, trend: 'increasing' }], {}))
      .toBe('ORD is currently experiencing arrival delays of 15-60 minutes due to wind. This is an increasing trend — delays may get worse.');
  });

  it('recognises ground stops and ground delay programs', () => {
    expect(explainFAAStatus('SFO', [{ type: 'ground_stop', reason: 'thunderstorms', avgDelay: 90, trend: 'decreasing' }], {}))
      .toBe('SFO is currently experiencing a ground stop of approximately 90 minutes due to thunderstorms. Delays are decreasing — conditions improving.');
    expect(explainFAAStatus('DEN', [{ type: 'ground_delay', reason: 'snow' }], {}))
      .toBe('DEN is currently experiencing a ground delay program due to snow.');
  });

  it('short-circuits a closure into its own NOTAM sentence', () => {
    expect(explainFAAStatus('GUM', [{ type: 'closure', reason: 'typhoon', startTime: '0200Z', endTime: '0800Z' }], {}))
      .toBe('GUM is closed from 0200Z to 0800Z due to typhoon per NOTAM. This is a recurring restriction.');
  });

  it('joins multiple delays into one paragraph', () => {
    expect(explainFAAStatus('ORD', [{ type: 'departure_delay', reason: 'wind' }, { type: 'arrival_delay', reason: 'volume' }], {}))
      .toBe('ORD is currently experiencing departure delays due to wind. ORD is currently experiencing arrival delays due to volume.');
  });

  it('degrades to generic wording for an untyped delay (edge case)', () => {
    expect(explainFAAStatus('IAD', [{}], {})).toBe('IAD is currently experiencing delays due to unknown causes.');
  });
});

describe('getFAADelayContext', () => {
  const index = buildFaaIndex([
    { airportCode: 'EWR', delays: [{ type: 'ground_stop', reason: 'thunderstorms', avgDelay: 45 }] },
    { airportCode: 'ORD', delays: [{ type: 'ground_delay', reason: 'wind' }] },
    { airportCode: 'SFO', delays: [{ type: 'departure_delay', avgDelay: 20 }, { type: 'arrival_delay', avgDelay: 35 }] },
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

describe('FAA helpers on the real /api/faa response', () => {
  /** @type {Record<string, any>} */
  let index;
  beforeAll(async () => {
    index = buildFaaIndex(await serverFaaResponse());
  });

  it('the server really does send snake_case delay types', () => {
    expect(index.EWR.delays[0].type).toBe('ground_stop');
    expect(index.LGA.delays[0].type).toBe('ground_delay');
  });

  it('narrates a ground stop and a ground delay program by name', () => {
    expect(explainFAAStatus('EWR', index.EWR.delays, index.EWR)).toBe(
      'EWR is currently experiencing a ground stop due to weather.',
    );
    expect(explainFAAStatus('LGA', index.LGA.delays, index.LGA)).toContain('a ground delay program');
    expect(explainFAAStatus('RSW', index.RSW.delays, index.RSW)).toContain('departure delays');
    expect(explainFAAStatus('BOS', index.BOS.delays, index.BOS)).toContain('arrival delays of 16-30 minutes');
    expect(explainFAAStatus('DCA', index.DCA.delays, index.DCA)).toMatch(/^DCA is closed/);
  });

  it('labels the route context Ground Stop / GDP', () => {
    expect(getFAADelayContext(index, 'EWR', 'LGA')).toBe('Ground Stop at EWR · GDP at LGA, avg 18 min');
    expect(getFAADelayContext(index, 'SLC', 'BOS')).toBe('Dep Delay at SLC, avg 15 min · Arr Delay at BOS');
  });
});

describe('faaTypeLabel', () => {
  it('turns every server type into its display label', () => {
    expect(faaTypeLabel('ground_stop')).toBe('Ground Stop');
    expect(faaTypeLabel('ground_delay')).toBe('Ground Delay Program');
    expect(faaTypeLabel('departure_delay')).toBe('Departure Delay');
    expect(faaTypeLabel('arrival_delay')).toBe('Arrival Delay');
    expect(faaTypeLabel('closure')).toBe('Closure');
  });

  it('passes an unknown type through and returns "" for none (edge case)', () => {
    expect(faaTypeLabel('Runway construction')).toBe('Runway construction');
    expect(faaTypeLabel(undefined)).toBe('');
  });
});
