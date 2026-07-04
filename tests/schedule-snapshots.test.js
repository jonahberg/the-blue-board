import { describe, it, expect } from 'vitest';
import {
  getSnapshotCompleteness,
  shouldPersistPartialSnapshot,
  isSnapshotCandidateBetter,
} from '../api/_schedule-snapshots.js';

describe('getSnapshotCompleteness', () => {
  it('returns meta.completeness when present and finite', () => {
    expect(getSnapshotCompleteness({ meta: { completeness: 0.75 } })).toBe(0.75);
  });

  it('clamps completeness to 0-1 range', () => {
    expect(getSnapshotCompleteness({ meta: { completeness: 1.5 } })).toBe(1);
    expect(getSnapshotCompleteness({ meta: { completeness: -0.5 } })).toBe(0);
  });

  it('returns 0 for partial snapshots without meta.completeness', () => {
    expect(getSnapshotCompleteness({ partial: true })).toBe(0);
  });

  it('returns 1 for non-partial snapshots without meta.completeness', () => {
    expect(getSnapshotCompleteness({ partial: false })).toBe(1);
    expect(getSnapshotCompleteness({})).toBe(1);
  });

  it('handles null/undefined data', () => {
    expect(getSnapshotCompleteness(null)).toBe(1);
    expect(getSnapshotCompleteness(undefined)).toBe(1);
  });

  it('handles NaN completeness', () => {
    expect(getSnapshotCompleteness({ meta: { completeness: NaN } })).toBe(1);
    expect(getSnapshotCompleteness({ meta: { completeness: 'invalid' } })).toBe(1);
  });
});

describe('shouldPersistPartialSnapshot', () => {
  it('returns false for non-partial data', () => {
    expect(shouldPersistPartialSnapshot({ partial: false, total: 100 })).toBe(false);
    expect(shouldPersistPartialSnapshot({ total: 100 })).toBe(false);
  });

  it('returns false for partial with zero total', () => {
    expect(shouldPersistPartialSnapshot({ partial: true, total: 0 })).toBe(false);
  });

  it('returns false for partial with completeness below threshold (0.25)', () => {
    expect(shouldPersistPartialSnapshot({
      partial: true, total: 10, meta: { completeness: 0.1 },
    })).toBe(false);
  });

  it('returns true for partial with total > 0 and completeness >= 0.25', () => {
    expect(shouldPersistPartialSnapshot({
      partial: true, total: 10, meta: { completeness: 0.5 },
    })).toBe(true);
  });

  it('returns true at exactly 0.25 completeness', () => {
    expect(shouldPersistPartialSnapshot({
      partial: true, total: 1, meta: { completeness: 0.25 },
    })).toBe(true);
  });

  it('returns false for null data', () => {
    expect(shouldPersistPartialSnapshot(null)).toBe(false);
  });
});

describe('isSnapshotCandidateBetter', () => {
  it('returns true when no existing snapshot', () => {
    expect(isSnapshotCandidateBetter({ partial: true }, null)).toBe(true);
    expect(isSnapshotCandidateBetter({ partial: true }, undefined)).toBe(true);
  });

  it('returns true when candidate is complete', () => {
    expect(isSnapshotCandidateBetter(
      { partial: false },
      { partial: true, meta: { completeness: 0.9 } }
    )).toBe(true);
  });

  it('returns false when candidate is partial but existing is complete', () => {
    expect(isSnapshotCandidateBetter(
      { partial: true, meta: { completeness: 0.9 } },
      { partial: false }
    )).toBe(false);
  });

  it('prefers higher completeness (with > 0.01 margin)', () => {
    expect(isSnapshotCandidateBetter(
      { partial: true, meta: { completeness: 0.8 } },
      { partial: true, meta: { completeness: 0.5 } }
    )).toBe(true);

    expect(isSnapshotCandidateBetter(
      { partial: true, meta: { completeness: 0.5 } },
      { partial: true, meta: { completeness: 0.8 } }
    )).toBe(false);
  });

  it('uses total count as tiebreaker when completeness is similar', () => {
    expect(isSnapshotCandidateBetter(
      { partial: true, total: 100, meta: { completeness: 0.5 } },
      { partial: true, total: 50, meta: { completeness: 0.5 } }
    )).toBe(true);

    expect(isSnapshotCandidateBetter(
      { partial: true, total: 50, meta: { completeness: 0.5 } },
      { partial: true, total: 100, meta: { completeness: 0.5 } }
    )).toBe(false);
  });

  it('ranks on dedupe-adjusted totals: a fresh 700-flight deduped board replaces a stale 717-row dup-laden snapshot', () => {
    // Pre-dedupe persisted snapshot: 717 rows, 17 of them revision dupes / operator clones /
    // foreign leaks. Fresh deduped board: 700 real flights + meta.dedupe accounting for the 17.
    // Raw-total ranking let the stale snapshot outrank every fresh deduped board and refuse
    // overwrite for its whole 72h TTL.
    const staleDupLaden = { partial: true, total: 717, meta: { completeness: 0.5, pagesSucceeded: 1 } };
    const freshDeduped = {
      partial: true, total: 700,
      meta: { completeness: 0.5, pagesSucceeded: 1, dedupe: { revisions: 16, operatorClones: 1, foreign: 0 } },
    };
    expect(isSnapshotCandidateBetter(freshDeduped, staleDupLaden)).toBe(true);
    // And the reverse: the un-deduped 717 board must NOT beat the persisted deduped 700 board.
    expect(isSnapshotCandidateBetter(staleDupLaden, freshDeduped)).toBe(false);
  });

  it('dedupe adjustment cannot manufacture a win over genuinely better coverage', () => {
    // 690 + 17 dropped = 707 effective < 717 raw: the dup-laden snapshot still carries more
    // underlying flights, so it stays.
    const staleDupLaden = { partial: true, total: 717, meta: { completeness: 0.5, pagesSucceeded: 1 } };
    const smallerDeduped = {
      partial: true, total: 690,
      meta: { completeness: 0.5, pagesSucceeded: 1, dedupe: { revisions: 16, operatorClones: 1, foreign: 0 } },
    };
    expect(isSnapshotCandidateBetter(smallerDeduped, staleDupLaden)).toBe(false);
  });

  it('uses pagesSucceeded as final tiebreaker', () => {
    expect(isSnapshotCandidateBetter(
      { partial: true, total: 50, meta: { completeness: 0.5, pagesSucceeded: 5 } },
      { partial: true, total: 50, meta: { completeness: 0.5, pagesSucceeded: 3 } }
    )).toBe(true);

    expect(isSnapshotCandidateBetter(
      { partial: true, total: 50, meta: { completeness: 0.5, pagesSucceeded: 3 } },
      { partial: true, total: 50, meta: { completeness: 0.5, pagesSucceeded: 5 } }
    )).toBe(false);
  });

  it('returns false for identical snapshots (no improvement)', () => {
    const snap = { partial: true, total: 50, meta: { completeness: 0.5, pagesSucceeded: 3 } };
    expect(isSnapshotCandidateBetter(snap, snap)).toBe(false);
  });
});
