/**
 * F147 — `starlinkPredictionDate` is the LOCAL operational date, not the UTC one.
 *
 * Pinned to a zone west of UTC. Under TZ=UTC the old test (which compared against
 * `toLocaleDateString` — the implementation itself) could not catch a switch to
 * `toISOString().slice(0, 10)`; here that regression returns '2026-09-14' and fails.
 */
const previousTz = process.env.TZ;
process.env.TZ = 'America/Los_Angeles';

import { afterAll, describe, expect, it } from 'vitest';

import { starlinkPredictionDate } from '../src/lib/starlink-prediction.js';

// A worker can be reused by the next test file: put the zone back.
afterAll(() => {
  if (previousTz === undefined) delete process.env.TZ;
  else process.env.TZ = previousTz;
});

describe('starlinkPredictionDate (America/Los_Angeles)', () => {
  it('03:30Z on Sep 14 is still Sep 13 in the evening in LA', () => {
    expect(starlinkPredictionDate(new Date('2026-09-14T03:30:00Z'))).toBe('2026-09-13');
  });

  it('agrees with UTC when both zones are on the same day', () => {
    expect(starlinkPredictionDate(new Date('2026-09-13T20:00:00Z'))).toBe('2026-09-13');
  });
});
