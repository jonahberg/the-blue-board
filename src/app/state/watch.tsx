/**
 * The watch list and its push subscription (inventory §6).
 *
 * `bb_watched_flights` is a compatibility contract: `[{flight, route, status, ts}]`, at most
 * 20 entries, exactly as `src/lib/watch-utils.js` reads and writes it. A returning visitor
 * must find the same list after this rebuild, so the shape is never "modernised" here.
 *
 * The key is also SHARED WITH EVERY OTHER OPEN TAB, which is why no mutation here derives
 * from React state. The shipped dashboard re-read storage at the top of `toggleWatchFlight()`
 * and `checkWatchedFlightChanges()`; a provider that writes back a mount-time snapshot would
 * delete whatever another tab added in between. So every mutation is a read-modify-write
 * against the latest stored value, and a `storage` event from another tab re-reads the list.
 *
 * Push is best-effort by design and never throws: `/api/push-subscribe` reports whether the
 * server has VAPID keys at all, and a browser without a service worker, PushManager or
 * granted permission simply keeps the in-page banner instead.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { MAX_WATCHED, applyWatchChanges, readWatched, writeWatched } from '@/lib/watch-utils.js';
import { fetchPushConfig, postPushSubscribe } from '../data/api';
import type { WatchedFlight } from '../data/types';
import { STORAGE_KEYS, readString, safeLocalStorage, writeString } from './storage';

export type PushState = {
  /** The server has VAPID keys configured. */
  configured: boolean;
  /**
   * `GET /api/push-subscribe` has answered, either way.
   *
   * The watch panel's footnote has FOUR tiers, and "we have not asked the server yet"
   * is a different sentence from "the server says no" (inventory §6). Without this flag
   * a cold panel would claim background alerts are unavailable on this deployment a
   * few hundred milliseconds before learning that they are.
   */
  bootstrapped: boolean;
  permission: NotificationPermission | 'unsupported';
  /**
   * Alerts really will arrive with the tab closed: the server has keys, this browser
   * has the APIs, and the viewer has granted permission.
   */
  backgroundActive: boolean;
  /** True once the viewer has been asked, so the prompt is shown at most once. */
  prompted: boolean;
  /**
   * Ask the browser for permission, and mirror the list to the server if it is granted.
   *
   * Returns what the browser decided, so the caller can confirm out loud. Reading
   * `permission` off the store straight after would race the state update, and a prompt
   * that silently does nothing on "Allow" is the worst outcome of the whole flow.
   */
  enable: () => Promise<NotificationPermission | 'unsupported'>;
  dismissPrompt: () => void;
};

/** One entry of a batched update: the flight, plus whichever fields have moved. */
export type WatchChange = { flight: string; status?: string; route?: string };

export type WatchValue = {
  watched: WatchedFlight[];
  /** Adds or removes; returns true when the flight is now watched. */
  toggle: (flight: string, route?: string, status?: string) => boolean;
  clearAll: () => void;
  /**
   * Restamp a watched flight's last-seen status, without touching the list order.
   *
   * The Schedule tab's watched-flight diff (inventory §6) compares each board load against
   * the STORED status, so the baseline has to move forward after every comparison — leaving
   * it behind re-announces the same transition on every refresh until the page is closed.
   * A no-op for a flight that is not watched, and for a status that has not changed.
   */
  updateStatus: (flight: string, status: string) => void;
  /**
   * Restamp a WHOLE BOARD's worth of watched flights at once.
   *
   * One read, one reduce, one write, one re-render — which is what a board load is: a
   * single event that happens to have moved several flights. Applying the changes one at
   * a time makes each one a separate save, and the losing ones come back as repeat alerts
   * on the next load. A batch in which nothing actually moved writes nothing at all.
   */
  applyStatusChanges: (changes: WatchChange[]) => void;
  /**
   * Fill in a watch entry's route once it is known.
   *
   * A flight watched from the quick-add box or a deep link has no route at all, and a
   * card learns it from the first `/api/flight-times` answer. The shipped dashboard
   * wrote the entry during render; here the card calls this from an effect instead,
   * because persisting inside a render is how a re-render loop starts.
   */
  updateRoute: (flight: string, route: string) => void;
  isWatched: (flight: string) => boolean;
  /** Set after the FIRST add, so the push prompt can appear 500 ms later exactly once. */
  justAddedFirst: boolean;
  push: PushState;
};

