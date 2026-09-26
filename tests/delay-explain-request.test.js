import { describe, it, expect } from 'vitest';

import { RISK_BANDS } from '../src/lib/delay-risk.js';
import {
  asFactors,
  buildDelayExplainBody,
  hubLocalTime,
  iropsContextStr,
  riskLabelColor,
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
