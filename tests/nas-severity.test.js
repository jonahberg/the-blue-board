import { describe, it, expect } from 'vitest';
import {
  SEV_LABELS,
  detectSevType,
  sevBadgeClass,
  tierNasEvents,
  tierNasEventsRaw,
  nasCountLine,
  nasPanelEmpty,
} from '../src/lib/nas-severity.js';

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

describe('tierNasEventsRaw (the React panel’s input)', () => {
  const NAS = {
    active: [
      { name: 'GS-EWR', reason: 'THUNDERSTORMS & WIND', avgDelay: 45, endTime: '2026-09-13T21:45:00Z', affectedFacilities: ['EWR', 'JFK'] },
      { name: 'GDP-ORD', reason: 'VOLUME', affectedFacilities: ['ORD'] },
    ],
    planned: [{ event: 'MIT-ZOB', decoded: 'Miles-in-trail "20" & climbing', time: '18Z-22Z', affectedAirports: ['ORD', 'LGA'] }],
  };

  it('tiers exactly the way the escaping variant does', () => {
    const raw = tierNasEventsRaw(NAS, HUBS);
    const escaped = tierNasEvents(NAS, HUBS);
    for (const tier of ['critical', 'active', 'monitoring']) {
      expect(raw[tier].map((i) => i.sevType)).toEqual(escaped[tier].map((i) => i.sevType));
      expect(raw[tier].map((i) => i.hubs)).toEqual(escaped[tier].map((i) => i.hubs));
    }
  });

  it('leaves the title and every detail part UNESCAPED', () => {
    const { critical, monitoring } = tierNasEventsRaw(NAS, HUBS);
    expect(critical[0].title).toBe('EWR Ground Stop');
    expect(critical[0].detailParts).toEqual([
      { kind: 'text', text: 'THUNDERSTORMS & WIND' },
      { kind: 'delay', text: '45m' },
      { kind: 'text', text: 'ends 21:45Z' },
    ]);
    // The escaping wrapper is the ONLY place ampersands and quotes become entities.
    expect(monitoring[0].title).toBe('Miles-in-trail "20" & climbing');
    expect(tierNasEvents(NAS, HUBS).monitoring[0].title).toBe('Miles-in-trail &quot;20&quot; &amp; climbing');
  });

  it('marks the average-delay figure so the panel can emphasise only that part', () => {
    const { critical } = tierNasEventsRaw(NAS, HUBS);
    expect(critical[0].detailParts.filter((p) => p.kind === 'delay')).toEqual([{ kind: 'delay', text: '45m' }]);
    // …and the innerHTML caller still gets the span it always got.
    expect(tierNasEvents(NAS, HUBS).critical[0].detail).toContain('avg <span class="nas-delay-val">45m</span>');
  });

  it('gives a planned TMI with no time an empty part list, not an empty string part', () => {
    const { monitoring } = tierNasEventsRaw({ planned: [{ event: 'MIT', affectedAirports: [] }] }, HUBS);
    expect(monitoring[0].detailParts).toEqual([]);
    expect(tierNasEvents({ planned: [{ event: 'MIT', affectedAirports: [] }] }, HUBS).monitoring[0].detail).toBe('');
  });

  it('returns three empty tiers for missing NAS data (edge case)', () => {
    expect(tierNasEventsRaw(null, HUBS)).toEqual({ critical: [], active: [], monitoring: [] });
  });
});

describe('nasCountLine', () => {
  it('counts active programs, planned TMIs and the distinct hubs touched', () => {
    const nas = {
      active: [{ name: 'GS-EWR', affectedFacilities: ['EWR'] }, { name: 'GDP-ORD', affectedFacilities: ['ORD'] }],
      planned: [{ event: 'MIT-ZOB', affectedAirports: ['ORD'] }],
    };
    expect(nasCountLine(nas, tierNasEventsRaw(nas, HUBS))).toBe('2 active · 1 planned · 2 hubs');
  });

  it('singularises one hub and omits every zero count', () => {
    const nas = { planned: [{ event: 'MIT-ZOB', affectedAirports: ['DEN'] }] };
    expect(nasCountLine(nas, tierNasEventsRaw(nas, HUBS))).toBe('1 planned · 1 hub');
  });

  it('is empty when there is nothing to count (edge case)', () => {
    expect(nasCountLine(null, { critical: [], active: [], monitoring: [] })).toBe('');
  });
});

describe('nasPanelEmpty (the panel hides itself rather than showing a header alone)', () => {
  it('is empty for missing data and for a payload with two empty arrays', () => {
    expect(nasPanelEmpty(null)).toBe(true);
    expect(nasPanelEmpty(undefined)).toBe(true);
    expect(nasPanelEmpty({ active: [], planned: [] })).toBe(true);
    expect(nasPanelEmpty({})).toBe(true);
  });

  it('is not empty as soon as either list has one entry', () => {
    expect(nasPanelEmpty({ active: [{ name: 'GDP-ORD' }], planned: [] })).toBe(false);
    expect(nasPanelEmpty({ active: [], planned: [{ event: 'MIT' }] })).toBe(false);
  });
});
