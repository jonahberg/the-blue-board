import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Intercept the dynamic `import('@supabase/supabase-js')` inside getSupabaseAdmin so the Supabase
// client is a controllable fake. createClient closes over `supa.from`, so each test rewires the
// chain even though getSupabaseAdmin memoizes the client.
const supa = vi.hoisted(() => ({ from: null }));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: (...args) => supa.from(...args) }),
}));

import {
  getSnapshotCompleteness,
  shouldPersistPartialSnapshot,
  isSnapshotCandidateBetter,
  isCompleteSnapshotAcceptable,
  saveScheduleSnapshot,
  cleanupExpiredSnapshots,
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

describe('isCompleteSnapshotAcceptable', () => {
  it('accepts any complete board when there is no existing snapshot', () => {
    expect(isCompleteSnapshotAcceptable({ partial: false, total: 10 }, null)).toBe(true);
    expect(isCompleteSnapshotAcceptable({ partial: false, total: 10 }, undefined)).toBe(true);
  });

  it('accepts a complete board over a stored PARTIAL snapshot regardless of total', () => {
    expect(isCompleteSnapshotAcceptable(
      { partial: false, total: 300 },
      { partial: true, total: 900, meta: { completeness: 0.5 } }
    )).toBe(true);
  });

  it('rejects a complete board materially thinner than a stored complete snapshot (truncated 200)', () => {
    // The documented failure: a transient 300-flight board would clobber a stored 700-flight board.
    expect(isCompleteSnapshotAcceptable(
      { partial: false, total: 300 },
      { partial: false, total: 700 }
    )).toBe(false);
  });

  it('accepts a same-or-larger complete board and one within the retain margin (normal churn)', () => {
    expect(isCompleteSnapshotAcceptable({ partial: false, total: 700 }, { partial: false, total: 700 })).toBe(true);
    expect(isCompleteSnapshotAcceptable({ partial: false, total: 720 }, { partial: false, total: 700 })).toBe(true);
    expect(isCompleteSnapshotAcceptable({ partial: false, total: 650 }, { partial: false, total: 700 })).toBe(true);
  });

  it('accepts anything when the stored complete total is zero or missing', () => {
    expect(isCompleteSnapshotAcceptable({ partial: false, total: 1 }, { partial: false, total: 0 })).toBe(true);
    expect(isCompleteSnapshotAcceptable({ partial: false, total: 1 }, { partial: false })).toBe(true);
  });
});

describe('saveScheduleSnapshot — complete-board betterness gate (Supabase-backed)', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test';
  });
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    supa.from = null;
    vi.restoreAllMocks();
  });

  function mockSupabase({ existingPayload = null } = {}) {
    const upsert = vi.fn(async () => ({ error: null }));
    const select = vi.fn(() => ({
      eq: () => ({
        limit: async () => ({ data: existingPayload ? [{ payload: existingPayload }] : [], error: null }),
      }),
    }));
    supa.from = vi.fn(() => ({ select, upsert, delete: () => ({ lt: async () => ({ error: null }) }) }));
    return { from: supa.from, upsert, select };
  }

  const save = (data) => saveScheduleSnapshot({
    cacheKey: 'agg:ORD:departures:1', hub: 'ord', dir: 'departures', ts: 1, data,
  });

  it('writes a complete board through when no snapshot exists', async () => {
    const m = mockSupabase({ existingPayload: null });
    await save({ partial: false, total: 700, meta: { source: 'aerodatabox' } });
    expect(m.upsert).toHaveBeenCalledTimes(1);
  });

  it('does NOT let a truncated thin complete board clobber a much larger stored complete snapshot', async () => {
    const m = mockSupabase({ existingPayload: { partial: false, total: 700 } });
    await save({ partial: false, total: 300, meta: { source: 'aerodatabox' } });
    expect(m.upsert).not.toHaveBeenCalled();
  });

  it('writes through a complete board with a within-margin total vs the stored one (normal churn)', async () => {
    const m = mockSupabase({ existingPayload: { partial: false, total: 700 } });
    await save({ partial: false, total: 650, meta: { source: 'aerodatabox' } });
    expect(m.upsert).toHaveBeenCalledTimes(1);
  });

  it('a complete board always replaces a stored PARTIAL snapshot regardless of total', async () => {
    const m = mockSupabase({ existingPayload: { partial: true, total: 900, meta: { completeness: 0.5 } } });
    await save({ partial: false, total: 300, meta: { source: 'aerodatabox' } });
    expect(m.upsert).toHaveBeenCalledTimes(1);
  });
});

describe('cleanupExpiredSnapshots', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test';
  });
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    supa.from = null;
    vi.restoreAllMocks();
  });

  it('deletes only rows whose expires_at is already in the past', async () => {
    const lt = vi.fn(async () => ({ error: null }));
    const del = vi.fn(() => ({ lt }));
    supa.from = vi.fn(() => ({ delete: del }));
    const before = Date.now();
    await cleanupExpiredSnapshots();
    expect(supa.from).toHaveBeenCalledWith('schedule_snapshots');
    expect(del).toHaveBeenCalledTimes(1);
    expect(lt).toHaveBeenCalledTimes(1);
    const [column, iso] = lt.mock.calls[0];
    expect(column).toBe('expires_at');
    expect(Date.parse(iso)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(iso)).toBeLessThanOrEqual(Date.now());
  });

  it('swallows a delete error instead of throwing', async () => {
    supa.from = vi.fn(() => ({ delete: () => ({ lt: async () => ({ error: { message: 'boom' } }) }) }));
    await expect(cleanupExpiredSnapshots()).resolves.toBeUndefined();
  });
});
