/**
 * In-tab watch alerts — the banner, the screen-reader line, the OS notification for a hidden
 * tab, and the "Glad you landed" toast — fed by EVERY source that learns something about a
 * watched flight (phone QA Oct 4 2026).
 *
 * Before, the only source was a Schedule-board reload, and the Schedule tab never refreshes on
 * its own: six watched flights went through four landings in 30 minutes without one correct
 * alert, while the My Flights cards (which poll /api/flight-times) had flipped to "Landed" a
 * minute or two after each touchdown. Now:
 *
 *  - This provider polls the watch list's /api/flight-times answers itself (the same module
 *    cache and TTL ladder My Flights uses, so nothing is fetched twice) and reads the live feed,
 *    whatever tab is open — and turns them into observations.
 *  - The Schedule store hands in an observation per watched board row as before.
 *  - Both go through ONE rule, `evaluateWatchObservation()` (src/lib/watch-utils.js), against the
 *    STORED entry, and the change is written back in the same call — so whichever source sees a
 *    landing first alerts, and the other finds nothing new. No double fire.
 *
 * Rendered inside UiProvider, FeedProvider and WatchProvider (Dashboard.tsx).
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { findLiveFlight } from '@/lib/my-flights.js';
import {
  applyWatchChanges,
  evaluateWatchObservation,
  observationFromFlightTimes,
  readWatched,
  watchedFlightLanded,
} from '@/lib/watch-utils.js';
import type { WatchPhase } from '@/lib/watch-rules.js';
import { useFlightTimes } from '../views/myflight/useFlightTimes';
import type { WatchedFlight } from '../data/types';
import { useFeed } from './feed';
import { safeLocalStorage } from './storage';
import { useUi } from './ui';
import { useWatch } from './watch';
import type { WatchChange } from './watch';

/** A watched flight that changed while the page was open (inventory §6). */
export type WatchAlert = { message: string; key: number } | null;

/** What one source learned about one watched flight (src/lib/watch-utils.js WatchObservation). */
export type WatchObservation = {
  flight: string;
  phase: WatchPhase;
  key: string;
  text: string;
  dep: number;
  delayMin: number | null;
  route: string;
};

export type WatchAlertsValue = {
  alert: WatchAlert;
  clearAlert: () => void;
  /** Evaluate observations against the stored watch list, persist, and alert on what is news. */
  observe: (observations: (WatchObservation | null)[]) => void;
};

const WatchAlertsContext = createContext<WatchAlertsValue | null>(null);

export function useWatchAlerts(): WatchAlertsValue {
  const ctx = useContext(WatchAlertsContext);
  if (!ctx) throw new Error('useWatchAlerts() outside <WatchAlertsProvider>');
  return ctx;
}

type Pending = { entry: WatchedFlight; obs: WatchObservation; kind: 'status' | 'delay' };

export function WatchAlertsProvider({ children }: { children: ReactNode }) {
  const [alert, setAlert] = useState<WatchAlert>(null);
  const { announce, select, showBmacToast } = useUi();
  const watch = useWatch();
  const watchRef = useRef(watch);
  watchRef.current = watch;

  const raise = useCallback(
    ({ entry, obs, kind }: Pending) => {
      const route = obs.route || entry.route || '';
      const what = kind === 'delay' ? `Delayed ${obs.delayMin} min` : obs.text;
      const was = kind === 'status' && entry.status ? ` (was: ${entry.status})` : '';
      const message = `🔔 ${obs.flight}${route ? ` ${route}` : ''}: ${what}${was}`;
      if (typeof document !== 'undefined' && document.hidden) {
        // Not visible — the browser's own notification is the only channel that reaches
        // someone who has tabbed away from a flight they are waiting on.
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          try {
            const notification = new Notification('The Blue Board', {
              body: `${obs.flight}: ${what}${was}`,
              icon: '/icons/icon-192.png',
              tag: `bb-watch-${obs.flight}`,
              data: { flight: obs.flight },
            });
            notification.onclick = () => {
              window.focus();
              select({ kind: 'ident', ident: obs.flight });
            };
          } catch {
            /* a notification that cannot be shown must never break a load */
          }
        }
      } else {
        setAlert({ message, key: Date.now() });
        announce(message);
      }
      // Inventory §12: a watched flight LANDING is the one moment the donation ask is made —
      // only on a real transition into landed (never a re-statement, never a presumed
      // landing: those are not observations at all). `showBmacToast` owns the 14-day cooldown.
      if (kind === 'status' && watchedFlightLanded(entry.status, { key: obs.key })) showBmacToast(obs.flight);
    },
    [announce, select, showBmacToast],
  );

  const observe = useCallback(
    (observations: (WatchObservation | null)[]) => {
      const list = observations.filter(Boolean) as WatchObservation[];
      if (list.length === 0) return;
      // The stored list, not this tab's render: another tab (or the other source a moment ago)
      // may already have recorded the change.
      const storage = safeLocalStorage();
      let working = (storage ? readWatched(storage) : watchRef.current.watched) as WatchedFlight[];
      if (working.length === 0) return;
      const now = Date.now();
      const changes: WatchChange[] = [];
      const pending: Pending[] = [];
      for (const obs of list) {
        const entry = working.find((w) => w.flight === obs.flight);
        if (!entry) continue;
        const result = evaluateWatchObservation(entry, obs, now) as {
          notify: null | 'status' | 'delay';
          change: WatchChange | null;
        };
        if (!result.change) continue;
        changes.push(result.change);
        // Later observations in this batch build on this one (two boards in one load).
        working = applyWatchChanges(working, [result.change], now) as WatchedFlight[];
        if (result.notify) pending.push({ entry, obs, kind: result.notify });
      }
      // One write for the whole batch; a batch in which nothing moved writes nothing at all.
      if (changes.length) watchRef.current.applyStatusChanges(changes);
      for (const p of pending) raise(p);
    },
    [raise],
  );

  // ── The My Flights path, whatever tab is open ──
  const idents = useMemo(() => watch.watched.map((entry) => entry.flight), [watch.watched]);
  const { flights } = useFeed();
  const { times } = useFlightTimes(idents, flights);
  useEffect(() => {
    if (idents.length === 0) return;
    const now = Date.now();
    observe(
      idents.map((flight) => {
        const td = times[flight]?.data;
        return td ? (observationFromFlightTimes(td, findLiveFlight(flights, flight), now) as WatchObservation | null) : null;
      }),
    );
  }, [idents, times, flights, observe]);

  const clearAlert = useCallback(() => setAlert(null), []);
  const value = useMemo<WatchAlertsValue>(() => ({ alert, clearAlert, observe }), [alert, clearAlert, observe]);
  return <WatchAlertsContext.Provider value={value}>{children}</WatchAlertsContext.Provider>;
}
