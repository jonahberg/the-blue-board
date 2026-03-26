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

  it('returns empty string for unknown equipment', () => {
    expect(getScheduleFleetFamily('CRJ7', 'Canadair Regional Jet')).toBe('');
  });
});
