import { describe, it, expect } from 'vitest';
import {
  buildAirborneRows,
  buildConfigGallery,
  buildDeliveryTimeline,
  buildSeatBar,
  buildSpecialRows,
  deliveryStats,
  FLEET_FAMILY_COLORS,
  fleetHealthCounts,
  resolveFleetDeepLinkFilter,
  sortAirborneRows,
  typeCounts,
  wifiFilterOptions,
} from '../src/lib/fleet-view.js';

// Rows shaped like /data/fleet.json.
const FLEET = [
  { r: 'N801UA', t: 'A319', d: '1997', w: 'Satl Ku', s: 'MLB Maint 2/2/26', c: '', tot: 126 },
  { r: 'N802UA', t: 'A319', d: '1997', w: 'Satl Ku', s: '', c: '8J/42E+/76Y', tot: 126, seats: { J: 8, 'E+': 42, Y: 76 } },
  { r: 'N4888U', t: 'A319', d: '2007', w: 'Satl Ku', s: 'VCV Stored 12/17/25' },
  { r: 'N17104', t: '757-200', d: '1994', w: 'Sat KA', s: '*Sam E. Ashmore', c: '16J/42E+/118Y', tot: 176, seats: { J: 16, 'E+': 42, Y: 118 } },
  { r: 'N37502', t: '737 MAX 9', d: '2018', w: 'Starlink', s: '', c: '20J/45E+/114Y', tot: 179, seats: { J: 20, 'E+': 45, Y: 114 } },
  { r: 'N26902', t: '787-9', d: '2024', w: 'Starlink', s: 'ORD Paint' },
];

describe('typeCounts / wifiFilterOptions', () => {
  it('counts aircraft per type', () => {
    expect(typeCounts(FLEET)).toEqual({ A319: 3, '757-200': 1, '737 MAX 9': 1, '787-9': 1 });
  });

  it('lists the normalised WiFi values present, sorted and de-duplicated', () => {
    // "Sat KA" and "Satl Ku" both normalise through WIFI_DISPLAY before de-duplication.
    expect(wifiFilterOptions(FLEET)).toEqual(['Satellite Ka', 'Satellite Ku', 'Starlink']);
  });

  it('survives an empty fleet', () => {
    expect(typeCounts([])).toEqual({});
    expect(wifiFilterOptions(null)).toEqual([]);
  });
});

