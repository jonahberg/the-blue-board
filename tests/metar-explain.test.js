import { describe, it, expect } from 'vitest';
import {
  parseMetarQuick,
  applyStructuredMetarFallback,
  formatStructuredVisibility,
  hasRenderableMetarData,
  explainMETAR,
  worstCategory,
  CAT_COLORS,
  CAT_RANK,
} from '../src/lib/metar-explain.js';

const ORD = 'KORD 111751Z 27015G25KT 10SM FEW250 M02/M11 A3012 RMK AO2 SLP210';
const SFO_FOG = 'KSFO 111756Z 25008KT 1/2SM FG OVC002 12/11 A2998 RMK AO2';
const EWR_SN = 'KEWR 111751Z 03018G32KT 2SM -SN BKN008 OVC015 M01/M03 A2975';
const DEN_CLR = 'KDEN 111753Z 00000KT 10SM CLR 05/M08 A3024';

describe('CAT_COLORS / CAT_RANK', () => {
  it('keeps the four flight-category colours', () => {
    expect(CAT_COLORS).toEqual({ VFR: '#22c55e', MVFR: '#eab308', IFR: '#ef4444', LIFR: '#c026d3' });
  });

  it('ranks LIFR as the most restrictive and treats UNK as clear', () => {
    expect(CAT_RANK).toEqual({ LIFR: 0, IFR: 1, MVFR: 2, VFR: 3, UNK: 3 });
    expect(CAT_RANK.LIFR).toBeLessThan(CAT_RANK.IFR);
    expect(CAT_RANK.UNK).toBe(CAT_RANK.VFR);
  });

  it('has no colour for UNK — the caller supplies the slate fallback (edge case)', () => {
    expect(CAT_COLORS.UNK).toBeUndefined();
  });
});

describe('worstCategory', () => {
  it('takes the more restrictive of the API and locally computed categories', () => {
    expect(worstCategory('VFR', 'IFR')).toBe('IFR');
    expect(worstCategory('IFR', 'VFR')).toBe('IFR');
    expect(worstCategory('MVFR', 'LIFR')).toBe('LIFR');
  });

  it('keeps the API category when the local parse agrees or is less restrictive', () => {
    expect(worstCategory('IFR', 'IFR')).toBe('IFR');
    expect(worstCategory('LIFR', 'MVFR')).toBe('LIFR');
  });

  it('lets a computed category override an unknown API category', () => {
    expect(worstCategory('UNK', 'MVFR')).toBe('MVFR');
    expect(worstCategory('UNK', 'VFR')).toBe('UNK');
  });

  it('falls back to the API category when nothing was computed (edge case)', () => {
    expect(worstCategory('MVFR', null)).toBe('MVFR');
    expect(worstCategory('MVFR', '')).toBe('MVFR');
    expect(worstCategory('MVFR', undefined)).toBe('MVFR');
  });

  it('treats an unrecognised category as clear rather than crashing (edge case)', () => {
    expect(worstCategory('BOGUS', 'IFR')).toBe('IFR');
    expect(worstCategory('IFR', 'BOGUS')).toBe('IFR');
  });
});

describe('formatStructuredVisibility', () => {
  it('appends SM to a bare statute-mile number', () => {
    expect(formatStructuredVisibility(10)).toBe('10 SM');
    expect(formatStructuredVisibility('6+')).toBe('6+ SM');
  });

  it('passes through values that already carry a unit', () => {
    expect(formatStructuredVisibility('10SM')).toBe('10SM');
    expect(formatStructuredVisibility('4000m')).toBe('4000m');
  });

  it('reads a big bare number as metres, not miles', () => {
    expect(formatStructuredVisibility(9000)).toBe('9000m');
  });

  it('switches units at exactly 50 (edge case)', () => {
    expect(formatStructuredVisibility(50)).toBe('50 SM');
    expect(formatStructuredVisibility(51)).toBe('51m');
  });

  it('renders the em-dash placeholder for missing values (edge case)', () => {
    expect(formatStructuredVisibility(null)).toBe('--');
    expect(formatStructuredVisibility(undefined)).toBe('--');
    expect(formatStructuredVisibility('')).toBe('--');
    expect(formatStructuredVisibility('   ')).toBe('--');
  });
});

