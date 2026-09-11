import { describe, it, expect } from 'vitest';
import { AIRPORTS, AIRPORT_COORDS, IATA_CITIES, cityFor, nearestAirport } from '../src/lib/airports.js';

describe('AIRPORTS', () => {
  it('carries the full table with one entry per IATA code', () => {
    // 142 rows today — the `(150 airports)` comment in main.js was never trued up.
    expect(AIRPORTS).toHaveLength(142);
    expect(new Set(AIRPORTS.map((a) => a.iata)).size).toBe(AIRPORTS.length);
  });

  it('flags exactly the nine United hubs', () => {
    expect(AIRPORTS.filter((a) => a.hub).map((a) => a.iata)).toEqual([
      'EWR', 'IAH', 'ORD', 'DEN', 'SFO', 'LAX', 'IAD', 'GUM', 'NRT',
    ]);
  });

  it('keeps hub coordinates byte-for-byte', () => {
    expect(AIRPORTS.find((a) => a.iata === 'ORD')).toEqual({ iata: 'ORD', lat: 41.9742, lon: -87.9073, hub: true });
    expect(AIRPORTS.find((a) => a.iata === 'GUM')).toEqual({ iata: 'GUM', lat: 13.4834, lon: 144.796, hub: true });
  });

  it('gives every row a finite lat/lon (edge case — a NaN would poison every distance)', () => {
    for (const a of AIRPORTS) {
      expect(Number.isFinite(a.lat), `${a.iata} lat`).toBe(true);
      expect(Number.isFinite(a.lon), `${a.iata} lon`).toBe(true);
      expect(a.lat).toBeGreaterThanOrEqual(-90);
      expect(a.lat).toBeLessThanOrEqual(90);
    }
  });
});

describe('AIRPORT_COORDS', () => {
  it('indexes every airport by IATA code', () => {
    expect(Object.keys(AIRPORT_COORDS)).toHaveLength(AIRPORTS.length);
    expect(AIRPORT_COORDS.SFO).toEqual({ iata: 'SFO', lat: 37.6213, lon: -122.379, hub: true });
  });

  it('points at the same objects as the AIRPORTS array', () => {
    expect(AIRPORT_COORDS.LHR).toBe(AIRPORTS.find((a) => a.iata === 'LHR'));
  });

  it('is undefined for unknown codes (edge case — callers branch on truthiness)', () => {
    expect(AIRPORT_COORDS.ZZZ).toBeUndefined();
    expect(AIRPORT_COORDS['']).toBeUndefined();
  });
});

describe('IATA_CITIES', () => {
  it('names the hubs the way the popup header reads them', () => {
    expect(IATA_CITIES.ORD).toBe("Chicago O'Hare");
    expect(IATA_CITIES.IAD).toBe('Washington Dulles');
    expect(IATA_CITIES.EWR).toBe('Newark');
  });

  it('covers exactly the same IATA codes as AIRPORTS', () => {
    expect(Object.keys(IATA_CITIES).sort()).toEqual(AIRPORTS.map((a) => a.iata).sort());
  });

  it('keeps accented and apostrophised city names intact (edge case)', () => {
    expect(IATA_CITIES.GRU).toBe('São Paulo');
    expect(IATA_CITIES.BOG).toBe('Bogotá');
    expect(IATA_CITIES.SJC).toBe('San José');
    expect(IATA_CITIES.CUN).toBe('Cancún');
  });
});

describe('cityFor', () => {
  it('returns the city name for a known code', () => {
    expect(cityFor('DEN')).toBe('Denver');
    expect(cityFor('NRT')).toBe('Tokyo Narita');
  });

  it('returns an empty string for unknown codes so callers can use falsiness', () => {
    expect(cityFor('ZZZ')).toBe('');
    expect(cityFor('???')).toBe('');
  });

  it('returns an empty string for missing input (edge case)', () => {
    expect(cityFor('')).toBe('');
    expect(cityFor(null)).toBe('');
    expect(cityFor(undefined)).toBe('');
  });
});

describe('nearestAirport', () => {
  it('returns the airport a position sits on top of', () => {
    expect(nearestAirport(41.9742, -87.9073, 50)?.iata).toBe('ORD');
    expect(nearestAirport(40.7, -74.15, 50)?.iata).toBe('EWR');
  });

  it('returns the nearest airport inside the radius', () => {
    // 0.5° north of ANC ≈ 30 nm, and nothing else is within a thousand miles.
    expect(nearestAirport(61.6743, -149.9962, 50)?.iata).toBe('ANC');
  });

  it('returns null when the nearest airport is outside the radius', () => {
    expect(nearestAirport(61.6743, -149.9962, 10)).toBeNull();
    expect(nearestAirport(0, -150, 50)).toBeNull();
  });

  it('honours a generous radius over open ocean (edge case)', () => {
    // Mid-Pacific: KOA is 1237 nm away.
    expect(nearestAirport(0, -150, 1000)).toBeNull();
    expect(nearestAirport(0, -150, 1300)?.iata).toBe('KOA');
  });
});
