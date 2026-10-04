// The words behind the board's evidence markers (v1.13.0): a feed-proven landing, a bounded delay,
// a delay measured to a runway time. Shared by the desktop table and the phone row.
import { describe, expect, it } from 'vitest';

import { delayFigure, runwayDelayMarker, statusEvidenceNote } from '../src/lib/schedule-row-display.js';
import { delayCell } from '../src/lib/schedule-row-model.js';

describe('statusEvidenceNote', () => {
  it('a feed-proven landing says "seen landing", never "no live update"', () => {
    const note = statusEvidenceNote({ text: 'Landed', presumed: true, seenLanded: true });
    expect(note.text).toBe('seen landing');
    expect(note.note).toBe('seen landing on the live feed');
    expect(note.title).toMatch(/airborne on this leg, then on the ground at the destination/);
    expect(JSON.stringify(note)).not.toMatch(/no live update/);
  });

  it('seen landing wins over seen airborne (the Likely-Canceled override can set both)', () => {
    expect(statusEvidenceNote({ presumed: true, seen: true, seenLanded: true }).text).toBe('seen landing');
  });

  it('seen airborne, then presumed, then nothing', () => {
    expect(statusEvidenceNote({ seen: true }).text).toBe('seen airborne');
    expect(statusEvidenceNote({ presumed: true }).text).toBe('presumed (no live update)');
    expect(statusEvidenceNote({ presumed: false })).toBeNull();
    expect(statusEvidenceNote(null)).toBeNull();
  });
});

describe('delayFigure', () => {
  it('splits the bound glyph from the figure and says it in words', () => {
    expect(delayFigure({ text: '≥+66m', bound: 'lower' })).toEqual({ glyph: '≥', sr: 'at least ', value: '+66m' });
    expect(delayFigure({ text: '≤+1h06m', bound: 'upper' })).toEqual({ glyph: '≤', sr: 'at most ', value: '+1h06m' });
  });

  it('reads the glyph even when the bound field is missing (an older cached row)', () => {
    expect(delayFigure({ text: '≥+12m' })).toEqual({ glyph: '≥', sr: 'at least ', value: '+12m' });
  });

  it('passes a plain figure through', () => {
    expect(delayFigure({ text: '+208m' })).toEqual({ glyph: '', sr: '', value: '+208m' });
    expect(delayFigure({ text: '−5m' })).toEqual({ glyph: '', sr: '', value: '−5m' });
    expect(delayFigure(null)).toEqual({ glyph: '', sr: '', value: '' });
  });

  it('round-trips what delayCell() actually builds', () => {
    const cell = delayCell({
      statusKey: 'landed',
      presumed: true,
      schedTimeSec: 1_000_000,
      actualTimeSec: 1_000_000 + 66 * 60,
      hasRealTime: true,
      dir: 'arrivals',
      risk: null,
      basis: 'sighting',
      bound: 'lower',
    });
    expect(cell.text).toBe('≥+66m');
    expect(delayFigure(cell)).toEqual({ glyph: '≥', sr: 'at least ', value: '+66m' });
  });
});

describe('runwayDelayMarker', () => {
  const runway = { kind: 'delta', basis: 'runway', text: '+38m', minutes: 38 };

  it('departures: from takeoff time, includes taxi', () => {
    expect(runwayDelayMarker(runway, 'departures', true)).toEqual({ kind: 'takeoff', note: 'from takeoff time; includes taxi' });
  });

  it('arrivals: from touchdown, before taxi-in', () => {
    expect(runwayDelayMarker(runway, 'arrivals', true)).toEqual({ kind: 'touchdown', note: 'from touchdown time; before taxi-in' });
  });

  it('only a runway-based delta: not a gate time, not a sighting that overrode it, not a prediction', () => {
    expect(runwayDelayMarker({ ...runway, basis: 'gate' }, 'departures', false)).toBeNull();
    expect(runwayDelayMarker({ ...runway, basis: 'sighting' }, 'departures', true)).toBeNull();
    expect(runwayDelayMarker({ kind: 'risk' }, 'departures', true)).toBeNull();
    expect(runwayDelayMarker({ kind: 'none' }, 'departures', true)).toBeNull();
  });

  it('falls back to actualFromRunway when the delta carries no basis', () => {
    expect(runwayDelayMarker({ kind: 'delta', text: '+9m', minutes: 9 }, 'departures', true)?.kind).toBe('takeoff');
    expect(runwayDelayMarker({ kind: 'delta', text: '+9m', minutes: 9 }, 'departures', false)).toBeNull();
  });
});
