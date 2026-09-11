import { describe, it, expect } from 'vitest';
import { indexSpecialAircraft, ENGINE_BY_TYPE, SEAT_BAR_COLORS, CABIN_COLORS } from '../src/lib/special-aircraft.js';

// Rows shaped like /data/fleet.json: r = registration, t = type, s = the free-text
// "special" column the fleet site publishes.
const FLEET = [
  { r: 'N37502', t: '737 MAX 9', s: '*Spirit of Chicago*' },
  { r: 'N26902', t: '787-9', s: '100 Year Sticker' },
  { r: 'N27957', t: '737-900ER', s: 'Eco Demonstrator Explorer livery' },
  { r: 'N12345', t: '737-800', s: '' },
  { r: 'N99999', t: 'A320' },
];

describe('indexSpecialAircraft', () => {
  it('indexes asterisk-wrapped names as named aircraft, with the asterisks stripped', () => {
    const idx = indexSpecialAircraft(FLEET);
    expect(idx.get('N37502')).toEqual({ name: 'Spirit of Chicago', type: 'named' });
  });

  it('recognises the two special liveries by pattern and normalises their names', () => {
    const idx = indexSpecialAircraft(FLEET);
    expect(idx.get('N26902')).toEqual({ name: '100 Year Sticker', type: 'livery' });
    // Note the canonical name, not the raw column text.
    expect(idx.get('N27957')).toEqual({ name: 'Eco Demonstrator Explorer', type: 'livery' });
  });

  it('skips aircraft with an empty or absent special column', () => {
    const idx = indexSpecialAircraft(FLEET);
    expect(idx.has('N12345')).toBe(false);
    expect(idx.has('N99999')).toBe(false);
    expect(idx.size).toBe(3);
  });

  it('matches the livery patterns case-insensitively and anywhere in the string', () => {
    const idx = indexSpecialAircraft([
      { r: 'N1', s: 'now wearing the 100 YEAR STICKER' },
      { r: 'N2', s: 'eco demonstrator testbed' },
    ]);
    expect(idx.get('N1')).toEqual({ name: '100 Year Sticker', type: 'livery' });
    expect(idx.get('N2')).toEqual({ name: 'Eco Demonstrator Explorer', type: 'livery' });
  });

  it('trims whitespace inside the asterisks and handles doubled asterisks (edge case)', () => {
    const idx = indexSpecialAircraft([{ r: 'N3', s: '**  Friend Ship  **' }]);
    expect(idx.get('N3')).toEqual({ name: 'Friend Ship', type: 'named' });
  });

  it('returns an empty Map for an empty or missing fleet (edge case)', () => {
    expect(indexSpecialAircraft([]).size).toBe(0);
    expect(indexSpecialAircraft(null).size).toBe(0);
    expect(indexSpecialAircraft(undefined).size).toBe(0);
  });

  it('prefers the named rule over the livery rule when both could match (edge case)', () => {
    const idx = indexSpecialAircraft([{ r: 'N4', s: '*100 Year Sticker*' }]);
    expect(idx.get('N4')).toEqual({ name: '100 Year Sticker', type: 'named' });
  });
});

describe('ENGINE_BY_TYPE', () => {
  it('names the engine for each mainline type', () => {
    expect(ENGINE_BY_TYPE['777-300ER']).toBe('GE90-115B');
    expect(ENGINE_BY_TYPE['737 MAX 9']).toBe('CFM LEAP-1B28');
    expect(ENGINE_BY_TYPE['A321neo']).toBe('CFM LEAP-1A');
  });

  it('covers all 19 mainline types', () => {
    expect(Object.keys(ENGINE_BY_TYPE)).toHaveLength(19);
  });

  it('is undefined for regional/partner types the aircraft modal falls back on (edge case)', () => {
    expect(ENGINE_BY_TYPE['E175']).toBeUndefined();
    expect(ENGINE_BY_TYPE['']).toBeUndefined();
  });
});

describe('SEAT_BAR_COLORS', () => {
  it('gives each cabin its translucent bar colour', () => {
    expect(SEAT_BAR_COLORS.J).toBe('rgba(0,93,170,.5)');
    expect(SEAT_BAR_COLORS.F).toBe('rgba(139,92,246,.5)');
    expect(SEAT_BAR_COLORS['E+']).toBe('rgba(34,197,94,.5)');
  });

  it('shares one colour between the two premium-economy spellings', () => {
    expect(SEAT_BAR_COLORS.PP).toBe('rgba(20,184,166,.5)');
    expect(SEAT_BAR_COLORS.PE).toBe(SEAT_BAR_COLORS.PP);
  });

  it('has no entry for unknown cabins — the caller supplies the slate fallback (edge case)', () => {
    expect(SEAT_BAR_COLORS.X).toBeUndefined();
    expect(SEAT_BAR_COLORS.Y).toBe('rgba(100,116,139,.5)');
  });
});

describe('CABIN_COLORS', () => {
  it('gives each cabin its solid config-gallery colour', () => {
    expect(CABIN_COLORS.J).toBe('#2563eb');
    expect(CABIN_COLORS.F).toBe('#7c3aed');
    expect(CABIN_COLORS['E+']).toBe('#16a34a');
    expect(CABIN_COLORS.Domestic).toBe('#6366f1');
  });

  it('shares one colour between PP and PE here too', () => {
    expect(CABIN_COLORS.PP).toBe('#0d9488');
    expect(CABIN_COLORS.PE).toBe('#0d9488');
  });

  it('is a different palette from the seat bars (edge case — do not conflate them)', () => {
    expect(CABIN_COLORS.J).not.toBe(SEAT_BAR_COLORS.J);
    expect(CABIN_COLORS.Y).toBe('#475569');
  });
});
