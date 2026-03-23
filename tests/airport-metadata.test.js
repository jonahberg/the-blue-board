import { describe, expect, it } from 'vitest';
import { getMetarStationForIata, icaoToIata, isInternationalRoute } from '../src/lib/airport-metadata.js';

describe('airport metadata', () => {
  it('maps domestic airports to K-prefixed METAR stations', () => {
    expect(getMetarStationForIata('LGA')).toBe('KLGA');
    expect(getMetarStationForIata('ord')).toBe('KORD');
  });

  it('maps international airports through shared ICAO overrides', () => {
    expect(getMetarStationForIata('NRT')).toBe('RJAA');
    expect(getMetarStationForIata('GUM')).toBe('PGUM');
    expect(getMetarStationForIata('MNL')).toBe('RPLL');
  });

  it('returns empty station for unsupported airports', () => {
    expect(getMetarStationForIata('ZZZ')).toBe('');
    expect(getMetarStationForIata('')).toBe('');
  });

  it('shares ICAO to IATA normalization across APIs', () => {
    expect(icaoToIata('KLGA')).toBe('LGA');
    expect(icaoToIata('RJAA')).toBe('NRT');
    expect(icaoToIata('RCKH')).toBe('KHH');
  });

  it('classifies domestic and international routes consistently', () => {
    expect(isInternationalRoute('ORD', 'LGA')).toBe(false);
    expect(isInternationalRoute('ORD', 'NRT')).toBe(true);
    expect(isInternationalRoute('GUM', 'HNL')).toBe(false);
  });
});
