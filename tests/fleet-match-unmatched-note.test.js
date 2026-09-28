import { describe, expect, it } from 'vitest';
import { unmatchedAircraftNote } from '../src/lib/fleet-match.js';

describe('unmatchedAircraftNote (F10)', () => {
  it('calls only regional-only types United Express', () => {
    for (const t of ['E75L', 'E175', 'CRJ7', 'E145', 'DH8D']) {
      expect(unmatchedAircraftNote(t)).toMatch(/United Express/);
    }
  });

  it('treats a mainline type missing from the DB as a recent delivery, never Express', () => {
    for (const t of ['B789', 'B39M', 'A21N', undefined, '']) {
      expect(unmatchedAircraftNote(t)).toBe('not yet in fleet DB (recent delivery?)');
    }
  });
});
