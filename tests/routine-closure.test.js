// A routine NOTAM closure (a nightly curfew, a PPR/GA restriction, a runway-only closure) is not an
// airport closure. The brief screened them before computing the network status; the hub strip did
// not, so the strip could read "Disrupted" beside a brief that said otherwise. The screen now lives
// in hubProgramMarker() (src/lib/ops-health.js), which every surface goes through.
import { describe, it, expect } from 'vitest';

import { deriveOpsHealth, hubProgramMarker, isWholeAirportClosure, networkStatus, withoutRoutineClosures } from '../src/lib/ops-health.js';
import { networkLabel, HUB_ORDER } from '../src/lib/hub-health.js';
import { isWholeAirportClosure as briefScreen } from '../src/lib/brief-facts.js';
import { buildFaaIndex } from '../src/lib/faa-context.js';

const CURFEW = '!EWR 11/008 EWR AD AP CLSD DLY 0430-1015 2611100430-2611211015';

/** /api/faa's shape for an airport whose only entry is a closure with this reason. */
function closureAirport(code, reason) {
  return {
    airportCode: code,
    programs: [{ type: 'closure', reason }],
    delays: [{ type: 'closure', reason, avgDelay: null, minDelay: null, maxDelay: null, endTime: null }],
    groundStop: false,
    groundDelay: false,
    departureDelay: false,
    arrivalDelay: false,
    closure: true,
    avgDelay: null,
    minDelay: null,
    maxDelay: null,
  };
}

const GOOD_OTPS = [88, 91, 85, 90, 87, 92, 86, 89, 90];

describe('routine closures are screened once, for every surface', () => {
  it('a nightly curfew gives the hub chip no program marker and the strip reads Smooth Ops', () => {
    const faaIndex = buildFaaIndex([closureAirport('EWR', CURFEW)]);
    expect(hubProgramMarker(faaIndex, 'EWR')).toBe(null);

    const strip = networkLabel(GOOD_OTPS, { iropsScore: 5, faaIndex, hubCodes: HUB_ORDER });
    expect(strip.label).toBe('Smooth Ops');
    expect(strip.level).toBe('normal');
    expect(networkStatus({ hubOtps: { EWR: 90 }, faaIndex, hubCodes: ['EWR'], iropsScore: 5 }).level).toBe('normal');
    expect(deriveOpsHealth({ hubOtps: { EWR: 90 }, faaIndex, hubCodes: ['EWR'], iropsScore: 5 }).level).toBe('normal');
  });

  it('runway-only and PPR/GA closures are routine too', () => {
    for (const reason of ['!ORD 11/120 ORD RWY 10L/28R CLSD', 'TO NON SKED TRANSIENT GA ACFT EXC 24HR PPR 702-261-7775']) {
      expect(hubProgramMarker(buildFaaIndex([closureAirport('ORD', reason)]), 'ORD')).toBe(null);
    }
  });

  it('a real closure still reads as one: red marker with words, and the network is Disrupted', () => {
    const faaIndex = buildFaaIndex([closureAirport('DEN', 'snow and ice removal')]);
    expect(hubProgramMarker(faaIndex, 'DEN')).toEqual({ severity: 'red', marker: '⛔', label: 'Airport closure' });
    expect(networkLabel(GOOD_OTPS, { iropsScore: 5, faaIndex, hubCodes: HUB_ORDER }).label).toBe('Disrupted');
  });

  it('screening a curfew keeps every other program at the airport', () => {
    const airport = closureAirport('EWR', CURFEW);
    airport.programs.push({ type: 'ground_delay', reason: 'WX:Low Ceilings', avgDelay: 45 });
    airport.delays.push({ type: 'ground_delay', reason: 'WX:Low Ceilings', avgDelay: 45 });
    airport.groundDelay = true;
    const screened = withoutRoutineClosures(airport);
    expect(screened.closure).toBe(false);
    expect(screened.programs.map((p) => p.type)).toEqual(['ground_delay']);
    expect(hubProgramMarker({ EWR: airport }, 'EWR')).toMatchObject({ severity: 'amber', label: 'Ground delay program' });
  });

  it('the brief uses the same screen (one definition, re-exported)', () => {
    expect(briefScreen).toBe(isWholeAirportClosure);
  });

  it('an entry with nothing routine comes back as the same object', () => {
    const airport = closureAirport('DEN', 'snow and ice removal');
    expect(withoutRoutineClosures(airport)).toBe(airport);
  });
});
