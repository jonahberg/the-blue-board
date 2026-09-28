import { describe, it, expect } from 'vitest';
import { computeFlightCategory, computeOpsImpact, parseVisibilitySM } from '../src/lib/metar-category.js';

describe('computeFlightCategory', () => {
  it('returns null with no raw METAR', () => {
    expect(computeFlightCategory(null)).toBeNull();
    expect(computeFlightCategory('')).toBeNull();
  });

  it('parses fractional and mixed visibilities', () => {
    // 1/2SM -> 0.5 -> below 1 -> LIFR
    expect(computeFlightCategory('KORD 121651Z 00000KT 1/2SM')).toBe('LIFR');
    // 1 1/2SM -> 1.5 -> below 3 -> IFR
    expect(computeFlightCategory('KORD 121651Z 00000KT 1 1/2SM')).toBe('IFR');
    // 3SM -> exactly 3 -> not below 3, <=5 -> MVFR
    expect(computeFlightCategory('KORD 121651Z 00000KT 3SM')).toBe('MVFR');
  });

  it('honors the AIM visibility boundaries with an unlimited ceiling', () => {
    expect(computeFlightCategory('KORD 5SM')).toBe('MVFR');   // 5 is the MVFR edge
    expect(computeFlightCategory('KORD 6SM')).toBe('VFR');
  });

  it('honors the AIM ceiling boundaries (lowest BKN/OVC layer)', () => {
    expect(computeFlightCategory('KORD 10SM OVC004')).toBe('LIFR'); // 400 < 500
    expect(computeFlightCategory('KORD 10SM BKN005')).toBe('IFR');  // 500 -> not <500, <1000
    expect(computeFlightCategory('KORD 10SM BKN010')).toBe('MVFR'); // 1000 -> <=3000
    expect(computeFlightCategory('KORD 10SM BKN030')).toBe('MVFR'); // 3000 -> <=3000 edge
    expect(computeFlightCategory('KORD 10SM BKN031')).toBe('VFR');  // 3100 -> above 3000
  });

  it('reads "less than" and "more than" visibilities instead of their denominators', () => {
    // M1/4SM is below a quarter mile — it used to read as 4 SM (the "4SM" after the slash).
    expect(computeFlightCategory('KDEN 111753Z 00000KT M1/4SM FG 05/M08 A3024')).toBe('LIFR');
    expect(computeFlightCategory('KDEN 111753Z 00000KT P6SM SKC 05/M08 A3024')).toBe('VFR');
  });

  it('treats a vertical-visibility (VV) group as a ceiling', () => {
    expect(computeFlightCategory('KSFO 270256Z 27012KT 10SM VV002 14/12 A2989')).toBe('LIFR');
    expect(computeFlightCategory('KSFO 270256Z 27012KT 10SM VV008 14/12 A2989')).toBe('IFR');
  });
});

describe('parseVisibilitySM', () => {
  it('reads whole, fractional, mixed, less-than and more-than visibilities', () => {
    expect(parseVisibilitySM('KORD 111751Z 27015KT 10SM FEW250')).toEqual({ miles: 10, text: '10', qualifier: '' });
    expect(parseVisibilitySM('KSFO 111756Z 25008KT 1/2SM FG OVC002')).toEqual({ miles: 0.5, text: '1/2', qualifier: '' });
    expect(parseVisibilitySM('KORD 111751Z 27015KT 1 1/2SM BR OVC004')).toEqual({ miles: 1.5, text: '1 1/2', qualifier: '' });
    expect(parseVisibilitySM('KEWR 111751Z 03018KT 3/4SM -SN OVC008')).toEqual({ miles: 0.75, text: '3/4', qualifier: '' });
    expect(parseVisibilitySM('KDEN 111753Z 00000KT M1/4SM FG VV001')).toEqual({ miles: 0.25, text: '1/4', qualifier: 'M' });
    expect(parseVisibilitySM('KLAX 111753Z 25005KT P6SM SKC')).toEqual({ miles: 6, text: '6', qualifier: 'P' });
  });

  it('returns null when the observation has no statute-mile group (metric station, empty input)', () => {
    expect(parseVisibilitySM('RJAA 270300Z 36005KT 9999 FEW030 20/15 Q1013')).toBeNull();
    expect(parseVisibilitySM('')).toBeNull();
    expect(parseVisibilitySM(null)).toBeNull();
  });
});

describe('computeOpsImpact', () => {
  it('returns a normal, colored object with no raw METAR', () => {
    const r = computeOpsImpact(null, null);
    expect(r.level).toBe('normal');
    expect(r.color).toBe('#22c55e');
  });

  it('escalates on gusts and extracts the gust speed', () => {
    const warn = computeOpsImpact('KORD 121651Z 18025G45KT 10SM FEW250 12/08 A2992 ', 'VFR');
    expect(warn.level).toBe('warning');
    expect(warn.reasons).toContain('gusts 45kt');
    expect(warn.gustKt).toBe(45);

    const caution = computeOpsImpact('KORD 121651Z 18020G32KT 10SM FEW250 12/08 A2992 ', 'VFR');
    expect(caution.level).toBe('caution');
    expect(caution.gustKt).toBe(32);
  });

  it('flags thunderstorms, freezing precip, snow, and heavy precip from multi-group wx', () => {
    const ts = computeOpsImpact('KORD 121651Z 09015KT 5SM TSRA BKN035 20/18 A2990 ', 'MVFR');
    expect(ts.hasThunderstorms).toBe(true);
    expect(ts.level).toBe('warning');

    const fz = computeOpsImpact('KORD 121651Z 09015KT 3SM FZRA OVC015 M02/M05 A2990 ', 'IFR');
    expect(fz.hasFreezingPrecip).toBe(true);

    const sn = computeOpsImpact('KORD 121651Z 09015KT 5SM SN BKN035 M05/M08 A2990 ', 'MVFR');
    expect(sn.hasSnow).toBe(true);

    const heavy = computeOpsImpact('KORD 121651Z 09015KT 2SM +RA OVC010 15/13 A2990 ', 'IFR');
    expect(heavy.reasons).toContain('heavy precipitation');
    expect(heavy.level).toBe('warning');
  });

  it('bumps to severe for LIFR conditions', () => {
    const r = computeOpsImpact('KORD 121651Z 00000KT 1/4SM FG OVC002 05/05 A2990 ', 'LIFR');
    expect(r.level).toBe('severe');
  });

  it('extracts temperature including negative (M-prefixed) values', () => {
    expect(computeOpsImpact('KORD 09015KT 10SM FEW250 12/08 A2992 ', 'VFR').tempC).toBe(12);
    expect(computeOpsImpact('KORD 09015KT 10SM FEW250 M05/M10 A2992 ', 'VFR').tempC).toBe(-5);
    expect(computeOpsImpact('KORD 09015KT 10SM CLR ', 'VFR').gustKt).toBe(0);
  });
});
