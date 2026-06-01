import { describe, it, expect } from 'vitest';
import { bucketInstallsByMonth } from '../src/lib/starlink-utils.js';

// Helper to build aircraft entries the way /api/starlink-data shapes them
const ac = (dateFound, fleet = 'Express') => ({ tail: 'N1', fleet, type: 'ERJ-175', operator: 'SkyWest dba UAX', dateFound, wifi: 'Starlink' });

describe('bucketInstallsByMonth', () => {
  it('buckets aircraft into months with fleet split and cumulative totals', () => {
    const aircraft = [
      ac('2025-03-15'), ac('2025-03-20'),               // Mar: 2 express
      ac('2025-05-01', 'Mainline'),                      // May: 1 mainline
    ];
    const { months, undated, total } = bucketInstallsByMonth(aircraft, new Date('2025-05-15T12:00:00Z'));

    expect(total).toBe(3);
    expect(undated).toBe(0);
    expect(months.map(m => m.ym)).toEqual(['2025-03', '2025-04', '2025-05']);

    expect(months[0]).toMatchObject({ ym: '2025-03', express: 2, mainline: 0, total: 2, cumulative: 2 });
    // zero-install month is included to keep the time axis continuous
    expect(months[1]).toMatchObject({ ym: '2025-04', express: 0, mainline: 0, total: 0, cumulative: 2 });
    expect(months[2]).toMatchObject({ ym: '2025-05', express: 0, mainline: 1, total: 1, cumulative: 3 });
  });

  it('extends the range to the current month even with no recent installs', () => {
    const aircraft = [ac('2025-03-15')];
    const { months } = bucketInstallsByMonth(aircraft, new Date('2025-07-10T12:00:00Z'));
    expect(months.map(m => m.ym)).toEqual(['2025-03', '2025-04', '2025-05', '2025-06', '2025-07']);
    expect(months[4]).toMatchObject({ total: 0, cumulative: 1 });
  });

  it('labels months MMM uppercase, with the year on the first month and every January', () => {
    const aircraft = [ac('2025-11-15'), ac('2026-01-05'), ac('2026-02-10')];
    const { months } = bucketInstallsByMonth(aircraft, new Date('2026-02-20T12:00:00Z'));
    expect(months.map(m => m.label)).toEqual(['NOV 25', 'DEC', 'JAN 26', 'FEB']);
  });

  it('counts aircraft with missing or unparseable dateFound as undated (excluded from bars)', () => {
    const aircraft = [
      ac('2025-03-15'),
      ac(''), ac(undefined), ac('not-a-date'),
    ];
    const { months, undated, total } = bucketInstallsByMonth(aircraft, new Date('2025-03-20T12:00:00Z'));
    expect(total).toBe(4);
    expect(undated).toBe(3);
    expect(months).toHaveLength(1);
    expect(months[0]).toMatchObject({ total: 1, cumulative: 1 });
  });

  it('returns empty months when no aircraft have dates', () => {
    const { months, undated, total } = bucketInstallsByMonth([ac(''), ac(undefined)], new Date('2026-01-01T12:00:00Z'));
    expect(months).toEqual([]);
    expect(undated).toBe(2);
    expect(total).toBe(2);
  });

  it('returns empty result for empty/invalid input', () => {
    expect(bucketInstallsByMonth([], new Date())).toEqual({ months: [], undated: 0, total: 0 });
    expect(bucketInstallsByMonth(null, new Date())).toEqual({ months: [], undated: 0, total: 0 });
  });

  it('handles the real-world shape: Express-heavy 2025, Mainline ramp in 2026, Dec batch', () => {
    // Condensed version of the live distribution
    const aircraft = [
      ...Array.from({ length: 7 }, () => ac('2025-03-10')),
      ...Array.from({ length: 157 }, () => ac('2025-12-03')),          // the Dec batch
      ...Array.from({ length: 3 }, () => ac('2026-05-20', 'Express')),
      ...Array.from({ length: 17 }, () => ac('2026-05-21', 'Mainline')),
    ];
    const { months } = bucketInstallsByMonth(aircraft, new Date('2026-05-31T12:00:00Z'));

    const dec = months.find(m => m.ym === '2025-12');
    expect(dec).toMatchObject({ express: 157, mainline: 0, total: 157 });

    const may26 = months.find(m => m.ym === '2026-05');
    expect(may26).toMatchObject({ express: 3, mainline: 17, total: 20, cumulative: 184 });

    // continuous axis: Mar 2025 → May 2026 = 15 months
    expect(months).toHaveLength(15);
  });
});
