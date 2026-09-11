/**
 * Small shared hooks. Anything with domain logic belongs in `src/lib/*.js` with a vitest
 * file; these are React plumbing only.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Fetch once, optionally on an interval. `key` identifies the request: when it changes the
 * previous data stays visible until the new request settles, so a refresh never flashes the
 * panel to empty. A refresh tick is skipped while the tab is hidden — the dashboard polls
 * several endpoints and a backgrounded tab must not keep spending them.
 */
export function useJson<T>(
  fetcher: () => Promise<T>,
  opts: { key: string; refreshMs?: number; enabled?: boolean },
): {
  data: T | null;
  error: Error | null;
  loading: boolean;
  updatedAt: number | null;
  refresh: () => void;
} {
  const { key, refreshMs, enabled = true } = opts;
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const [state, setState] = useState<{
    data: T | null;
    error: Error | null;
    loading: boolean;
    updatedAt: number | null;
  }>({ data: null, error: null, loading: enabled, updatedAt: null });
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    fetcherRef.current().then(
      (data) => {
        if (!cancelled) setState({ data, error: null, loading: false, updatedAt: Date.now() });
      },
      (err: unknown) => {
        if (!cancelled) {
          setState((s) => ({
            ...s,
            error: err instanceof Error ? err : new Error(String(err)),
            loading: false,
          }));
        }
      },
    );
    let timer: ReturnType<typeof setInterval> | undefined;
    if (refreshMs && refreshMs > 0) {
      timer = setInterval(() => {
        if (!document.hidden) setTick((t) => t + 1);
      }, refreshMs);
    }
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [key, enabled, refreshMs, tick]);

  return { ...state, refresh };
}

/** `true` while the media query matches. Initial value is read synchronously to avoid a flash. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia(query).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

/** `document.hidden`, as state. Drives every "pause while backgrounded" rule. */
export function usePageVisible(): boolean {
  const [visible, setVisible] = useState(() =>
    typeof document === 'undefined' ? true : !document.hidden,
  );
  useEffect(() => {
    const onChange = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);
  return visible;
}

/**
 * `Date.now()`, re-read on an interval. Used by the UTC clock and the countdown — one timer
 * per consumer beats a global re-render of the whole island every second.
 */
export function useNow(intervalMs = 1000, enabled = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return undefined;
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs, enabled]);
  return now;
}

/** Latest value in a ref — for callbacks captured by long-lived listeners and timers. */
export function useLatest<T>(value: T): { readonly current: T } {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}
