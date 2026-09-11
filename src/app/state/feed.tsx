/**
 * The live flight feed: `/api/fr24-feed?airline=UAL` every 30 s.
 *
 * The policy here is the part that took several incidents to get right, so it is stated
 * once and only once (inventory §18 "Live feed", §1 "Live status chip"):
 *
 *  - A 200 carrying zero aircraft is a FAILED poll, not an empty sky. `fetchFr24Feed()`
 *    throws on it and the previous flights are kept verbatim.
 *  - LIVE/STALE keys off payload AGE (`feedFreshness`), never off a per-response transport
 *    signal — `x-vercel-cache` made the chip flap every poll on seconds-old data.
 *  - `X-BB-Feed-Stale` (seconds) backdates the last-good timestamp, so a stale-serve is
 *    reported as the age it really is.
 *  - After a failure the retry ladder is 5 / 10 / 20 / 30 s and the countdown shows the
 *    real delay. Retries are skipped while the tab is hidden.
 *  - Hiding the tab clears the timer and shows "Paused"; showing it refreshes immediately.
 *  - Every successful poll records flight → registration sightings into `bb_reg_ledger_v1`
 *    so the Schedule tab can backfill tails the schedule provider omits.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import {
  FEED_RETRY_DELAYS_MS,
  feedFreshness,
  nextFeedRetryDelay,
} from '@/lib/feed-health.js';
import {
  deserializeLedger,
  lookupReg as lookupLedgerReg,
  pruneLedger,
  recordSightings,
} from '@/lib/reg-ledger.js';
import { fetchFr24Feed } from '../data/api';
import type { Flight } from '../data/types';
import { STORAGE_KEYS, readString, writeString } from './storage';

/** Normal cadence between successful polls. */
export const FEED_POLL_MS = 30000;

export type FeedFreshness = 'live' | 'stale';

export type FeedValue = {
  flights: Flight[];
  /** When the newest committed payload was generated, already backdated by the stale header. */
  lastGoodTs: number | null;
  freshness: FeedFreshness;
  /** Seconds until the next poll; null while the tab is hidden ("Paused"). */
  countdown: number | null;
  /** True between a failed poll and the next success — the header shows a retry state. */
  retrying: boolean;
  /** True while a request is in flight (the Refresh control shows a loading label). */
  refreshing: boolean;
  /** Set only when the feed has never produced flights — drives the map error overlay. */
  failed: boolean;
  error: string | null;
  refresh: () => void;
  /** Tail seen on this flight number during its own operating window, else null. */
  lookupReg: (flightNumber: string, schedDepSec?: number, schedArrSec?: number) => string | null;
};

const FeedContext = createContext<FeedValue | null>(null);

export function useFeed(): FeedValue {
  const ctx = useContext(FeedContext);
  if (!ctx) throw new Error('useFeed() outside <FeedProvider>');
  return ctx;
}

export function FeedProvider({ children }: { children: ReactNode }) {
  const [flights, setFlights] = useState<Flight[]>([]);
  const [lastGoodTs, setLastGoodTs] = useState<number | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextPollAt, setNextPollAt] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);
  const [nowTick, setNowTick] = useState(() => Date.now());

  const attemptRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef(false);
  const stoppedRef = useRef(false);
  /** `{ [flightNumber]: { reg, seenAt } }`, mirrored to localStorage after every poll. */
  const ledgerRef = useRef<Record<string, { reg: string; seenAt: number }>>({});

  // Hydrate the sighting ledger once. `deserializeLedger` drops malformed entries itself.
  useEffect(() => {
    ledgerRef.current = deserializeLedger(readString(STORAGE_KEYS.regLedger) ?? '{}');
  }, []);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const poll = useCallback(
    async function poll() {
      if (stoppedRef.current || inFlightRef.current) return;
      inFlightRef.current = true;
      setRefreshing(true);
      try {
        const { flights: parsed, staleMs } = await fetchFr24Feed();
        const ts = Date.now() - staleMs;
        attemptRef.current = 0;
        setFlights(parsed);
        setLastGoodTs(ts);
        setRetrying(false);
        setError(null);

        // Reg ledger: record, prune, persist. Never lets a storage failure break the poll.
        const ledger = ledgerRef.current;
        recordSightings(ledger, parsed, Date.now());
        pruneLedger(ledger, Date.now());
        writeString(STORAGE_KEYS.regLedger, JSON.stringify(ledger));

        schedule(FEED_POLL_MS);
      } catch (err) {
        const delay = nextFeedRetryDelay(attemptRef.current);
        attemptRef.current += 1;
        setRetrying(true);
        setError(err instanceof Error ? err.message : String(err));
        schedule(delay);
      } finally {
        inFlightRef.current = false;
        setRefreshing(false);
      }

      function schedule(ms: number) {
        if (stoppedRef.current || document.hidden) {
          setNextPollAt(null);
          return;
        }
        clearTimer();
        setNextPollAt(Date.now() + ms);
        timerRef.current = setTimeout(() => {
          void poll();
        }, ms);
      }
    },
    [clearTimer],
  );

  const refresh = useCallback(() => {
    clearTimer();
    void poll();
  }, [clearTimer, poll]);

  // One poll loop for the life of the island.
  useEffect(() => {
    stoppedRef.current = false;
    void poll();
    return () => {
      stoppedRef.current = true;
      clearTimer();
    };
  }, [poll, clearTimer]);

  // Hidden → stop spending the feed and show "Paused". Visible → catch up immediately.
  useEffect(() => {
    function onVisibility() {
      if (document.hidden) {
        setPaused(true);
        setNextPollAt(null);
        clearTimer();
      } else {
        setPaused(false);
        refresh();
      }
    }
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [clearTimer, refresh]);

  // One second tick drives both the countdown and the LIVE→STALE flip between polls.
  useEffect(() => {
    const timer = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const countdown =
    paused || nextPollAt === null ? null : Math.max(0, Math.ceil((nextPollAt - nowTick) / 1000));
  const freshness: FeedFreshness =
    lastGoodTs === null ? 'stale' : (feedFreshness(nowTick - lastGoodTs) as FeedFreshness);

  const lookupReg = useCallback(
    (flightNumber: string, schedDepSec?: number, schedArrSec?: number) =>
      lookupLedgerReg(ledgerRef.current, flightNumber, schedDepSec, schedArrSec) as string | null,
    [],
  );

  const value = useMemo<FeedValue>(
    () => ({
      flights,
      lastGoodTs,
      freshness,
      countdown,
      retrying,
      refreshing,
      failed: flights.length === 0 && error !== null,
      error,
      refresh,
      lookupReg,
    }),
    [flights, lastGoodTs, freshness, countdown, retrying, refreshing, error, refresh, lookupReg],
  );

  return <FeedContext.Provider value={value}>{children}</FeedContext.Provider>;
}

/** Re-exported so the header's retry copy and the tests read the same ladder. */
export { FEED_RETRY_DELAYS_MS };