describe('buildDeliveryTimeline', () => {
  it('emits one bar per year between the first and last delivery, including empty years', () => {
    const chart = buildDeliveryTimeline(FLEET);
    expect(chart.minYear).toBe(1994);
    expect(chart.maxYear).toBe(2024);
    expect(chart.years).toHaveLength(2024 - 1994 + 1);
    const y1997 = chart.years.find((y) => y.year === 1997);
    expect(y1997.total).toBe(2);
    const y1998 = chart.years.find((y) => y.year === 1998);
    expect(y1998.total).toBe(0);
    expect(y1998.segments).toEqual([]);
  });

  it('stacks a year by family colour, tallest segment first', () => {
    const chart = buildDeliveryTimeline(
      [
        { t: 'A319', d: '2000' },
        { t: '737-800', d: '2000' },
        { t: '737-900', d: '2000' },
      ],
      { barHeight: 120 },
    );
    const bar = chart.years.find((y) => y.year === 2000);
    expect(bar.total).toBe(3);
    expect(bar.segments.map((s) => s.count)).toEqual([2, 1]);
    expect(bar.segments[0].color).toBe(FLEET_FAMILY_COLORS['737-800']);
    // The tallest year is the full bar height; the segments divide it.
    expect(bar.height).toBe(120);
    expect(bar.segments[0].height).toBeCloseTo(80);
    expect(bar.segments[1].height).toBeCloseTo(40);
  });

  it('floors a segment at 1px so one aircraft in a thin split bar never rounds away', () => {
    const many = Array.from({ length: 200 }, () => ({ t: '737-800', d: '2015' }));
    const chart = buildDeliveryTimeline(
      [...many, { t: 'A319', d: '2016' }, { t: '757-200', d: '2016' }],
      { barHeight: 140 },
    );
    const thin = chart.years.find((y) => y.year === 2016);
    // The whole 2016 bar is 1.4px; each of its two segments would be 0.7px unfloored.
    expect(thin.height).toBeCloseTo(1.4);
    expect(thin.segments.map((s) => s.height)).toEqual([1, 1]);
  });

  it('drops deliveries outside 1990-2030 and unparseable years', () => {
    const chart = buildDeliveryTimeline([
      { t: 'A319', d: '1970' },
      { t: 'A319', d: '2099' },
      { t: 'A319', d: 'n/a' },
      { t: 'A319', d: '2001' },
    ]);
    expect(chart.minYear).toBe(2001);
    expect(chart.maxYear).toBe(2001);
    expect(chart.years).toHaveLength(1);
  });

  it('prints a count only on bars of 15 or more, and years every five plus both ends', () => {
    const rows = [];
    for (let i = 0; i < 15; i++) rows.push({ t: '737-800', d: '2002' });
    rows.push({ t: '737-800', d: '2006' });
    const chart = buildDeliveryTimeline(rows);
    expect(chart.years.find((y) => y.year === 2002).showCount).toBe(true);
    expect(chart.years.find((y) => y.year === 2006).showCount).toBe(false);
    expect(chart.years.find((y) => y.year === 2002).showYear).toBe(true); // first
    expect(chart.years.find((y) => y.year === 2006).showYear).toBe(true); // last
    expect(chart.years.find((y) => y.year === 2003).showYear).toBe(false);
    // 2005 is a multiple of five but sits one slot from the last year; two four-digit
    // labels that close together render as "20052006".
    expect(chart.years.find((y) => y.year === 2005).showYear).toBe(false);
  });

  it('keeps an every-five label that is clear of both ends', () => {
    const chart = buildDeliveryTimeline([
      { t: 'A319', d: '1998' },
      { t: 'A319', d: '2005' },
      { t: 'A319', d: '2012' },
    ]);
    expect(chart.years.find((y) => y.year === 2000).showYear).toBe(true);
    expect(chart.years.find((y) => y.year === 2005).showYear).toBe(true);
    expect(chart.years.find((y) => y.year === 2010).showYear).toBe(true);
    expect(chart.years.find((y) => y.year === 1998).showYear).toBe(true); // first
    expect(chart.years.find((y) => y.year === 2012).showYear).toBe(true); // last
  });

  it('builds the legend from the families actually present, first-seen first', () => {
    const chart = buildDeliveryTimeline(FLEET);
    expect(chart.legend.map((l) => l.name)).toEqual(['A320 family', '757', '737 MAX', '787']);
  });

  it('returns an empty chart rather than Infinity bounds when nothing has a year', () => {
    const chart = buildDeliveryTimeline([{ t: 'A319' }]);
    expect(chart).toEqual({ years: [], minYear: null, maxYear: null, maxCount: 1, legend: [] });
  });
});

describe('deliveryStats', () => {
  it('reports the mean age, the newest and oldest airframes and the age histogram', () => {
    const stats = deliveryStats(FLEET, 2026);
    // ages: 29, 29, 19, 32, 8, 2 → mean 19.833…
    expect(stats.avgAge).toBe('19.8');
    expect(stats.newest.r).toBe('N26902');
    expect(stats.oldest.r).toBe('N17104');
    expect(stats.decades).toEqual([
      { label: '0-5y', count: 1 },
      { label: '6-10y', count: 1 },
      { label: '11-15y', count: 0 },
      { label: '16-20y', count: 1 },
      { label: '20y+', count: 3 },
    ]);
  });

  it('says "--" rather than 0 when no aircraft has a delivery year', () => {
    const stats = deliveryStats([{ r: 'N1', t: 'A319' }], 2026);
    expect(stats.avgAge).toBe('--');
    expect(stats.newest).toBeNull();
    expect(stats.oldest).toBeNull();
  });

  it('puts an exactly-5-year-old aircraft in the first bucket, not the second', () => {
    const stats = deliveryStats([{ r: 'N1', d: '2021' }, { r: 'N2', d: '2016' }], 2026);
    expect(stats.decades[0]).toEqual({ label: '0-5y', count: 1 });
    expect(stats.decades[1]).toEqual({ label: '6-10y', count: 1 });
  });
});

