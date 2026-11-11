import { describe, it, expect } from 'vitest';
import {
  SEV_LABELS,
  detectSevType,
  sevBadgeClass,
  tierNasEventsRaw,
  nasCountLine,
  nasDisplayTitle,
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

describe('tierNasEventsRaw', () => {
  it('puts an active ground stop in the critical tier with a facility-prefixed title', () => {
    const { critical, active, monitoring } = tierNasEventsRaw({
      active: [{ name: 'GS-EWR', reason: 'thunderstorms', avgDelay: 45, endTime: '2026-09-11T21:30:00Z', affectedFacilities: ['EWR', 'JFK'] }],
    }, HUBS);
    expect(active).toEqual([]);
    expect(monitoring).toEqual([]);
    expect(critical).toEqual([{
      tier: 'critical',
      sevType: 'GS',
      title: 'EWR Ground Stop',
      detailParts: [
        { kind: 'text', text: 'thunderstorms' },
        { kind: 'delay', text: '45m' },
        { kind: 'text', text: 'ends 21:30Z' },
      ],
      hubs: ['EWR'],
    }]);
  });

  it('puts other active programs in the active tier', () => {
    const { active } = tierNasEventsRaw({
      active: [{ name: 'GDP-ORD', reason: 'wind', affectedFacilities: ['ORD'] }],
    }, HUBS);
    expect(active[0]).toMatchObject({
      tier: 'active', sevType: 'GDP', title: 'ORD Ground Delay Program',
      detailParts: [{ kind: 'text', text: 'wind' }], hubs: ['ORD'],
    });
  });

  it('never puts a PLANNED item in the critical tier — only an active ground stop is critical', () => {
    const out = tierNasEventsRaw({
      planned: [
        { event: 'GS-SFO', decoded: 'Ground stop at SFO', time: '18:00Z', affectedAirports: ['SFO'] },
        { event: 'AFP-ZOB', decoded: 'Airspace flow program', affectedAirports: ['ORD'] },
        { event: 'MIT-ZID', decoded: 'Miles in trail', affectedAirports: ['IAH'] },
      ],
    }, HUBS);
    expect(out.critical).toEqual([]);
    expect(out.active.map((i) => i.sevType)).toEqual(['GS', 'AFP']);
    expect(out.monitoring.map((i) => i.sevType)).toEqual(['MIT']);
    expect(out.monitoring[0]).toMatchObject({ title: 'Miles in trail', hubs: ['IAH'] });
  });

  it('keeps a POSSIBLE/PROBABLE outlook in monitoring and an EXPECTED one in active, with its window', () => {
    // The live /api/nas shape (Sep 27 2026): active [], every planned item a
    // "GROUND STOP/DELAY PROGRAM POSSIBLE" outlook with an empty time field. These used to
    // fill the critical tier with eight GS badges while nothing was in effect.
    const nas = {
      active: [],
      planned: [
        { time: '', event: 'AFTER 1500\t-EWR GROUND STOP/DELAY PROGRAM POSSIBLE', decoded: 'AFTER 1500\t-EWR GROUND STOP/DELAY PROGRAM POSSIBLE', affectedAirports: ['EWR'], type: 'terminal' },
        { time: '', event: 'AFTER 1500\t-BOS GROUND STOP/DELAY PROGRAM EXPECTED', decoded: 'AFTER 1500\t-BOS GROUND STOP/DELAY PROGRAM EXPECTED', affectedAirports: ['BOS'], type: 'terminal' },
        { time: '', event: 'AFTER 1100\t-BOS CDRS/SWAP/ESCAPE ROUTES PROBABLE', decoded: 'AFTER 1100\t-BOS Coded Departure Routes/Severe Weather Avoidance/ESCAPE ROUTES PROBABLE', affectedAirports: ['BOS'], type: 'enroute' },
      ],
    };
    const out = tierNasEventsRaw(nas, HUBS);
    expect(out.critical).toEqual([]);
    expect(out.active).toEqual([{
      tier: 'active', sevType: 'GS', title: 'BOS GROUND STOP/DELAY PROGRAM EXPECTED',
      detailParts: [{ kind: 'text', text: 'planned' }, { kind: 'text', text: 'after 1500Z' }], hubs: [],
    }]);
    expect(out.monitoring.map((i) => [i.sevType, i.title])).toEqual([
      ['GS', 'EWR GROUND STOP/DELAY PROGRAM POSSIBLE'],
      ['CDR', 'BOS Coded Departure Routes/Severe Weather Avoidance/ESCAPE ROUTES PROBABLE'],
    ]);
    expect(out.monitoring[0].hubs).toEqual(['EWR']);
    expect(out.monitoring[0].detailParts).toEqual([{ kind: 'text', text: 'planned' }, { kind: 'text', text: 'after 1500Z' }]);
  });

  it('keeps only United hubs in each item\'s hub tags, and de-dupes active facilities', () => {
    const { critical } = tierNasEventsRaw({
      active: [{ name: 'GS-ORD', affectedFacilities: ['ORD', 'ORD', 'ATL', 'DEN'] }],
    }, HUBS);
    expect(critical[0].hubs).toEqual(['ORD', 'DEN']);
  });

  it('leaves upstream text RAW — escaping is React\'s job, not this module\'s', () => {
    const { monitoring } = tierNasEventsRaw({
      planned: [{ event: 'MIT', decoded: 'Miles-in-trail "20" & <climbing>', time: '18Z-22Z', affectedAirports: [] }],
    }, HUBS);
    expect(monitoring[0].title).toBe('Miles-in-trail "20" & <climbing>');
    expect(monitoring[0].detailParts).toEqual([{ kind: 'text', text: 'planned' }, { kind: 'text', text: '18Z-22Z' }]);
  });

  it('accepts the hub list as a Set as well as an array', () => {
    const asSet = tierNasEventsRaw({ active: [{ name: 'GS-ORD', affectedFacilities: ['ORD'] }] }, new Set(HUBS));
    expect(asSet.critical[0].hubs).toEqual(['ORD']);
  });

  it('returns three empty tiers for missing or empty NAS data (edge case)', () => {
    const empty = { critical: [], active: [], monitoring: [] };
    expect(tierNasEventsRaw(null, HUBS)).toEqual(empty);
    expect(tierNasEventsRaw({}, HUBS)).toEqual(empty);
    expect(tierNasEventsRaw({ active: [], planned: [] }, HUBS)).toEqual(empty);
  });

  it('falls back to the raw program name when there is no 3-letter facility (edge case)', () => {
    const { active } = tierNasEventsRaw({ active: [{ name: 'GDP', affectedFacilities: [] }] }, HUBS);
    expect(active[0].title).toBe('GDP');
    expect(active[0].hubs).toEqual([]);
  });

  it('renders a bare endTime verbatim when it carries no date part (edge case)', () => {
    const { active } = tierNasEventsRaw({ active: [{ name: 'GDP-DEN', endTime: '2145Z', affectedFacilities: ['DEN'] }] }, HUBS);
    expect(active[0].detailParts).toEqual([{ kind: 'text', text: 'ends 2145Z' }]);
  });

  it('marks only the average-delay figure as a delay part', () => {
    const { critical } = tierNasEventsRaw({
      active: [{ name: 'GS-EWR', reason: 'WIND', avgDelay: 45, affectedFacilities: ['EWR'] }],
    }, HUBS);
    expect(critical[0].detailParts.filter((p) => p.kind === 'delay')).toEqual([{ kind: 'delay', text: '45m' }]);
  });

  it('tags a planned TMI with no time as planned only', () => {
    const { monitoring } = tierNasEventsRaw({ planned: [{ event: 'MIT', affectedAirports: [] }] }, HUBS);
    expect(monitoring[0].detailParts).toEqual([{ kind: 'text', text: 'planned' }]);
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

// The ATCSCC operations plan as /api/nas served it on Nov 11 2026 (decoded field).
const NOV11_PLANNED = [
  { time: '', event: 'AFTER 1800\t-MIA/FLL GROUND STOP POSSIBLE', decoded: 'AFTER 1800\t-MIA/FLL GROUND STOP POSSIBLE', affectedAirports: ['MIA', 'FLL'], type: 'terminal' },
  { time: '', event: 'AFTER 2200\t-SEA/BFI GROUND STOP/DELAY PROGRAM POSSIBLE', decoded: 'AFTER 2200\t-SEA/BFI GROUND STOP/DELAY PROGRAM POSSIBLE', affectedAirports: ['SEA', 'BFI'], type: 'terminal' },
  { time: '', event: 'AFTER 2100\t-OCEANIC/AR ROUTE CLOSURES POSSIBLE', decoded: 'AFTER 2100\t-OCEANIC/AR ROUTE CLOSURES POSSIBLE', affectedAirports: [], type: 'enroute' },
  { time: '', event: 'AFTER 2100\t-ORD/MDW CDRS/SWAP/ARRIVAL ROUTES POSSIBLE', decoded: 'AFTER 2100\t-ORD/MDW Coded Departure Routes/Severe Weather Avoidance/ARRIVAL ROUTES POSSIBLE', affectedAirports: ['ORD', 'MDW'], type: 'enroute' },
  { time: '', event: 'UNTIL 0000\t-MIA/FLL CDRS/SWAP POSSIBLE', decoded: 'UNTIL 0000\t-MIA/FLL Coded Departure Routes/Severe Weather Avoidance POSSIBLE', affectedAirports: ['MIA', 'FLL'], type: 'enroute' },
];

describe('tierNasEventsRaw — a closing window', () => {
  it('moves a leading "UNTIL HHMM" out of the title into the detail, as it does "AFTER"', () => {
    const { monitoring } = tierNasEventsRaw({ planned: NOV11_PLANNED }, HUBS);
    const until = monitoring[monitoring.length - 1];
    expect(until.title).toBe('MIA/FLL Coded Departure Routes/Severe Weather Avoidance POSSIBLE');
    expect(until.detailParts).toEqual([{ kind: 'text', text: 'planned' }, { kind: 'text', text: 'until 0000Z' }]);
  });
});

describe('tierNasEventsRaw — a window is never dropped', () => {
  it('keeps "UNTIL HHMM" / "AFTER HHMM" in the title when the item carries its own time', () => {
    const { monitoring } = tierNasEventsRaw({
      planned: [
        { time: '2000Z-0200Z', event: 'UNTIL 0000\t-MIA/FLL CDRS/SWAP POSSIBLE', decoded: 'UNTIL 0000\t-MIA/FLL CDRS/SWAP POSSIBLE', affectedAirports: ['MIA'] },
        { time: '2000Z-0200Z', event: 'AFTER 2100\t-ORD/MDW CDRS POSSIBLE', decoded: 'AFTER 2100\t-ORD/MDW CDRS POSSIBLE', affectedAirports: ['ORD'] },
      ],
    }, HUBS);
    expect(monitoring.map((item) => item.title)).toEqual([
      'UNTIL 0000\t-MIA/FLL CDRS/SWAP POSSIBLE',
      'AFTER 2100\t-ORD/MDW CDRS POSSIBLE',
    ]);
    expect(monitoring[0].detailParts).toEqual([{ kind: 'text', text: 'planned' }, { kind: 'text', text: '2000Z-0200Z' }]);
  });
});

describe('nasDisplayTitle (the panel reads in sentence case, codes untouched)', () => {
  it('turns the Nov 11 plan into calm lines and keeps every airport and acronym as sent', () => {
    const tiers = tierNasEventsRaw({ planned: NOV11_PLANNED }, HUBS);
    const all = [...tiers.critical, ...tiers.active, ...tiers.monitoring];
    // No item dropped by tiering or formatting.
    expect(all).toHaveLength(NOV11_PLANNED.length);
    expect(all.map((item) => nasDisplayTitle(item.title))).toEqual([
      'MIA/FLL ground stop possible',
      'SEA/BFI ground stop/delay program possible',
      'Oceanic/AR route closures possible',
      'ORD/MDW coded departure routes/severe weather avoidance/arrival routes possible',
      'MIA/FLL coded departure routes/severe weather avoidance possible',
    ]);
  });

  it('only ever changes letter case: upper-casing the result gives back the input', () => {
    const titles = [
      ...NOV11_PLANNED.map((t) => t.decoded),
      'EWR Ground Stop',
      'ORD Ground Delay Program',
      'GS-EWR',
      'MIT-ZOB',
      'Miles-in-trail "20" & <climbing>',
      'J146/J149 CLOSED FOR VOLUME',
      'ZNY/ZDC ESCAPE ROUTES PROBABLE',
      '<img src=x onerror=alert(1)> & co',
      '',
    ];
    for (const title of titles) expect(nasDisplayTitle(title).toUpperCase()).toBe(title.toUpperCase());
  });

  it('sentence-cases the active programs too (built from SEV_LABELS)', () => {
    const nas = {
      active: [
        { name: 'GS-EWR', reason: 'WX', affectedFacilities: ['EWR'] },
        { name: 'GDP-ORD', avgDelay: 62, affectedFacilities: ['ORD'] },
      ],
    };
    const { critical, active } = tierNasEventsRaw(nas, HUBS);
    expect(nasDisplayTitle(critical[0].title)).toBe('EWR ground stop');
    expect(nasDisplayTitle(active[0].title)).toBe('ORD ground delay program');
  });

  it('never lowers a short word in the leading facility list, where it may be an airport', () => {
    expect(nasDisplayTitle('AND/FOR GROUND STOP AND DELAY PROGRAM POSSIBLE')).toBe(
      'AND/FOR ground stop and delay program possible',
    );
  });

  it('leaves codes, routes and unknown words alone', () => {
    expect(nasDisplayTitle('J146/J149 CLOSED FOR VOLUME')).toBe('J146/J149 closed for volume');
    expect(nasDisplayTitle('ZNY/ZDC ESCAPE ROUTES PROBABLE')).toBe('ZNY/ZDC escape routes probable');
    expect(nasDisplayTitle('GS-EWR')).toBe('GS-EWR');
    expect(nasDisplayTitle(null)).toBe('');
  });
});
