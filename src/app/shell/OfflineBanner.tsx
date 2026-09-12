/**
 * "You are offline."
 *
 * Driven ONLY by the browser's `online`/`offline` events, never asserted proactively on
 * load: `navigator.onLine` reports false in enough false-positive situations (captive
 * portals, some VPN transitions, Chrome on a fresh profile) that showing the banner before
 * an event has fired tells working visitors they are offline.
 */

import { useEffect, useState } from 'react';

export function OfflineBanner() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const goOffline = () => setOffline(true);
    const goOnline = () => setOffline(false);
    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);
    return () => {
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', goOnline);
    };
  }, []);

  if (!offline) return null;
  return (
    <div
      role="alert"
      aria-live="assertive"
      className="shrink-0 bg-amber-500/15 px-3 py-1.5 text-center text-xs text-amber-300 md:px-4"
    >
      <span aria-hidden="true">⚠</span> You are offline — data may be outdated. Reconnect to see
      live updates.
    </div>
  );
}
