/**
 * Hub page live data refresh (formerly `public/js/hub-live-data.js`).
 *
 * Bundled by Astro into `_astro/` from a relative `<script src>` in
 * `HubLayout.astro`, so Content-Security-Policy keeps `script-src 'self'` with
 * no inline script. Bundled scripts are `type="module"` and therefore deferred,
 * so `document.body` is always present by the time this runs.
 *
 * The IATA code is read from `data-hub-iata` on `<body>` (set by the layout).
 * A no-op on any page where that attribute is absent.
 */

const iata = document.body?.getAttribute('data-hub-iata');

if (iata) {
  /** FR24's feed is served either as an array or as a keyed object of rows. */
  type FeedRow = unknown[] | { origin?: string; dest?: string };

  const setUpdatedLabel = (text: string) => {
    const updated = document.getElementById('updated-time');
    if (updated) updated.textContent = text;
  };

  const loadLiveData = async () => {
    try {
      const response = await fetch('/api/fr24-feed?airline=UAL');
      if (!response.ok) throw new Error('Feed unavailable');

      const payload = await response.json();
      const feed = payload?.result?.response?.data ?? payload;
      const rows: FeedRow[] = Array.isArray(feed)
        ? feed
        : typeof feed === 'object' && feed !== null
          ? Object.values(feed)
          : [];

      let active = 0;
      for (const row of rows) {
        const origin = Array.isArray(row) ? row[11] : row?.origin;
        const dest = Array.isArray(row) ? row[12] : row?.dest;
        if (origin === iata || dest === iata) active += 1;
      }

      for (const id of ['active', 'active-stat']) {
        const el = document.getElementById(id);
        if (el) el.textContent = String(active);
      }

      setUpdatedLabel(
        `Updated ${new Date().toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          timeZoneName: 'short',
        })}`,
      );
    } catch {
      setUpdatedLabel('Live data temporarily unavailable');
    }
  };

  // Poll every 30s, but only while the tab is visible. A backgrounded hub tab
  // previously kept hitting /api/fr24-feed forever (2,880 invocations/day per
  // tab); now it pauses when hidden and refreshes once on return so the count
  // is current without the wasted lambda invocations.
  let timer: ReturnType<typeof setInterval> | null = null;
  const startPolling = () => {
    if (timer === null) timer = setInterval(loadLiveData, 30_000);
  };
  const stopPolling = () => {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopPolling();
    } else {
      void loadLiveData();
      startPolling();
    }
  });

  void loadLiveData();
  if (!document.hidden) startPolling();
}

export {};
