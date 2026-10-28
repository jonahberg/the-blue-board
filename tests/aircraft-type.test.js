import { describe, it, expect } from 'vitest';

import { fleetTypeForReg, withFleetType } from '../src/lib/aircraft-type.js';

const FLEET = {
  N653UA: { r: 'N653UA', t: '767-300ER' },
  N15712: { r: 'N15712', t: '737-700' },
  N27503: { r: 'N27503', t: '737 MAX 9' },
  N4888U: { r: 'N4888U', t: 'A319' },
  N68834: { r: 'N68834', t: '737-900ER' },
  N784UA: { r: 'N784UA', t: '777-200ER' },
};
const EXPRESS = {
  N10156: { r: 'N10156', t: 'ERJ145' },
  N605UX: { r: 'N605UX', t: 'E175' },
  N501GJ: { r: 'N501GJ', t: 'CRJ550' },
  N9X: { r: 'N9X', t: '' },
};

/** The reader's row (Oct 7 2026): UA146 EWR→LHR, a tail and no type code. */
const UA146 = {
  identification: { number: { default: 'UA146' } },
  aircraft: { model: { code: '', text: 'Boeing 767' }, registration: 'N653UA' },
};

describe('fleetTypeForReg', () => {
  it('maps a mainline tail to the feed’s ICAO code', () => {
    expect(fleetTypeForReg('N653UA', FLEET)).toEqual({ code: 'B763', text: 'Boeing 767-300ER', source: 'fleet-db' });
    expect(fleetTypeForReg('N27503', FLEET).code).toBe('B39M');
    expect(fleetTypeForReg('N4888U', FLEET)).toEqual({ code: 'A319', text: 'Airbus A319', source: 'fleet-db' });
    // Types ICAO_TO_FLEET_TYPE cannot reverse: the codes the feed actually sends for them.
    expect(fleetTypeForReg('N68834', FLEET).code).toBe('B739');
    expect(fleetTypeForReg('N784UA', FLEET).code).toBe('B772');
  });

  it('falls back to the United Express database', () => {
    expect(fleetTypeForReg('N10156', FLEET, EXPRESS)).toEqual({ code: 'E145', text: 'Embraer RJ145', source: 'express-db' });
    expect(fleetTypeForReg('N605UX', FLEET, EXPRESS).code).toBe('E175');
    expect(fleetTypeForReg('N501GJ', FLEET, EXPRESS).code).toBe('CRJ7');
  });

  it('is null for an unknown tail, an unknown type, or no tail', () => {
    expect(fleetTypeForReg('N00000', FLEET, EXPRESS)).toBeNull();
    expect(fleetTypeForReg('N9X', FLEET, EXPRESS)).toBeNull();
    expect(fleetTypeForReg('', FLEET, EXPRESS)).toBeNull();
  });
});

describe('withFleetType', () => {
  it('fills UA146’s blank code from N653UA', () => {
    const typed = withFleetType(UA146, 'N653UA', FLEET, EXPRESS);
    expect(typed.aircraft.model).toEqual({ code: 'B763', text: 'Boeing 767-300ER', source: 'fleet-db' });
    expect(typed.aircraft.registration).toBe('N653UA');
    expect(UA146.aircraft.model.code).toBe(''); // shared cache rows are never mutated
  });

  it('replaces the provider’s wrong text along with the blank code (N15712 "Boeing 707-300")', () => {
    const row = { aircraft: { model: { code: '', text: 'Boeing 707-300' }, registration: 'N15712' } };
    expect(withFleetType(row, 'N15712', FLEET).aircraft.model.text).toBe('Boeing 737-700');
  });

  it('never overrides a code the provider sent, and returns the same row when it has nothing', () => {
    const coded = { aircraft: { model: { code: 'B764', text: 'Boeing 767-400' }, registration: 'N653UA' } };
    expect(withFleetType(coded, 'N653UA', FLEET)).toBe(coded);
    const unknown = { aircraft: { model: { code: '', text: 'Boeing 737' }, registration: '' } };
    expect(withFleetType(unknown, '', FLEET, EXPRESS)).toBe(unknown);
  });
});
