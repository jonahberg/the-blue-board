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

  // Wire the fake so each select batch returns the next entry of `batches` and every delete
  // records the keys it was asked to remove. Mirrors the PostgREST select→delete.in two-step.
  function mockCleanupSupabase(batches, { selectError = null, deleteError = null } = {}) {
    let call = 0;
    const selectLt = vi.fn();
    const deleted = [];
    supa.from = vi.fn(() => ({
      select: () => ({
        lt: (col, iso) => {
          selectLt(col, iso);
          return {
            order: () => ({
              limit: async () => {
                if (selectError) return { data: null, error: selectError };
                const rows = (batches[call++] || []).map((k) => ({ cache_key: k }));
                return { data: rows, error: null };
              },
            }),
          };
        },
      }),
      delete: () => ({
        in: async (col, keys) => {
          if (deleteError) return { error: deleteError };
          deleted.push([col, keys]);
          return { error: null };
        },
      }),
    }));
    return { selectLt, deleted };
  }

  it('deletes expired rows in bounded key batches and stops after a short batch', async () => {
    const full = Array.from({ length: 300 }, (_, i) => `agg:EWR:departures:${i}`);
    const m = mockCleanupSupabase([full, ['agg:SFO:arrivals:1', 'agg:SFO:arrivals:2']]);
    const before = Date.now();
    await cleanupExpiredSnapshots();
    expect(supa.from).toHaveBeenCalledWith('schedule_snapshots');
    // Two select+delete rounds: a full batch, then the 2-row remainder ends the loop.
    expect(m.selectLt).toHaveBeenCalledTimes(2);
    const [column, iso] = m.selectLt.mock.calls[0];
    expect(column).toBe('expires_at');
    expect(Date.parse(iso)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(iso)).toBeLessThanOrEqual(Date.now());
    expect(m.deleted).toHaveLength(2);
    expect(m.deleted[0][0]).toBe('cache_key');
    expect(m.deleted[0][1]).toEqual(full);
    expect(m.deleted[1][1]).toEqual(['agg:SFO:arrivals:1', 'agg:SFO:arrivals:2']);
  });

  it('issues no delete when nothing is expired', async () => {
    const m = mockCleanupSupabase([[]]);
    await cleanupExpiredSnapshots();
    expect(m.selectLt).toHaveBeenCalledTimes(1);
    expect(m.deleted).toHaveLength(0);
  });

  it('caps the work per run at the batch ceiling even with a deep backlog', async () => {
    const full = Array.from({ length: 300 }, (_, i) => `k${i}`);
    // Every select returns a full batch — the run must stop at the ceiling, not drain forever.
    const m = mockCleanupSupabase([full, full, full, full, full, full]);
    await cleanupExpiredSnapshots();
    expect(m.selectLt).toHaveBeenCalledTimes(4);
    expect(m.deleted).toHaveLength(4);
  });

  it('swallows a select error instead of throwing and issues no delete', async () => {
    const m = mockCleanupSupabase([], { selectError: { message: 'boom' } });
    await expect(cleanupExpiredSnapshots()).resolves.toBeUndefined();
    expect(m.deleted).toHaveLength(0);
  });

  it('swallows a delete error instead of throwing and stops batching', async () => {
    const full = Array.from({ length: 300 }, (_, i) => `k${i}`);
    const m = mockCleanupSupabase([full, full], { deleteError: { message: 'canceling statement due to statement timeout' } });
    await expect(cleanupExpiredSnapshots()).resolves.toBeUndefined();
    // The failed delete must end the run — no second select round.
    expect(m.selectLt).toHaveBeenCalledTimes(1);
  });

  // ── Observability: the GC used to log only failures, so a clean run left no trace it had run
  // or how much it deleted. It now emits ONE info summary whenever it deleted anything.
  const cleanupSummaries = (logSpy) =>
    logSpy.mock.calls.map((c) => String(c[0])).filter((m) => /Schedule snapshot cleanup: deleted/.test(m));

  it('logs a single success summary with the total deleted across batches', async () => {
    const full = Array.from({ length: 300 }, (_, i) => `k${i}`);
    mockCleanupSupabase([full, ['agg:SFO:arrivals:1', 'agg:SFO:arrivals:2']]);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await cleanupExpiredSnapshots();

    const summaries = cleanupSummaries(logSpy);
    expect(summaries).toHaveLength(1);
    // 300 (full batch) + 2 (short remainder) — one line, the true total, no backlog note.
    expect(summaries[0]).toBe('Schedule snapshot cleanup: deleted 302 expired rows');
  });

  it('stays silent when nothing was deleted (no hourly log noise on the common empty run)', async () => {
    mockCleanupSupabase([[]]);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await cleanupExpiredSnapshots();

    expect(cleanupSummaries(logSpy)).toHaveLength(0);
  });

  it('flags a likely backlog when the batch cap is reached with a full final batch', async () => {
    const full = Array.from({ length: 300 }, (_, i) => `k${i}`);
    // Every batch is full, so the run stops at CLEANUP_MAX_BATCHES with rows still likely expired.
    mockCleanupSupabase([full, full, full, full, full, full]);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await cleanupExpiredSnapshots();

    const summaries = cleanupSummaries(logSpy);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toBe(
      'Schedule snapshot cleanup: deleted 1200 expired rows (batch cap reached; backlog may remain)'
    );
  });

  it('still reports the rows already deleted when a later batch errors mid-run', async () => {
    // First batch deletes cleanly; the second delete fails (e.g. statement timeout). The error
    // logs on its own channel, but the summary must still credit what WAS deleted — and, since
    // the run ended on an error rather than the cap, it must NOT claim a backlog.
    const full = Array.from({ length: 300 }, (_, i) => `k${i}`);
    let deleteCall = 0;
    supa.from = vi.fn(() => ({
      select: () => ({
        lt: () => ({
          order: () => ({
            limit: async () => ({ data: full.map((k) => ({ cache_key: k })), error: null }),
          }),
        }),
      }),
      delete: () => ({
        in: async () => {
          deleteCall++;
          return deleteCall === 1
            ? { error: null }
            : { error: { message: 'canceling statement due to statement timeout' } };
        },
      }),
    }));
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await cleanupExpiredSnapshots();

    const summaries = cleanupSummaries(logSpy);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toBe('Schedule snapshot cleanup: deleted 300 expired rows');
  });
});