describe('parseMetarQuick', () => {
  it('pulls wind, visibility, temperature and cloud base out of a raw METAR', () => {
    expect(parseMetarQuick(ORD)).toEqual({
      temp: '-2°C / 28°F',
      wind: '270° @ 15kt G25',
      vis: '10 SM',
      clouds: 'Few 25000ft',
    });
  });

  it('reads calm winds and clear skies', () => {
    expect(parseMetarQuick(DEN_CLR)).toEqual({
      temp: '5°C / 41°F',
      wind: '000° @ 00kt',
      vis: '10 SM',
      clouds: 'Clear',
    });
  });

  it('reports the lowest cloud layer, not the highest', () => {
    expect(parseMetarQuick(EWR_SN).clouds).toBe('Broken 800ft');
  });

  it('accepts a structured payload and reads its rawOb', () => {
    expect(parseMetarQuick({ rawOb: ORD }).wind).toBe('270° @ 15kt G25');
  });

  it('falls back to structured fields when there is no raw observation', () => {
    expect(parseMetarQuick({ temp: 12.4, wspd: 9, wdir: 250, visib: '6+', clouds: [{ cover: 'BKN', base: 1800 }] })).toEqual({
      temp: '12°C / 54°F',
      wind: '250° @ 9kt',
      vis: '6+ SM',
      clouds: 'Broken 1800ft',
    });
  });

  it('renders all-placeholder output for empty and missing input (edge case)', () => {
    const blank = { temp: '--', wind: '--', vis: '--', clouds: '--' };
    expect(parseMetarQuick('')).toEqual(blank);
    expect(parseMetarQuick(null)).toEqual(blank);
    expect(parseMetarQuick({})).toEqual(blank);
  });

  it('misreads a fractional visibility as its denominator (edge case — quirk preserved)', () => {
    // "1/2SM" — the `\b(\d+)\s*SM\b` branch matches "2SM" first, so half-mile fog
    // reads as "2 SM". Carried over from main.js unchanged.
    expect(parseMetarQuick(SFO_FOG).vis).toBe('2 SM');
  });
});

describe('applyStructuredMetarFallback', () => {
  const blank = () => ({ temp: '--', wind: '--', vis: '--', clouds: '--' });

  it('fills only the fields the raw parse left blank', () => {
    const parsed = { temp: '9°C / 48°F', wind: '--', vis: '--', clouds: '--' };
    const out = applyStructuredMetarFallback(parsed, { temp: 20, wspd: 12, wdir: 90, visib: 8, cover: 'CLR' });
    expect(out.temp).toBe('9°C / 48°F'); // untouched
    expect(out.wind).toBe('090° @ 12kt');
  });

  it('zero-pads wind direction to three digits', () => {
    expect(applyStructuredMetarFallback(blank(), { wspd: 12, wdir: 7 }).wind).toBe('007° @ 12kt');
  });

  it('reports Calm for zero wind speed and drops the direction when there is none', () => {
    expect(applyStructuredMetarFallback(blank(), { wspd: 0, wdir: 250 }).wind).toBe('Calm');
    expect(applyStructuredMetarFallback(blank(), { wspd: 14 }).wind).toBe('14kt');
  });

  it('reads CLR/SKC cover as Clear and a layer as name + base', () => {
    expect(applyStructuredMetarFallback(blank(), { cover: 'SKC' }).clouds).toBe('Clear');
    expect(applyStructuredMetarFallback(blank(), { clouds: [{ cover: 'OVC', base: 400 }] }).clouds).toBe('Overcast 400ft');
  });

  it('returns the parse untouched when there is no structured payload (edge case)', () => {
    const parsed = blank();
    expect(applyStructuredMetarFallback(parsed, null)).toBe(parsed);
    expect(applyStructuredMetarFallback(parsed, 'KORD ...')).toBe(parsed);
    expect(parsed).toEqual(blank());
  });

  it('leaves clouds blank when cover is a layer name with no base (edge case)', () => {
    expect(applyStructuredMetarFallback(blank(), { cover: 'BKN' }).clouds).toBe('--');
  });
});

