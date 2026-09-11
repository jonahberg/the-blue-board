import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fr24Datetime } from '../api/_official-fr24.ts';

// FR24 documents flight_datetime_from/to as YYYY-MM-DDTHH:MM:SSZ. Date#toISOString() adds
// milliseconds, and the official API answered 400 to every summary lookup because of it
// (Sep 10 2026). Pin the formatter and pin that no official-API caller bypasses it.
describe('fr24Datetime', () => {
  it('emits whole-second UTC in the documented shape', () => {
    expect(fr24Datetime(new Date('2026-09-10T04:37:36.123Z'))).toBe('2026-09-10T04:37:36Z');
    expect(fr24Datetime(new Date('2026-09-10T04:37:36.000Z'))).toBe('2026-09-10T04:37:36Z');
    expect(fr24Datetime(new Date('2026-09-10T04:37:36Z'))).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });

  it('no official-API caller sends a raw toISOString() datetime', () => {
    for (const file of ['api/fr24-flight.ts', 'api/aircraft-history.ts', 'api/flight-times.ts', 'api/schedule.ts']) {
      const src = readFileSync(resolve(__dirname, '..', file), 'utf8');
      const offenders = [...src.matchAll(/flight_datetime_(?:from|to)[^\n]*toISOString\(\)/g)].map((m) => m[0]);
      expect(offenders, `${file} passes a millisecond ISO string to FR24 — use fr24Datetime()`).toEqual([]);
    }
  });
});
