/**
 * "Cover a day" status for the island: one fetch of `/api/support-status`, shared by the
 * deep-use strip (`features/SupportStrip.tsx`), the About section (`features/CoverADay.tsx`) and
 * the ⓘ menu's cost meter (`features/SupportMeter.tsx`).
 *
 * Fetched only when one of them is about to show (never on page load), kept for five minutes,
 * and read back through `parseSupportStatus` (src/lib/cover-a-day.js). Every failure — the
 * endpoint missing (as it is behind `astro preview`'s production proxy until this ships), a
 * non-200, a malformed body, a body for a different Central date — becomes
 * `{configured: false}`, and the surfaces then make no coverage claim at all.
 */

import { useEffect, useState } from 'react';

import { parseSupportStatus } from '@/lib/cover-a-day.js';

export type CoveredDay = { day: number; by: string };

export type SupportStatus =
  | { configured: false }
  | {
      configured: true;
      year: number;
      month: number;
      daysInMonth: number;
      today: number;
      daysCovered: number;
      todayCovered: boolean;
      todayBy: string | null;
      /** The first open day on or after today ('YYYY-MM-DD'), or null if none within a year. */
      nextOpenDate: string | null;
      days: CoveredDay[];
      dailyCostUsd: number;
    };

export const SUPPORT_STATUS_TTL_MS = 5 * 60_000;

let cached: { at: number; value: SupportStatus } | null = null;
let inFlight: Promise<SupportStatus> | null = null;

/** The status, from the five-minute cache or one shared request. Never rejects. */
export function loadSupportStatus(now: number = Date.now()): Promise<SupportStatus> {
  if (cached && now - cached.at < SUPPORT_STATUS_TTL_MS) return Promise.resolve(cached.value);
  if (inFlight) return inFlight;
  inFlight = fetch('/api/support-status', { headers: { Accept: 'application/json' } })
    .then((res) => (res.ok ? res.json() : null))
    .catch(() => null)
    .then((json) => {
      const value = parseSupportStatus(json, Date.now()) as SupportStatus;
      cached = { at: Date.now(), value };
      return value;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/** Test seam: forget the cached status. */
export function resetSupportStatus(): void {
  cached = null;
  inFlight = null;
}

/**
 * The status once `active` has been true at least once; null until it has arrived. A surface
 * that needs it to decide whether to show at all waits for it rather than flashing a claim.
 */
export function useSupportStatus(active: boolean): SupportStatus | null {
  const [status, setStatus] = useState<SupportStatus | null>(() => cached?.value ?? null);
  useEffect(() => {
    if (!active) return undefined;
    let live = true;
    loadSupportStatus().then((value) => {
      if (live) setStatus(value);
    });
    return () => {
      live = false;
    };
  }, [active]);
  return status;
}
