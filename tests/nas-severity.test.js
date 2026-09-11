import { describe, it, expect } from 'vitest';
import { SEV_LABELS, detectSevType, sevBadgeClass, tierNasEvents } from '../src/lib/nas-severity.js';

const HUBS = ['ORD', 'DEN', 'IAH', 'EWR', 'SFO', 'IAD', 'LAX', 'NRT', 'GUM'];

describe('SEV_LABELS', () => {
  it('spells out every traffic-management initiative the panel badges', () => {
    expect(SEV_LABELS.GS).toBe('Ground Stop');
    expect(SEV_LABELS.GDP).toBe('Ground Delay Program');
    expect(SEV_LABELS.SWAP).toBe('Severe Weather Avoidance');
    expect(SEV_LABELS.EDCT).toBe('Expect Departure Clearance Time');
  });

  it('covers the ten codes detectSevType can return', () => {
    expect(Object.keys(SEV_LABELS)).toEqual(['GS', 'GDP', 'AFP', 'MIT', 'MINIT', 'CDR', 'SWAP', 'EDCT', 'FCA', 'DSP']);
  });

  it('has no label for the OTHER catch-all (edge case — caller falls back to the raw code)', () => {
    expect(SEV_LABELS.OTHER).toBeUndefined();
  });
});

describe('detectSevType', () => {
  it('recognises ground stops by phrase and by abbreviation', () => {
    expect(detectSevType('GROUND STOP at EWR')).toBe('GS');
    expect(detectSevType('GS-EWR')).toBe('GS');
    expect(detectSevType('GDS-ORD')).toBe('GS');
  });

  it('recognises ground delay and airspace flow programs', () => {
    expect(detectSevType('GROUND DELAY PROGRAM')).toBe('GDP');
    expect(detectSevType('GDP-ORD')).toBe('GDP');
    expect(detectSevType('AFP-ZNY')).toBe('AFP');
    expect(detectSevType('AIRSPACE FLOW PROGRAM')).toBe('AFP');
  });

  it('folds miles-in-trail and minutes-in-trail into MIT', () => {
    expect(detectSevType('MILES-IN-TRAIL')).toBe('MIT');
    expect(detectSevType('MINUTES-IN-TRAIL')).toBe('MIT');
    expect(detectSevType('MIT-ZOB')).toBe('MIT');
    expect(detectSevType('MINIT restriction')).toBe('MIT');
  });

  it('recognises the remaining codes', () => {
    expect(detectSevType('CODED DEPARTURE ROUTES')).toBe('CDR');
    expect(detectSevType('CDRS in effect')).toBe('CDR');
    expect(detectSevType('SEVERE WEATHER AVOIDANCE')).toBe('SWAP');
    expect(detectSevType('EDCT issued')).toBe('EDCT');
    expect(detectSevType('FCA active')).toBe('FCA');
    expect(detectSevType('DSP at ORD')).toBe('DSP');
  });

  it('is case-insensitive', () => {
    expect(detectSevType('ground stop')).toBe('GS');
    expect(detectSevType('Ground Delay Program')).toBe('GDP');
  });

  it('falls back to OTHER for anything unrecognised (edge case)', () => {
    expect(detectSevType('RUNWAY CLOSURE')).toBe('OTHER');
    expect(detectSevType('')).toBe('OTHER');
  });

  it('checks ground stop before ground delay when both words appear (edge case)', () => {
    expect(detectSevType('GROUND STOP following GROUND DELAY')).toBe('GS');
  });
});

describe('sevBadgeClass', () => {
  it('gives each severity its own badge class', () => {
    expect(sevBadgeClass('GS')).toBe('sev-gs');
    expect(sevBadgeClass('GDP')).toBe('sev-gdp');
    expect(sevBadgeClass('AFP')).toBe('sev-afp');
  });

  it('shares one class across the flow-restriction family', () => {
    expect(sevBadgeClass('MIT')).toBe('sev-mit');
    expect(sevBadgeClass('MINIT')).toBe('sev-mit');
    expect(sevBadgeClass('SWAP')).toBe('sev-mit');
    expect(sevBadgeClass('CDR')).toBe('sev-cdr');
    expect(sevBadgeClass('EDCT')).toBe('sev-cdr');
    expect(sevBadgeClass('FCA')).toBe('sev-cdr');
    expect(sevBadgeClass('DSP')).toBe('sev-cdr');
  });

  it('falls back to sev-other for unknown types (edge case)', () => {
    expect(sevBadgeClass('OTHER')).toBe('sev-other');
    expect(sevBadgeClass('')).toBe('sev-other');
    expect(sevBadgeClass(undefined)).toBe('sev-other');
  });
});

