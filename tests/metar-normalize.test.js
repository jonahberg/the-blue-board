import { describe, it, expect } from 'vitest';
import { chunkMetarStationIds, normalizeMetarPayload } from '../src/lib/metar.js';

describe('normalizeMetarPayload', () => {
  it('accepts wrapped payloads and alternate field names', () => {
    const [record] = normalizeMetarPayload({
      metars: [{
        station: 'pgum',
        raw: 'METAR PGUM 182354Z 04013KT 10SM FEW065 28/19 A2992',
        category: 'vfr',
        vis: '10',
        wind_direction: 40,
        wind_speed: 13,
        temperature: 28,
        skyConditions: [{ skyCover: 'FEW', altitudeFt: 6500 }],
      }],
    });

    expect(record).toMatchObject({
      icaoId: 'PGUM',
      stationId: 'PGUM',
      id: 'PGUM',
      rawOb: 'METAR PGUM 182354Z 04013KT 10SM FEW065 28/19 A2992',
      fltCat: 'VFR',
      visib: '10',
      wdir: 40,
      wspd: 13,
      temp: 28,
      clouds: [{ cover: 'FEW', base: 6500 }],
    });
  });

  it('returns an empty list for non-array error payloads', () => {
    expect(normalizeMetarPayload({ error: 'rate limited' })).toEqual([]);
  });
});

describe('chunkMetarStationIds', () => {
  it('splits large station lists into API-safe chunks', () => {
    const chunks = chunkMetarStationIds([
      'KORD','KEWR','KIAH','KDEN','KSFO','KLAX','KIAD','RJAA','PGUM',
      'KLGA','KDCA','KRSW','KMCO','KBNA','KFLL','KSAN','KMSY','KCMH',
      'KPIT','KCLT','CYYZ','KPHL','KATL','KTPA','KPHX',
    ], 40);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 40)).toBe(true);
    expect(chunks.join(',')).toBe(
      'KORD,KEWR,KIAH,KDEN,KSFO,KLAX,KIAD,RJAA,PGUM,KLGA,KDCA,KRSW,KMCO,KBNA,KFLL,KSAN,KMSY,KCMH,KPIT,KCLT,CYYZ,KPHL,KATL,KTPA,KPHX'
    );
  });
});
