import { describe, it, expect } from 'vitest';
import { shapeJourney, journeyDelayClass, buildJourneyContextStr, resolveJourneyStatuses } from '../src/lib/journey.js';

const seg = (flightNumber, origin, destination, delayMin = 0, status = 'Landed') =>
  ({ flightNumber, origin, destination, delayMin, status });

describe('shapeJourney', () => {
  it('drops our own flight and returns the prior segments oldest-first', () => {
    const out = shapeJourney([
      seg('UA900', 'SFO', 'ORD', 10),
      seg('UA800', 'DEN', 'SFO', 0),
      seg('UA373', 'ORD', 'DEN', 5), // our flight — excluded
    ], 'UA373', 'ORD', 'DEN');
    expect(out.prior.map((s) => s.flightNumber)).toEqual(['UA800', 'UA900']);
  });

  it('keeps at most three prior segments, the three most recent', () => {
    const out = shapeJourney([
      seg('UA900', 'A', 'B'), seg('UA800', 'B', 'C'), seg('UA700', 'C', 'D'), seg('UA600', 'D', 'E'),
    ], 'UA373', 'ORD', 'DEN');
    expect(out.prior.map((s) => s.flightNumber)).toEqual(['UA700', 'UA800', 'UA900']);
  });

  it('describes the current flight from the route arguments', () => {
    const out = shapeJourney([seg('UA900', 'SFO', 'ORD')], 'UA373', 'ORD', 'DEN');
    expect(out.current).toEqual({ flightNumber: 'UA373', origin: 'ORD', destination: 'DEN' });
  });

  it('returns no prior segments when the history holds only our own flight (edge case)', () => {
    const out = shapeJourney([seg('UA373', 'ORD', 'DEN')], 'UA373', 'ORD', 'DEN');
    expect(out.prior).toEqual([]);
    expect(out.current.flightNumber).toBe('UA373');
  });

  it('handles an empty or missing history (edge case)', () => {
    expect(shapeJourney([], 'UA373', 'ORD', 'DEN').prior).toEqual([]);
    expect(shapeJourney(null, 'UA373', 'ORD', 'DEN').prior).toEqual([]);
  });
});

describe('journeyDelayClass', () => {
  it('bands delays as on-time, minor and major', () => {
    expect(journeyDelayClass(0)).toBe('on-time');
    expect(journeyDelayClass(5)).toBe('on-time');
    expect(journeyDelayClass(6)).toBe('minor');
    expect(journeyDelayClass(45)).toBe('minor');
    expect(journeyDelayClass(46)).toBe('major');
  });

  it('treats an early departure as on time', () => {
    expect(journeyDelayClass(-10)).toBe('on-time');
  });

  it('returns an empty class for a null delay, but NOT for undefined (edge case)', () => {
    // Rule carried over from the legacy main.js (now used by src/app/views/myflight/tone.ts):
    // `delay === null ? '' : delay <= 5 ? 'on-time' : delay <= 45 ? 'minor' : 'major'`.
    // `undefined <= 5` and `undefined <= 45` are both false, so a missing delayMin has
    // always rendered as 'major'. Preserved deliberately — do not "fix" it here.
    expect(journeyDelayClass(null)).toBe('');
    expect(journeyDelayClass(undefined)).toBe('major');
  });
});

