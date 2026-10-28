import { describe, it, expect } from 'vitest';

import { RISK_BANDS } from '../src/lib/delay-risk.js';
import {
  asFactors,
  buildDelayExplainBody,
  hubLocalTime,
  iropsContextStr,
  riskLabelColor,
  scheduledDepartureLocal,
  weatherContextStr,
} from '../src/lib/delay-explain-request.js';

describe('RISK_BANDS export (additive change to delay-risk.js)', () => {
  it('is the shipped four-band table, unchanged', () => {
    expect(RISK_BANDS).toEqual([
      { min: 75, label: 'V.HIGH', color: '#dc2626' },
      { min: 50, label: 'HIGH', color: '#ef4444' },
      { min: 25, label: 'MOD', color: '#eab308' },
      { min: 0, label: 'LOW', color: '#22c55e' },
    ]);
  });
});

describe('riskLabelColor', () => {
  it('matches the inventory §27 colours exactly', () => {
    expect(riskLabelColor('V.HIGH')).toBe('#dc2626');
    expect(riskLabelColor('HIGH')).toBe('#ef4444');
    expect(riskLabelColor('MOD')).toBe('#eab308');
    expect(riskLabelColor('LOW')).toBe('#22c55e');
  });

  it('falls back to the lowest band for anything else', () => {
    expect(riskLabelColor(undefined)).toBe('#22c55e');
    expect(riskLabelColor('NONSENSE')).toBe('#22c55e');
  });
});

describe('iropsContextStr', () => {
  it('reports both rates when the sample is big enough', () => {
    expect(iropsContextStr({ cancellationRate: 3, delayed60Rate: 8 })).toBe(
      '3% cancelled, 8% delayed 60min+',
    );
  });

  it('defaults a missing delayed-60 rate to zero', () => {
    expect(iropsContextStr({ cancellationRate: 3, delayed60Rate: null })).toBe(
      '3% cancelled, 0% delayed 60min+',
    );
  });

  it('withholds the rate below the small-sample floor but keeps the count', () => {
    expect(iropsContextStr({ cancellationRate: null, cancellations: 2, total: 4 })).toBe(
      '2 of 4 cancelled (small sample — rate withheld)',
    );
  });

  it('says nothing when there is nothing to report', () => {
    expect(iropsContextStr(null)).toBe('');
    expect(iropsContextStr({ cancellationRate: null, cancellations: 0 })).toBe('');
  });
});

describe('weatherContextStr', () => {
  it('appends the reasons behind the level', () => {
    expect(weatherContextStr({ level: 'MODERATE', reasons: ['gusts 31kt', 'ceiling 1200ft'] })).toBe(
      'MODERATE: gusts 31kt, ceiling 1200ft',
    );
  });

  it('is the level alone when there are no reasons', () => {
    expect(weatherContextStr({ level: 'NORMAL', reasons: [] })).toBe('NORMAL');
  });

  it('is empty for nothing', () => {
    expect(weatherContextStr(null)).toBe('');
    expect(weatherContextStr({})).toBe('');
  });
});

describe('asFactors', () => {
  it('accepts an array (the rebuilt board passes one)', () => {
    expect(asFactors(['a', 'b'])).toEqual(['a', 'b']);
  });

  it('accepts the shipped pipe-joined string (the data-attr form)', () => {
    expect(asFactors('a|b|c')).toEqual(['a', 'b', 'c']);
  });

  it('drops empty entries and handles nothing', () => {
    expect(asFactors('a||b')).toEqual(['a', 'b']);
    expect(asFactors('')).toEqual([]);
    expect(asFactors(undefined)).toEqual([]);
  });
});

describe('hubLocalTime', () => {
  const noon = new Date('2026-09-13T17:00:00Z');

  it('reads the hub wall clock and labels it local', () => {
    expect(hubLocalTime('America/Chicago', noon)).toBe('12:00 PM local');
    expect(hubLocalTime('Asia/Tokyo', noon)).toBe('02:00 AM local');
  });

  it('is empty rather than wrong when the zone is unknown', () => {
    expect(hubLocalTime('', noon)).toBe('');
    expect(hubLocalTime(undefined, noon)).toBe('');
    expect(hubLocalTime('Not/AZone', noon)).toBe('');
  });
});