const NULL_STORAGE = { getItem: () => null, setItem: () => {} };

const WatchContext = createContext<WatchValue | null>(null);

export function useWatch(): WatchValue {
  const ctx = useContext(WatchContext);
  if (!ctx) throw new Error('useWatch() outside <WatchProvider>');
  return ctx;
}

/** `urlBase64ToUint8Array` — the VAPID key arrives base64url and PushManager wants bytes. */
function vapidKeyToBytes(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const normalised = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(normalised);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

export function WatchProvider({ children }: { children: ReactNode }) {
  const [watched, setWatched] = useState<WatchedFlight[]>([]);
  const [configured, setConfigured] = useState(false);
  const [bootstrapped, setBootstrapped] = useState(false);
  const [vapidKey, setVapidKey] = useState<string | null>(null);
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(
    'unsupported',
  );
  const [prompted, setPrompted] = useState(true);
  const [justAddedFirst, setJustAddedFirst] = useState(false);
  const watchedRef = useRef<WatchedFlight[]>([]);
  watchedRef.current = watched;

  useEffect(() => {
    setWatched(readWatched(safeLocalStorage() ?? NULL_STORAGE) as WatchedFlight[]);
    setPrompted(readString(STORAGE_KEYS.pushPrompted) === '1');
    if (typeof Notification !== 'undefined') setPermission(Notification.permission);
    // `fetchPushConfig()` never rejects — a deployment without VAPID keys reports
    // `{configured:false}` rather than failing, so `bootstrapped` can be set flatly here.
    void fetchPushConfig().then((config) => {
      setConfigured(Boolean(config.configured));
      setVapidKey(config.vapidPublicKey ?? null);
      setBootstrapped(true);
    });
  }, []);

  /**
   * Another tab wrote the list. Re-read it rather than trusting this tab's copy.
   *
   * `event.key === null` is the spec's "this origin's storage was cleared", which has to
   * reconcile too. Same-window writes never fire this event, so it only ever carries news.
   */
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    function onStorage(event: StorageEvent) {
      if (event.key !== null && event.key !== STORAGE_KEYS.watchedFlights) return;
      setWatched(readWatched(safeLocalStorage() ?? NULL_STORAGE) as WatchedFlight[]);
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  /**
   * The list every mutation starts from: whatever is in storage RIGHT NOW, not what this
   * tab last rendered. Falls back to the in-memory list only when storage is unavailable
   * (Safari private mode), where there is no second tab to race and the session copy is
   * the only list there is.
   */
  const readLatest = useCallback(
    (storage: Storage | null): WatchedFlight[] =>
      storage ? (readWatched(storage) as WatchedFlight[]) : watchedRef.current,
    [],
  );

  /** Write the list, then publish exactly what was written. */
  const commit = useCallback((storage: Storage | null, list: WatchedFlight[]) => {
    const written = list.slice(0, MAX_WATCHED);
    writeWatched(storage ?? NULL_STORAGE, written);
    setWatched(written);
    return written;
  }, []);

  /**
   * Mirror the current list to the server. Requires a service worker, PushManager,
   * Notification permission and a configured server; an empty list unsubscribes. Failures
   * are swallowed — a broken push sync must never surface as a dashboard error.
   */
  const syncSubscription = useCallback(
    async (list: WatchedFlight[]) => {
      if (!configured || !vapidKey) return;
      if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
      try {
        const registration = await navigator.serviceWorker.ready;
        const existing = await registration.pushManager.getSubscription();
        if (list.length === 0) {
          if (existing) {
            await postPushSubscribe({
              action: 'unsubscribe',
              subscription: { endpoint: existing.endpoint },
            });
            await existing.unsubscribe();
          }
          return;
        }
        const subscription =
          existing ??
          (await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: vapidKeyToBytes(vapidKey) as BufferSource,
          }));
        const json = subscription.toJSON() as { endpoint?: string; keys?: Record<string, string> };
        await postPushSubscribe({
          subscription: { endpoint: json.endpoint ?? subscription.endpoint, keys: json.keys ?? {} },
          watches: list.map((entry) => ({ flight: entry.flight })),
        });
      } catch {
        /* push is best-effort */
      }
    },
    [configured, vapidKey],
  );

  const toggle = useCallback(
    (flight: string, route = '', status = '') => {
      const storage = safeLocalStorage();
      const current = readLatest(storage);
      const existing = current.findIndex((entry) => entry.flight === flight);
      let next: WatchedFlight[];
      let nowWatched: boolean;
      if (existing >= 0) {
        next = current.filter((_, i) => i !== existing);
        nowWatched = false;
      } else {
        next = [{ flight, route, status, ts: Date.now() }, ...current];
        nowWatched = true;
        if (current.length === 0) setJustAddedFirst(true);
      }
      void syncSubscription(commit(storage, next));
      return nowWatched;
    },
    [commit, readLatest, syncSubscription],
  );

  const clearAll = useCallback(() => {
    // The one mutation that does NOT read first: "clear" means clear, whatever another tab
    // has added since.
    commit(safeLocalStorage(), []);
    void syncSubscription([]);
  }, [commit, syncSubscription]);

  const applyStatusChanges = useCallback(
    (changes: WatchChange[]) => {
      if (!changes.length) return;
      const storage = safeLocalStorage();
      const current = readLatest(storage);
      const next = applyWatchChanges(current, changes) as WatchedFlight[];
      // `applyWatchChanges` hands back the SAME array when nothing moved, and most board
      // loads move nothing: no write, no `setWatched`, no re-render of every consumer, and
      // no `storage` event fired at the other tabs.
      if (next === current) return;
      // No `syncSubscription` in this path: the server subscription is keyed on WHICH
      // flights are watched, and that has not changed.
      commit(storage, next);
    },
    [commit, readLatest],
  );

  const updateStatus = useCallback(
    (flight: string, status: string) => applyStatusChanges([{ flight, status }]),
    [applyStatusChanges],
  );

  const updateRoute = useCallback(
    (flight: string, route: string) => applyStatusChanges([{ flight, route }]),
    [applyStatusChanges],
  );

  const isWatched = useCallback(
    (flight: string) => watchedRef.current.some((entry) => entry.flight === flight),
    [],
  );

  const markPrompted = useCallback(() => {
    writeString(STORAGE_KEYS.pushPrompted, '1');
    setPrompted(true);
    setJustAddedFirst(false);
  }, []);

  const enable = useCallback(async (): Promise<NotificationPermission | 'unsupported'> => {
    // Recorded BEFORE the browser prompt: a viewer who dismisses the native dialog has
    // still been asked, and must not be asked again on the next add.
    markPrompted();
    if (typeof Notification === 'undefined') return 'unsupported';
    const result = await Notification.requestPermission();
    setPermission(result);
    if (result === 'granted') await syncSubscription(watchedRef.current);
    return result;
  }, [markPrompted, syncSubscription]);

  /**
   * Background push is only REAL when every link in the chain holds: the deployment has
   * keys, the browser has a service worker and a PushManager, and the viewer has said
   * yes. The watch panel promises alerts-with-the-tab-closed off this and nothing else.
   */
  const backgroundActive =
    configured &&
    permission === 'granted' &&
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    typeof window !== 'undefined' &&
    'PushManager' in window;

  const value = useMemo<WatchValue>(
    () => ({
      watched,
      toggle,
      clearAll,
      updateStatus,
      applyStatusChanges,
      updateRoute,
      isWatched,
      justAddedFirst,
      push: {
        configured,
        bootstrapped,
        permission,
        backgroundActive,
        prompted,
        enable,
        dismissPrompt: markPrompted,
      },
    }),
    [
      watched,
      toggle,
      clearAll,
      updateStatus,
      applyStatusChanges,
      updateRoute,
      isWatched,
      justAddedFirst,
      configured,
      bootstrapped,
      permission,
      backgroundActive,
      prompted,
      enable,
      markPrompted,
    ],
  );

  return <WatchContext.Provider value={value}>{children}</WatchContext.Provider>;
}

export { MAX_WATCHED };
