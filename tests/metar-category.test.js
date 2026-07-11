import { describe, it, expect } from 'vitest';
import { computeFlightCategory, computeOpsImpact } from '../src/lib/metar-category.js';

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
