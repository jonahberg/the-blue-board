// Deadline arithmetic and bounded awaits for the serverless functions.
//
// A Vercel function is killed at its maxDuration, and so is everything it handed to waitUntil.
// On Nov 7 2026 two /api/schedule invocations ran to the 60-second limit after logging a 200: no
// Supabase call on that path had a timeout, so one slow query could hold the invocation open
// until the platform killed it. The rule this module supports: derive ONE deadline from the start
// of the request, and bound every await by min(its own budget, deadline − a safety margin). When a
// bound is hit the caller takes the degraded path it already had for a failure (serve what is
// cached, skip the write); the bound never becomes a new error for the visitor.

/** Headroom kept between the last bounded await and the function deadline. */
export const DEADLINE_SAFETY_MARGIN_MS = 500;

/** The `code` a bounded Supabase query reports when it ran out of time. */
export const DB_TIMEOUT_CODE = 'BB_TIMEOUT';

export type DbTimeoutResult = {
  data: null;
  error: { code: typeof DB_TIMEOUT_CODE; message: string };
};

/**
 * The time an await may take: its own budget, cut to what is left before `deadlineMs` minus the
 * safety margin. Never negative; with no deadline it is the own budget.
 */
export function budgetWithin(
  ownBudgetMs: number,
  deadlineMs?: number | null,
  marginMs = DEADLINE_SAFETY_MARGIN_MS,
  nowMs = Date.now(),
): number {
  const own = Math.max(0, ownBudgetMs);
  if (!deadlineMs || !Number.isFinite(deadlineMs)) return own;
  return Math.max(0, Math.min(own, deadlineMs - marginMs - nowMs));
}

/**
 * Resolve `promise`, or `fallback` once `budgetMs` has passed (calling `onTimeout` once). The
 * losing promise keeps running; callers pass promises that settle on their own and never throw
 * into nothing (a late rejection is swallowed here).
 */
export function withinBudget<T>(
  promise: Promise<T>,
  budgetMs: number,
  fallback: T,
  onTimeout?: () => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        onTimeout?.();
      } finally {
        resolve(fallback);
      }
    }, Math.max(0, budgetMs));
    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Run a supabase-js query with a time limit. The query gets an abort signal (postgrest-js's
 * `.abortSignal()`), so a slow request is actually cancelled and its socket released, and the
 * result is also raced against the same timer, so a client that ignores the signal cannot hold the
 * caller either. A query that runs out of time resolves like any other failed query:
 * `{ data: null, error: { code: 'BB_TIMEOUT', message } }`, which every caller already handles.
 *
 * The timer is a plain setTimeout behind an AbortController rather than AbortSignal.timeout(), so
 * it is cleared when the query finishes and the test suite can drive it with fake timers.
 *
 * @param builder    the supabase-js query builder (a thenable), not yet awaited.
 * @param timeoutMs  the query's budget; 0 or less answers "timed out" without sending it.
 */
export function boundedQuery<T>(
  builder: PromiseLike<T> & { abortSignal?: (signal: AbortSignal) => PromiseLike<T> },
  timeoutMs: number,
): Promise<T | DbTimeoutResult> {
  const ms = Math.max(0, Math.floor(timeoutMs));
  const timedOut = (): DbTimeoutResult => ({
    data: null,
    error: { code: DB_TIMEOUT_CODE, message: `timed out after ${ms}ms` },
  });
  if (ms === 0) return Promise.resolve(timedOut());

  const controller = new AbortController();
  const query: PromiseLike<T> =
    typeof builder?.abortSignal === 'function' ? builder.abortSignal(controller.signal) : builder;

  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      controller.abort();
      resolve(timedOut());
    }, ms);
    Promise.resolve(query).then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** True for the result `boundedQuery()` returns when the query ran out of time. */
export function isDbTimeout(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === DB_TIMEOUT_CODE;
}
