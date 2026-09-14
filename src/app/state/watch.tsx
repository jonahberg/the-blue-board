/**
 * The watch list and its push subscription (inventory §6).
 *
 * `bb_watched_flights` is a compatibility contract: `[{flight, route, status, ts}]`, at most
 * 20 entries, exactly as `src/lib/watch-utils.js` reads and writes it. A returning visitor
 * must find the same list after this rebuild, so the shape is never "modernised" here.
 *
 * Push is best-effort by design and never throws: `/api/push-subscribe` reports whether the
 * server has VAPID keys at all, and a browser without a service worker, PushManager or
 * granted permission simply keeps the in-page banner instead.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { MAX_WATCHED, readWatched, writeWatched } from '@/lib/watch-utils.js';
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

  const persist = useCallback((list: WatchedFlight[]) => {
    writeWatched(safeLocalStorage() ?? NULL_STORAGE, list);
    setWatched(list);
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
      const current = watchedRef.current;
      const existing = current.findIndex((entry) => entry.flight === flight);
      let next: WatchedFlight[];
      let nowWatched: boolean;
      if (existing >= 0) {
        next = current.filter((_, i) => i !== existing);
        nowWatched = false;
      } else {
        next = [{ flight, route, status, ts: Date.now() }, ...current].slice(0, MAX_WATCHED);
        nowWatched = true;
        if (current.length === 0) setJustAddedFirst(true);
      }
      persist(next);
      void syncSubscription(next);
      return nowWatched;
    },
    [persist, syncSubscription],
  );

  const clearAll = useCallback(() => {
    persist([]);
    void syncSubscription([]);
  }, [persist, syncSubscription]);

  const updateStatus = useCallback(
    (flight: string, status: string) => {
      const current = watchedRef.current;
      const index = current.findIndex((entry) => entry.flight === flight);
      if (index < 0 || current[index].status === status) return;
      const next = current.map((entry, i) =>
        i === index ? { ...entry, status, ts: Date.now() } : entry,
      );
      // No `syncSubscription` here: the server subscription is keyed on WHICH flights are
      // watched, and that has not changed.
      persist(next);
    },
    [persist],
  );

  const updateRoute = useCallback(
    (flight: string, route: string) => {
      const current = watchedRef.current;
      const index = current.findIndex((entry) => entry.flight === flight);
      if (index < 0 || !route || current[index].route === route) return;
      // No `ts` bump and no `syncSubscription`: WHICH flights are watched has not
      // changed, and neither has when the viewer last saw a status.
      persist(current.map((entry, i) => (i === index ? { ...entry, route } : entry)));
    },
    [persist],
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