describe('buildJourneyContextStr', () => {
  it('narrates each prior segment with its delay and status', () => {
    const shaped = shapeJourney([
      seg('UA900', 'SFO', 'ORD', 25, 'Landed'),
      seg('UA800', 'DEN', 'SFO', 0, 'Landed'),
    ], 'UA373', 'ORD', 'DEN');
    const out = buildJourneyContextStr('N37502', shaped);
    expect(out.split('\n')).toEqual([
      'Aircraft N37502 journey today:',
      'Seg 1: UA800 DEN→SFO, on time, landed',
      'Seg 2: UA900 SFO→ORD, departed 25min late, landed',
      'Your flight UA373 ORD→DEN — aircraft averaging +25min delays across 1 prior segment',
    ]);
  });

  it('marks an airborne segment and pluralises the summary', () => {
    const shaped = shapeJourney([
      seg('UA900', 'SFO', 'ORD', 30, 'en-route'),
      seg('UA800', 'DEN', 'SFO', 10, 'Arrived'),
    ], 'UA373', 'ORD', 'DEN');
    const out = buildJourneyContextStr('N37502', shaped);
    expect(out).toContain('Seg 1: UA800 DEN→SFO, departed 10min late, landed');
    expect(out).toContain('Seg 2: UA900 SFO→ORD, departed 30min late, currently airborne');
    expect(out).toContain('averaging +20min delays across 2 prior segments');
  });

  it('omits the summary line when nothing ran late', () => {
    const shaped = shapeJourney([seg('UA900', 'SFO', 'ORD', 0, 'Landed')], 'UA373', 'ORD', 'DEN');
    const out = buildJourneyContextStr('N37502', shaped);
    expect(out).not.toContain('averaging');
    expect(out.split('\n')).toHaveLength(2);
  });

  it('says "unknown delay" when the segment has no delay figure (edge case)', () => {
    const shaped = shapeJourney([seg('UA900', 'SFO', 'ORD', null, 'Landed')], 'UA373', 'ORD', 'DEN');
    expect(buildJourneyContextStr('N37502', shaped)).toContain('UA900 SFO→ORD, unknown delay, landed');
  });

  it('returns an empty string when there are no prior segments (edge case)', () => {
    const shaped = shapeJourney([], 'UA373', 'ORD', 'DEN');
    expect(buildJourneyContextStr('N37502', shaped)).toBe('');
  });
});

// D8 (live audit Sep 28 2026): earlier legs in the Aircraft Journey read "unknown". Resolve them
// from the hub boards (production row shape) and from the tail's own later legs.
describe('resolveJourneyStatuses (D8)', () => {
  const NOW = Date.parse('2026-09-28T18:00:00Z');
  const s = (flightNumber, origin, destination, over = {}) => ({
    flightNumber, origin, destination, status: 'unknown', delayMin: null,
    departure: { scheduled: '', actual: '' }, arrival: { scheduled: '', actual: '', estimated: '' }, ...over,
  });
  const boardRow = (flight, from, to, text, schedArrIso) => ({
    identification: { number: { default: flight } },
    airport: { origin: { code: { iata: from } }, destination: { code: { iata: to } } },
    status: { text, generic: { status: { text } } },
    time: { scheduled: { arrival: schedArrIso ? Date.parse(schedArrIso) / 1000 : null } },
  });

  it('takes landed/arrived from the hub board row for that leg', () => {
    const out = resolveJourneyStatuses([s('UA1532', 'DEN', 'ORD')], [boardRow('UA1532', 'DEN', 'ORD', 'landed')], NOW);
    expect(out[0].status).toBe('landed');
  });

  it('a leg whose scheduled arrival is well past and whose tail has since departed again is landed', () => {
    const segments = [
      s('UA2106', 'ORD', 'SFO', { departure: { scheduled: '', actual: '2026-09-28T16:40:00Z' }, status: 'en-route' }),
      s('UA1532', 'DEN', 'ORD'),
    ];
    const rows = [boardRow('UA1532', 'DEN', 'ORD', 'expected', '2026-09-28T15:10:00Z')];
    const out = resolveJourneyStatuses(segments, rows, NOW);
    expect(out[1].status).toBe('landed');
    expect(out[0].status).toBe('en-route');
  });

  it('an actual arrival is landed', () => {
    const out = resolveJourneyStatuses([s('UA1', 'SFO', 'ORD', { arrival: { scheduled: '', actual: '2026-09-28T12:00:00Z', estimated: '' } })], [], NOW);
    expect(out[0].status).toBe('landed');
  });

  it('leaves a genuinely unknown leg alone rather than guessing', () => {
    const out = resolveJourneyStatuses([s('UA7', 'SFO', 'ORD')], [], NOW);
    expect(out[0].status).toBe('unknown');
  });

  it('passes null through (history not loaded yet)', () => {
    expect(resolveJourneyStatuses(null, [], NOW)).toBeNull();
  });
});
