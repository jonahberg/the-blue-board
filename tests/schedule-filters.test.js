import { describe, expect, it } from 'vitest';

import { getScheduleFleetFamily } from '../src/lib/schedule-filters.js';

describe('getScheduleFleetFamily', () => {
  it('maps 777 variants to the 777 family', () => {
    expect(getScheduleFleetFamily('B772', 'Boeing 777-200')).toBe('777');
    expect(getScheduleFleetFamily('77W', 'Boeing 777-300ER')).toBe('777');
  });

  it('maps Airbus narrowbody variants to the A320 family', () => {
    expect(getScheduleFleetFamily('A319', 'Airbus A319')).toBe('A320');
    expect(getScheduleFleetFamily('32N', 'Airbus A321neo')).toBe('A320');
  });

  it('maps Dreamliner variants to the 787 family', () => {
    expect(getScheduleFleetFamily('B78X', 'Boeing 787-10 Dreamliner')).toBe('787');
  });

  it('maps 737 variants to the 737 family', () => {
    expect(getScheduleFleetFamily('B738', 'Boeing 737-800')).toBe('737');
    expect(getScheduleFleetFamily('7M8', 'Boeing 737 MAX 8')).toBe('737');
    expect(getScheduleFleetFamily('73G', '')).toBe('737');
  });

  it('maps 757 variants to the 757 family', () => {
    expect(getScheduleFleetFamily('B752', 'Boeing 757-200')).toBe('757');
    expect(getScheduleFleetFamily('753', '')).toBe('757');
  });

  it('maps 767 variants to the 767 family', () => {
    expect(getScheduleFleetFamily('B764', 'Boeing 767-400ER')).toBe('767');
    expect(getScheduleFleetFamily('763', '')).toBe('767');
  });

  it('falls back to text when code is unknown', () => {
    expect(getScheduleFleetFamily('', 'Boeing 787-9')).toBe('787');
    expect(getScheduleFleetFamily('', 'Airbus A321neo')).toBe('A320');
    expect(getScheduleFleetFamily('', 'Dreamliner')).toBe('787');
  });

  it('handles null/undefined inputs', () => {
    expect(getScheduleFleetFamily(null)).toBe('');
    expect(getScheduleFleetFamily(undefined, undefined)).toBe('');
  });

  it('classifies FR24 ICAO codes with empty model text', () => {
    // FR24 official-API and live-feed normalizers emit ICAO type codes with
    // model.text === '' (api/schedule.ts), so the code branch must stand alone.
    expect(getScheduleFleetFamily('B38M', '')).toBe('737'); // 737 MAX 8
    expect(getScheduleFleetFamily('B39M', '')).toBe('737'); // 737 MAX 9
    expect(getScheduleFleetFamily('A21N', '')).toBe('A320'); // A321neo
    expect(getScheduleFleetFamily('A20N', '')).toBe('A320'); // A320neo
    expect(getScheduleFleetFamily('E75L', '')).toBe('E175'); // Embraer 175
  });

  it('returns empty string for unknown equipment', () => {
    expect(getScheduleFleetFamily('CRJ7', 'Canadair Regional Jet')).toBe('');
  });
});
