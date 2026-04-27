// In-memory per-IP daily counter, resets at UTC midnight.
//
// Used by the AI delay-explain gate (per Eng Review): free tier = 3 calls/day,
// Pro tier = unlimited (skip the counter entirely). Uses UTC date as the bucket
// key so behavior is consistent regardless of server timezone.
//
// Stores are isolated by name so different endpoints don't share quotas.
//
// Tradeoff: in-memory state means each Vercel function instance has its own
// counter. For low-volume free abuse (the actual concern), this is fine —
// even if 5 cold instances each let one user through, that's 15 calls/day,
// not 3. Acceptable for v1; revisit with Redis if free abuse becomes an issue.

interface CounterStore {
  get(key: string): number;
  increment(key: string): number;
  isOverLimit(key: string, limit: number): boolean;
  /** Test-only: clear all counts for this counter. Not used in production. */
  resetForTesting(): void;
}

interface CreateOptions {
  now?: () => number;
}

const stores = new Map<string, Map<string, number>>();
const storeDates = new Map<string, string>();

function utcDateKey(ms: number): string {
  // ISO 'YYYY-MM-DD' in UTC
  return new Date(ms).toISOString().slice(0, 10);
}

export function createDailyCounter(name: string, opts: CreateOptions = {}): CounterStore {
  const now = opts.now || Date.now;

  function ensureCurrentDay(): Map<string, number> {
    const today = utcDateKey(now());
    const lastDay = storeDates.get(name);
    if (lastDay !== today) {
      stores.set(name, new Map());
      storeDates.set(name, today);
    }
    return stores.get(name)!;
  }

  return {
    get(key: string): number {
      const store = ensureCurrentDay();
      return store.get(key) ?? 0;
    },
    increment(key: string): number {
      const store = ensureCurrentDay();
      const next = (store.get(key) ?? 0) + 1;
      store.set(key, next);
      return next;
    },
    isOverLimit(key: string, limit: number): boolean {
      const store = ensureCurrentDay();
      return (store.get(key) ?? 0) >= limit;
    },
    resetForTesting(): void {
      stores.set(name, new Map());
      storeDates.delete(name);
    },
  };
}