describe('buildDelayExplainBody', () => {
  const base = {
    flight: 'UA328',
    route: 'ORD→DEN',
    status: 'scheduled',
    riskLabel: 'HIGH',
    hub: 'ORD',
    faaStatus: 'ORD Ground delay program (avg 42m)',
    inbound: 'Aircraft N37502 journey today:',
    hubTime: '04:35 PM local',
    connection: 'Connects to UA200 ORD→BOS, 90min layover (SAFE)',
  };

  it('carries every field inventory §28 lists', () => {
    const body = buildDelayExplainBody({
      ...base,
      riskScore: 62,
      factors: ['a', 'b'],
      otp: '71',
      weather: 'MODERATE: gusts',
      destWeather: 'NORMAL',
      irops: '3% cancelled, 8% delayed 60min+',
    });
    expect(Object.keys(body).sort()).toEqual(
      [
        'connection',
        'destWeather',
        'faaStatus',
        'factors',
        'flight',
        'hub',
        'hubTime',
        'inbound',
        'irops',
        'otp',
        'riskLabel',
        'riskScore',
        'route',
        'scheduled',
        'status',
        'weather',
      ].sort(),
    );
    expect(body.riskScore).toBe(62);
  });

  it('F011: coerces a string score, and OMITS it rather than sending NaN', () => {
    // The shipped builder read `data-risk-score` (always a string); the server's
    // `typeof === 'number'` check silently zeroed it.
    expect(buildDelayExplainBody({ ...base, riskScore: '62' }).riskScore).toBe(62);
    expect('riskScore' in buildDelayExplainBody({ ...base, riskScore: 'NaN' })).toBe(false);
    expect('riskScore' in buildDelayExplainBody({ ...base, riskScore: undefined })).toBe(false);
    expect('riskScore' in buildDelayExplainBody({ ...base })).toBe(false);
    expect(buildDelayExplainBody({ ...base, riskScore: 0 }).riskScore).toBe(0);
  });

  it('accepts the shipped data-attr shape (strings everywhere)', () => {
    const body = buildDelayExplainBody({
      ...base,
      riskScore: '62',
      riskFactors: 'Hub OTP 61%|Ground delay program',
      weather: 'MODERATE: gusts 31kt',
      irops: '3% cancelled, 8% delayed 60min+',
    });
    expect(body.factors).toEqual(['Hub OTP 61%', 'Ground delay program']);
    expect(body.weather).toBe('MODERATE: gusts 31kt');
    expect(body.irops).toBe('3% cancelled, 8% delayed 60min+');
  });

  it('accepts the rebuilt board shape (arrays and live objects)', () => {
    const body = buildDelayExplainBody({
      ...base,
      riskScore: 62,
      riskFactors: ['Hub OTP 61%'],
      weather: { level: 'MODERATE', reasons: ['gusts 31kt'] },
      destWeather: { level: 'NORMAL', reasons: [] },
      irops: { cancellationRate: 3, delayed60Rate: 8 },
    });
    expect(body.factors).toEqual(['Hub OTP 61%']);
    expect(body.weather).toBe('MODERATE: gusts 31kt');
    expect(body.destWeather).toBe('NORMAL');
    expect(body.irops).toBe('3% cancelled, 8% delayed 60min+');
  });

  it('sends OTP as a string, because api/delay-explain drops non-strings', () => {
    // api/delay-explain.ts:89 — `if (!val || typeof val !== 'string') return ''`.
    expect(buildDelayExplainBody({ ...base, otp: 71 }).otp).toBe('71');
    expect(buildDelayExplainBody({ ...base, otp: '71' }).otp).toBe('71');
    expect(buildDelayExplainBody({ ...base, otp: undefined }).otp).toBeUndefined();
  });

  it('survives an empty context without throwing', () => {
    expect(() => buildDelayExplainBody(null)).not.toThrow();
    expect(buildDelayExplainBody({}).factors).toEqual([]);
  });
});

describe('scheduledDepartureLocal + the later-day gate (Oct 7 2026, UA934)', () => {
  const VIEWED = Date.parse('2026-10-08T00:53:00Z'); // 20:53 EDT Oct 7
  const TOMORROW_0820 = Math.floor(Date.parse('2026-10-08T12:20:00Z') / 1000);

  it('names the flight’s own departure in hub time, tagged against the hub’s day', () => {
    expect(scheduledDepartureLocal(TOMORROW_0820, 'America/New_York', VIEWED)).toBe(
      'Thu Oct 8, 08:20 local (tomorrow)',
    );
    expect(scheduledDepartureLocal(TOMORROW_0820 * 1000, 'America/New_York', Date.parse('2026-10-08T11:00:00Z'))).toMatch(
      /\(today\)$/,
    );
    expect(scheduledDepartureLocal('', 'America/New_York', VIEWED)).toBe('');
  });

  it('a later day’s flight is explained without today’s conditions', () => {
    const body = buildDelayExplainBody({
      flight: 'UA934',
      hub: 'EWR',
      scheduledDep: TOMORROW_0820,
      nowMs: VIEWED,
      otp: 90,
      weather: 'MODERATE: gusts',
      faaStatus: 'EWR Ground stop',
      irops: '0% cancelled',
      inbound: 'UA1 from LAX',
    });
    expect(body.scheduled).toBe('Thu Oct 8, 08:20 local (tomorrow)');
    for (const key of ['otp', 'weather', 'destWeather', 'faaStatus', 'irops', 'inbound']) {
      expect(body[key]).toBeUndefined();
    }
  });

  it('a non-hub origin is named in UTC, never in a guessed zone', () => {
    // Arrivals rows put the ORIGIN in `hub`; GIG has no HUB_TZ entry.
    const body = buildDelayExplainBody({ flight: 'UA128', hub: 'GIG', scheduledDep: TOMORROW_0820, nowMs: VIEWED });
    expect(body.scheduled).toBe('Thu Oct 8, 12:20 UTC (today)');
  });

  it('the same flight an hour out keeps them', () => {
    const body = buildDelayExplainBody({
      flight: 'UA934',
      hub: 'EWR',
      scheduledDep: TOMORROW_0820,
      nowMs: Date.parse('2026-10-08T11:20:00Z'),
      faaStatus: 'EWR Ground stop',
    });
    expect(body.faaStatus).toBe('EWR Ground stop');
  });
});