describe('fleetHealthCounts', () => {
  it('splits the fleet into active and out of service, and drops empty categories', () => {
    const health = fleetHealthCounts(FLEET);
    expect(health.total).toBe(6);
    // active: N802UA, N17104 (leading *), N37502 → 3
    expect(health.active).toBe(3);
    expect(health.nonActive).toBe(3);
    expect(health.activePct).toBe('50.0');
    expect(health.bars.map((b) => b.key)).toEqual(['active', 'maintenance', 'stored', 'painting']);
    expect(health.bars.find((b) => b.key === 'stored')).toMatchObject({ count: 1, pct: '16.7' });
  });

  it('returns null on an empty fleet rather than claiming zero aircraft', () => {
    expect(fleetHealthCounts([])).toBeNull();
    expect(fleetHealthCounts(null)).toBeNull();
  });
});

describe('buildConfigGallery', () => {
  it('groups a type by cabin configuration and sizes each block by seat count', () => {
    const gallery = buildConfigGallery(FLEET, '757-200');
    expect(gallery).toHaveLength(1);
    expect(gallery[0]).toMatchObject({ config: '16J/42E+/118Y', count: 1, total: 176 });
    expect(gallery[0].blocks).toEqual([
      { cabin: 'J', count: 16, width: 30, color: '#2563eb' },
      { cabin: 'E+', count: 42, width: 30, color: '#16a34a' },
      { cabin: 'Y', count: 118, width: 59, color: '#475569' },
    ]);
  });

  it('labels a blank configuration "Unknown" and counts every aircraft on it', () => {
    const gallery = buildConfigGallery(FLEET, 'A319');
    const unknown = gallery.find((g) => g.config === 'Unknown');
    expect(unknown.count).toBe(2); // the maint row and the stored row both have c: '' / absent
    expect(unknown.blocks).toEqual([]);
  });

  it('returns nothing for a type not in the fleet', () => {
    expect(buildConfigGallery(FLEET, 'A380')).toEqual([]);
  });
});

describe('buildSeatBar', () => {
  it('keeps the raw counts as flex and labels only the cabins over 8 percent', () => {
    const bar = buildSeatBar({ J: 16, 'E+': 42, Y: 118 }, 176);
    expect(bar.map((s) => s.flex)).toEqual([16, 42, 118]);
    // 16/176 = 9.1 % → labelled; a 12-seat cabin of 176 (6.8 %) would not be.
    expect(bar.map((s) => s.showLabel)).toEqual([true, true, true]);
    expect(buildSeatBar({ F: 12, Y: 164 }, 176)[0].showLabel).toBe(false);
    expect(bar[0].color).toBe('rgba(0,93,170,.5)');
  });

  it('falls back to slate for a cabin code with no colour', () => {
    expect(buildSeatBar({ Q: 10 }, 100)[0].color).toBe('rgba(100,116,139,.5)');
  });

  it('labels nothing when the total is missing, and handles no seats at all', () => {
    expect(buildSeatBar({ J: 16 }, null)[0].showLabel).toBe(false);
    expect(buildSeatBar(undefined, 176)).toEqual([]);
  });
});

