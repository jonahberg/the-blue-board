import { describe, it, expect } from 'vitest';
import { cancellationKind, isCanceledUncertainStatus } from '../src/lib/cancellation.js';
import { mapAeroStatus } from '../api/_schedule-aerodatabox.js';

const row = (status, { realDep = null, realArr = null } = {}) => ({
  status,
  time: { scheduled: { departure: 1_700_000_000, arrival: 1_700_010_000 }, real: { departure: realDep, arrival: realArr } },
});
const generic = (text, type = '') => ({ generic: { status: { text }, type }, text });

describe('isCanceledUncertainStatus — the one definition of the soft "Likely Canceled" state', () => {
  it('recognises the AeroDataBox normalizer output', () => {
    expect(isCanceledUncertainStatus(mapAeroStatus('CanceledUncertain'))).toBe(true);
    expect(isCanceledUncertainStatus(mapAeroStatus('Canceled'))).toBe(false);
    expect(isCanceledUncertainStatus(mapAeroStatus('Departed'))).toBe(false);
  });
  it('recognises the type field and raw run-on provider text (old cached payloads)', () => {
    expect(isCanceledUncertainStatus({ generic: { status: { text: '' }, type: 'canceled_uncertain' } })).toBe(true);
    expect(isCanceledUncertainStatus({ text: 'CanceledUncertain' })).toBe(true);
    expect(isCanceledUncertainStatus({ text: 'Canceled uncertain' })).toBe(true);
  });
  it('is false for garbage', () => {
    expect(isCanceledUncertainStatus(null)).toBe(false);
    expect(isCanceledUncertainStatus(undefined)).toBe(false);
    expect(isCanceledUncertainStatus({})).toBe(false);
  });
});

describe('cancellationKind', () => {
  it('confirmed for canceled / cancelled', () => {
    expect(cancellationKind(row(generic('canceled', 'canceled')))).toBe('confirmed');
    expect(cancellationKind(row(generic('cancelled')))).toBe('confirmed');
  });

  it('likely for canceled_uncertain with no real time on the board side', () => {
    expect(cancellationKind(row(generic('canceled_uncertain', 'canceled_uncertain')))).toBe('likely');
    expect(cancellationKind(row(generic('canceled_uncertain')), 'arrivals')).toBe('likely');
  });

  it('a real time on the board side wins — the classifier already shows Departed/Landed', () => {
    expect(cancellationKind(row(generic('canceled_uncertain'), { realDep: 1_700_000_600 }))).toBeNull();
    expect(cancellationKind(row(generic('canceled_uncertain'), { realArr: 1_700_010_600 }), 'arrivals')).toBeNull();
    // A real DEPARTURE says nothing about the arrival: still likely on an arrivals board.
    expect(cancellationKind(row(generic('canceled_uncertain'), { realDep: 1_700_000_600 }), 'arrivals')).toBe('likely');
  });

  it('null for everything that is not a cancellation', () => {
    for (const t of ['departed', 'landed', 'scheduled', 'en-route', 'diverted', '']) {
      expect(cancellationKind(row(generic(t)))).toBeNull();
    }
    expect(cancellationKind(null)).toBeNull();
    expect(cancellationKind({})).toBeNull();
  });
});
