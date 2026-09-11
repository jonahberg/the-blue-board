/**
 * Web Storage access for the island.
 *
 * Every read and write is wrapped: Safari private mode throws on `localStorage` access, and
 * a quota error on one optional preference must never take the dashboard down (inventory
 * §29 — "every write try/catch"). Storage KEYS and VALUE SHAPES are a compatibility
 * contract with the shipped site: returning visitors keep their watch list, home hub and
 * dismissals across this rebuild, so nothing here may be renamed or reshaped.
 */

/** The exact keys the old dashboard wrote. Do not rename — see inventory §29. */
export const STORAGE_KEYS = {
  homeAirport: 'bb_home_airport',
  trackerWatches: 'bb_tracker_watches',
  regLedger: 'bb_reg_ledger_v1',
  watchedFlights: 'bb_watched_flights',
  pushPrompted: 'bb_push_prompted',
  tipsDismissed: 'bb_tips_dismissed',
  visited: 'bb-visited',
  onboarded: 'bb-onboarded',
  onboardingDismissed: 'bb_onboarding_dismissed',
  waitlistSubmitted: 'bb_waitlist_submitted',
  waitlistDismissed: 'bb_waitlist_dismissed',
  bmacDismissed: 'bb-bmac-dismissed',
  newsDismissedSlug: 'news_dismissed_slug',
  schedPreloadTs: 'bb_sched_preload_ts',
} as const;

/** `localStorage`, or null when it is unavailable (private mode, disabled cookies, SSR). */
export function safeLocalStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function safeSessionStorage(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

export function readString(key: string): string | null {
  try {
    return safeLocalStorage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function writeString(key: string, value: string): void {
  try {
    safeLocalStorage()?.setItem(key, value);
  } catch {
    /* quota / private mode — the feature degrades, the dashboard does not */
  }
}

export function removeKey(key: string): void {
  try {
    safeLocalStorage()?.removeItem(key);
  } catch {
    /* ignore */
  }
}

/** Parse a JSON-valued key, falling back on anything malformed. */
export function readJson<T>(key: string, fallback: T): T {
  const raw = readString(key);
  if (raw === null) return fallback;
  try {
    const parsed = JSON.parse(raw) as T;
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

export function writeJson(key: string, value: unknown): void {
  try {
    writeString(key, JSON.stringify(value));
  } catch {
    /* circular / unserialisable — never the caller's problem at runtime */
  }
}