describe('buildAirborneRows / sortAirborneRows', () => {
  const fleetByReg = Object.fromEntries(FLEET.map((a) => [a.r, a]));
  const FLIGHTS = [
    { reg: 'N802UA', icao24: 'a0b0c0', flightIATA: 'UA100', origin: 'ORD', dest: 'DEN', alt: 10000, spd: 230, vr: 0, onGround: false },
    { reg: 'N17104', icao24: 'a1b1c1', callsign: 'UAL200', origin: 'SFO', dest: 'HNL', alt: 3000, spd: 180, vr: 10, onGround: false },
    { reg: 'N802UA', icao24: 'a2b2c2', flightIATA: 'UA300', origin: 'EWR', dest: 'IAD', alt: 0, spd: 0, vr: 0, onGround: true },
    { reg: 'N999ZZ', icao24: 'a3b3c3', flightIATA: 'UA400', origin: 'ORD', dest: 'MSP', alt: 8000, spd: 200, vr: 0, onGround: false },
  ];
  const deps = {
    fleetByReg,
    starlinkTails: new Set(['N37502']),
    special: new Map([['N17104', { name: 'Sam E. Ashmore', type: 'named' }]]),
  };

  it('keeps only airborne flights the fleet database can name', () => {
    const rows = buildAirborneRows(FLIGHTS, deps);
    expect(rows.map((r) => r.reg)).toEqual(['N802UA', 'N17104']); // on-ground and regional dropped
  });

  it('formats altitude in feet with a thousands separator, and "--" when unknown', () => {
    const rows = buildAirborneRows(FLIGHTS, deps);
    expect(rows[0].alt).toBe('32,808ft');
    expect(rows[0].altRaw).toBe(10000);
    expect(buildAirborneRows([{ ...FLIGHTS[0], alt: 0 }], deps)[0].alt).toBe('--');
  });

  it('carries the route, flight identifier, phase and special entry', () => {
    const rows = buildAirborneRows(FLIGHTS, deps);
    expect(rows[1]).toMatchObject({
      flight: 'UAL200',
      route: 'SFO > HNL',
      special: { name: 'Sam E. Ashmore', type: 'named' },
      starlink: false,
      icao24: 'a1b1c1',
    });
    expect(typeof rows[1].phase).toBe('string');
  });

  it('applies the shared type and search filters', () => {
    expect(buildAirborneRows(FLIGHTS, { ...deps, type: '757-200' }).map((r) => r.reg)).toEqual(['N17104']);
    expect(buildAirborneRows(FLIGHTS, { ...deps, search: 'N802' }).map((r) => r.reg)).toEqual(['N802UA']);
    // Search matches the type as well as the registration.
    expect(buildAirborneRows(FLIGHTS, { ...deps, search: '757' }).map((r) => r.reg)).toEqual(['N17104']);
  });

  it('sorts on raw altitude, not the formatted string', () => {
    const rows = buildAirborneRows(FLIGHTS, deps);
    expect(sortAirborneRows(rows, 'alt', true).map((r) => r.altRaw)).toEqual([3000, 10000]);
    expect(sortAirborneRows(rows, 'alt', false).map((r) => r.altRaw)).toEqual([10000, 3000]);
  });

  it('sorts other columns as strings and does not mutate the input', () => {
    const rows = buildAirborneRows(FLIGHTS, deps);
    const before = rows.map((r) => r.reg);
    expect(sortAirborneRows(rows, 'reg', true).map((r) => r.reg)).toEqual(['N17104', 'N802UA']);
    expect(rows.map((r) => r.reg)).toEqual(before);
  });
});

describe('resolveFleetDeepLinkFilter', () => {
  const options = {
    statusValues: ['active', 'stored', 'starlink', 'special'],
    typeValues: ['A319', '787-9'],
  };

  it('matches a status value first and clears the type', () => {
    expect(resolveFleetDeepLinkFilter('starlink', options)).toEqual({ status: 'starlink', type: '' });
  });

  it('matches a type value and clears the status', () => {
    expect(resolveFleetDeepLinkFilter('787-9', options)).toEqual({ status: '', type: '787-9' });
  });

  it('ignores a value that is neither, rather than filtering everything away', () => {
    // ?type=B789 is an ICAO code; the Fleet controls have never carried one.
    expect(resolveFleetDeepLinkFilter('B789', options)).toBeNull();
    expect(resolveFleetDeepLinkFilter('', options)).toBeNull();
    expect(resolveFleetDeepLinkFilter(null, options)).toBeNull();
  });
});

describe('buildSpecialRows', () => {
  const fleetByReg = Object.fromEntries(FLEET.map((a) => [a.r, a]));
  const special = new Map([
    ['N17104', { name: 'Sam E. Ashmore', type: 'named' }],
    ['N26902', { name: '100 Year Sticker', type: 'livery' }],
    ['N00000', { name: 'Ghost', type: 'named' }],
  ]);

  it('marks a special aircraft airborne with its flight and route', () => {
    const rows = buildSpecialRows(special, fleetByReg, [
      { reg: 'N171-04', flightIATA: 'UA200', origin: 'SFO', dest: 'HNL', onGround: false },
    ]);
    // The feed's registration arrives dashed; the index is not.
    expect(rows.find((r) => r.reg === 'N17104').airborne).toEqual({ flight: 'UA200', route: 'SFO > HNL' });
    expect(rows.find((r) => r.reg === 'N26902').airborne).toBeNull();
  });

  it('ignores an on-ground sighting', () => {
    const rows = buildSpecialRows(special, fleetByReg, [
      { reg: 'N17104', flightIATA: 'UA200', origin: 'SFO', dest: 'HNL', onGround: true },
    ]);
    expect(rows.find((r) => r.reg === 'N17104').airborne).toBeNull();
  });

  it('drops a special registration the fleet database does not have', () => {
    const rows = buildSpecialRows(special, fleetByReg, []);
    expect(rows.map((r) => r.reg)).toEqual(['N17104', 'N26902']);
    expect(rows[0]).toMatchObject({ kind: 'named', type: '757-200', delivered: '1994' });
  });
});