describe('tierNasEvents', () => {
  it('puts an active ground stop in the critical tier with a facility-prefixed title', () => {
    const { critical, active, monitoring } = tierNasEvents({
      active: [{ name: 'GS-EWR', reason: 'thunderstorms', avgDelay: 45, endTime: '2026-09-11T21:30:00Z', affectedFacilities: ['EWR', 'JFK'] }],
    }, HUBS);
    expect(active).toEqual([]);
    expect(monitoring).toEqual([]);
    expect(critical).toEqual([{
      tier: 'critical',
      sevType: 'GS',
      title: 'EWR Ground Stop',
      detail: 'thunderstorms · avg <span class="nas-delay-val">45m</span> · ends 21:30Z',
      hubs: ['EWR'],
    }]);
  });

  it('puts other active programs in the active tier', () => {
    const { active } = tierNasEvents({
      active: [{ name: 'GDP-ORD', reason: 'wind', affectedFacilities: ['ORD'] }],
    }, HUBS);
    expect(active[0]).toMatchObject({ tier: 'active', sevType: 'GDP', title: 'ORD Ground Delay Program', detail: 'wind', hubs: ['ORD'] });
  });

  it('tiers planned TMIs: GS critical, GDP/AFP active, everything else monitoring', () => {
    const out = tierNasEvents({
      planned: [
        { event: 'GS-SFO', decoded: 'Ground stop at SFO', time: '18:00Z', affectedAirports: ['SFO'] },
        { event: 'AFP-ZOB', decoded: 'Airspace flow program', affectedAirports: ['ORD'] },
        { event: 'MIT-ZID', decoded: 'Miles in trail', affectedAirports: ['IAH'] },
      ],
    }, HUBS);
    expect(out.critical.map((i) => i.sevType)).toEqual(['GS']);
    expect(out.active.map((i) => i.sevType)).toEqual(['AFP']);
    expect(out.monitoring.map((i) => i.sevType)).toEqual(['MIT']);
    expect(out.monitoring[0]).toMatchObject({ title: 'Miles in trail', detail: '', hubs: ['IAH'] });
  });

  it('keeps only United hubs in each item\'s hub tags, and de-dupes active facilities', () => {
    const { critical } = tierNasEvents({
      active: [{ name: 'GS-ORD', affectedFacilities: ['ORD', 'ORD', 'ATL', 'DEN'] }],
    }, HUBS);
    expect(critical[0].hubs).toEqual(['ORD', 'DEN']);
  });

  it('escapes untrusted upstream text before it reaches innerHTML', () => {
    const { monitoring } = tierNasEvents({
      planned: [{ event: 'MIT', decoded: '<img src=x onerror=alert(1)>', time: 'a "b" & c', affectedAirports: [] }],
    }, HUBS);
    expect(monitoring[0].title).toBe('&lt;img src=x onerror=alert(1)&gt;');
    expect(monitoring[0].detail).toBe('a &quot;b&quot; &amp; c');
  });

  it('accepts the hub list as a Set as well as an array', () => {
    const asSet = tierNasEvents({ active: [{ name: 'GS-ORD', affectedFacilities: ['ORD'] }] }, new Set(HUBS));
    expect(asSet.critical[0].hubs).toEqual(['ORD']);
  });

  it('returns three empty tiers for missing or empty NAS data (edge case)', () => {
    const empty = { critical: [], active: [], monitoring: [] };
    expect(tierNasEvents(null, HUBS)).toEqual(empty);
    expect(tierNasEvents({}, HUBS)).toEqual(empty);
    expect(tierNasEvents({ active: [], planned: [] }, HUBS)).toEqual(empty);
  });

  it('falls back to the raw program name when there is no 3-letter facility (edge case)', () => {
    const { active } = tierNasEvents({ active: [{ name: 'GDP', affectedFacilities: [] }] }, HUBS);
    expect(active[0].title).toBe('GDP');
    expect(active[0].hubs).toEqual([]);
  });

  it('renders a bare endTime verbatim when it carries no date part (edge case)', () => {
    const { active } = tierNasEvents({ active: [{ name: 'GDP-DEN', endTime: '2145Z', affectedFacilities: ['DEN'] }] }, HUBS);
    expect(active[0].detail).toBe('ends 2145Z');
  });
});