describe('hasRenderableMetarData', () => {
  it('is true when there is a raw observation or any usable structured field', () => {
    expect(hasRenderableMetarData({ rawOb: ORD })).toBe(true);
    expect(hasRenderableMetarData({ temp: 0 })).toBe(true);
    expect(hasRenderableMetarData({ clouds: [{ cover: 'OVC' }] })).toBe(true);
    expect(hasRenderableMetarData({ cover: 'CLR' })).toBe(true);
  });

  it('is false for an empty payload', () => {
    expect(hasRenderableMetarData({})).toBe(false);
  });

  it('is false for anything that is not an object (edge case)', () => {
    expect(hasRenderableMetarData(null)).toBe(false);
    expect(hasRenderableMetarData(undefined)).toBe(false);
    expect(hasRenderableMetarData(ORD)).toBe(false);
  });

  it('does not count a whitespace-only visibility string (edge case)', () => {
    expect(hasRenderableMetarData({ visib: '   ' })).toBe(false);
    expect(hasRenderableMetarData({ visib: '10' })).toBe(true);
  });
});

describe('explainMETAR', () => {
  it('narrates a clear VFR day at a named hub', () => {
    expect(explainMETAR(DEN_CLR, 'DEN', 'VFR')).toBe(
      'Denver International is currently reporting VFR conditions. Winds from the north at 0 knots. Visibility is 10 statute miles. Clear skies. Temperature is 5°C (41°F). altimeter setting of 30.24 inHg. Clear skies, good visibility — no impact on operations.'
    );
  });

  it('escalates the assessment for LIFR', () => {
    expect(explainMETAR(SFO_FOG, 'SFO', 'LIFR')).toBe(
      'San Francisco is currently reporting LIFR conditions. Winds from the west-southwest at 8 knots. Visibility is 2 statute miles. overcast ceiling at 200 feet. fog. Temperature is 12°C (54°F). altimeter setting of 29.98 inHg. Very low ceilings/visibility — major operational impact, expect ground stops and diversions.'
    );
  });

  it('lists the contributing conditions for IFR', () => {
    expect(explainMETAR(EWR_SN, 'EWR', 'IFR')).toBe(
      'Newark is currently reporting IFR conditions. Winds from the north-northeast at 18 knots gusting to 32. Visibility is 2 statute miles. broken ceiling at 800 feet. light snow. Temperature is -1°C (30°F). altimeter setting of 29.75 inHg. Instrument conditions with winter weather active, strong/gusty winds, low ceilings — expect significant delays and possible diversions.'
    );
  });

  it('flags gusty VFR as worth watching rather than "no impact"', () => {
    expect(explainMETAR(ORD, 'ORD', 'VFR')).toBe(
      "O'Hare is currently reporting VFR conditions. Winds from the west at 15 knots gusting to 25. Visibility is 10 statute miles. few clouds at 25,000 feet. Temperature is -2°C (28°F). altimeter setting of 30.12 inHg. Gusty conditions — monitor for changes."
    );
  });

  it('names an unknown hub and category verbatim (edge case)', () => {
    expect(explainMETAR(DEN_CLR, 'ZZZ', '')).toContain('ZZZ is currently reporting unknown conditions');
  });

  it('returns an empty string with no observation (edge case)', () => {
    expect(explainMETAR('', 'ORD', 'VFR')).toBe('');
    expect(explainMETAR(null, 'ORD', 'VFR')).toBe('');
  });
});
