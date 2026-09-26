const CACHE_VERSION = 'v11'; // bumped for the Astro/React rebuild: assets moved to hashed /_astro/*
const PAGE_CACHE = `blueboard-pages-${CACHE_VERSION}`;
const DATA_CACHE = `blueboard-data-${CACHE_VERSION}`;
const STATIC_CACHE = `blueboard-static-${CACHE_VERSION}`;
const CACHE_PREFIX = 'blueboard-';

const PAGE_MAX = 20;
const DATA_MAX = 80;
const STATIC_MAX = 120;

// Only the navigation shell is precached, and only '/' — the site builds with
// `format: 'file'`, so '/index.html' is a second URL for the same document and a single
// non-2xx from either one fails the whole `addAll()` and leaves the SW uninstalled.
//
// Nothing else belongs here. Every asset the app loads now lives under /_astro/ with a
// content hash in its filename, so a new deploy ships new URLs and the old ones simply
// stop being requested — there is no version to pin and nothing to invalidate.
const APP_SHELL = ['/'];

async function trimCache(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  let keys = await cache.keys();
  while (keys.length > maxEntries) {
    await cache.delete(keys[0]);
    keys = await cache.keys();
  }
}

function isCacheable(response) {
  if (!response || !response.ok) return false;
  return response.type === 'basic' || response.type === 'cors';
}

function isHtmlResponse(response) {
  if (!isCacheable(response)) return false;
  const contentType = response.headers.get('content-type') || '';
  return contentType.includes('text/html');
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(PAGE_CACHE);
    await cache.addAll(APP_SHELL);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((key) => key.startsWith(CACHE_PREFIX) && ![PAGE_CACHE, DATA_CACHE, STATIC_CACHE].includes(key))
        .map((key) => caches.delete(key))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  // Required Chrome guard: these requests cannot be fulfilled with fetch() for non-same-origin mode.
  if (request.cache === 'only-if-cached' && request.mode !== 'same-origin') return;

  const url = new URL(request.url);

  // Let the browser handle all cross-origin resources directly (Leaflet/CDNs/tiles/etc).
  if (url.origin !== self.location.origin) return;

  const isNavigation = request.mode === 'navigate' || request.destination === 'document' || url.pathname === '/' || url.pathname.endsWith('.html');
  const isDataRequest = url.pathname.startsWith('/api/') || url.pathname.startsWith('/data/');

  if (isNavigation) {
    event.respondWith((async () => {
      try {
        const networkRequest = new Request(request, { cache: 'reload' });
        const networkResponse = await fetch(networkRequest);
        if (isHtmlResponse(networkResponse)) {
          event.waitUntil((async () => {
            const cache = await caches.open(PAGE_CACHE);
            await cache.put(request, networkResponse.clone());
            await trimCache(PAGE_CACHE, PAGE_MAX);
          })());
        }
        return networkResponse;
      } catch (_err) {
        const cached = await caches.match(request);
        if (cached) return cached;
        // Any navigation offline falls back to the precached shell: the dashboard is a
        // client-side island, so '/' can render the tab the deep link asked for once it
        // boots. Better a working app than a browser error page.
        const fallback = await caches.match('/');
        if (fallback) return fallback;
        return new Response('Offline', { status: 503, headers: { 'content-type': 'text/plain' } });
      }
    })());
    return;
  }

  if (isDataRequest) {
    event.respondWith((async () => {
      try {
        const networkRequest = new Request(request, { cache: 'no-store' });
        const networkResponse = await fetch(networkRequest);
        if (isCacheable(networkResponse)) {
          event.waitUntil((async () => {
            const cache = await caches.open(DATA_CACHE);
            await cache.put(request, networkResponse.clone());
            await trimCache(DATA_CACHE, DATA_MAX);
          })());
        }
        return networkResponse;
      } catch (_err) {
        const cached = await caches.match(request);
        if (cached) return cached;
        return new Response(JSON.stringify({ error: 'offline' }), {
          status: 503,
          headers: { 'content-type': 'application/json' }
        });
      }
    })());
    return;
  }

  // Hashed build output is immutable BY CONSTRUCTION: /_astro/app-B2kQ9f.js names its own
  // contents, so the bytes behind that URL can never change. Cache-first with no
  // revalidation is therefore not a staleness risk — it is the only correct strategy, and
  // it is what makes a warm load instant. A new deploy requests different filenames.
  //
  // This replaces the network-first /js/* + /css/style.css branch, which existed only
  // because those files were NOT hashed: a deploy reused the same URLs, so the SW had to
  // re-check them every load or shipped fixes never reached returning users. Nothing is
  // served from /js/ or /css/ any more.
  if (url.pathname.startsWith('/_astro/')) {
    event.respondWith((async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      try {
        const networkResponse = await fetch(request);
        if (isCacheable(networkResponse)) {
          event.waitUntil((async () => {
            const cache = await caches.open(STATIC_CACHE);
            await cache.put(request, networkResponse.clone());
            await trimCache(STATIC_CACHE, STATIC_MAX);
          })());
        }
        return networkResponse;
      } catch (_err) {
        return new Response('Offline', { status: 503, headers: { 'content-type': 'text/plain' } });
      }
    })());
    return;
  }

  // Same-origin static assets: stale-while-revalidate.
  event.respondWith((async () => {
    const cached = await caches.match(request);
    const networkPromise = fetch(request)
      .then((networkResponse) => {
        if (isCacheable(networkResponse)) {
          event.waitUntil((async () => {
            const cache = await caches.open(STATIC_CACHE);
            await cache.put(request, networkResponse.clone());
            await trimCache(STATIC_CACHE, STATIC_MAX);
          })());
        }
        return networkResponse;
      })
      .catch(() => null);

    if (cached) {
      networkPromise.catch(() => null);
      return cached;
    }

    const networkResponse = await networkPromise;
    if (networkResponse) return networkResponse;
    return new Response('Offline', { status: 503, headers: { 'content-type': 'text/plain' } });
  })());
});

// ═══ PUSH HANDLER (server-side background flight-watch alerts) ═══
// Payload shape from api/cron/watch-alerts.ts:
//   { title, body, tag, url }
// Adding this handler does NOT change any cached asset, so per the header convention above
// CACHE_VERSION is intentionally NOT bumped.
self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (_e) {
    payload = { title: 'The Blue Board', body: event.data ? event.data.text() : '' };
  }
  const title = payload.title || 'The Blue Board';
  const url = payload.url || '/';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body || '',
      tag: payload.tag || undefined,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url: url },
    })
  );
});

// ═══ NOTIFICATION CLICK HANDLER ═══
// Handles both the in-tab watch notifications (data.flight) and the server push notifications
// (data.url). data.url wins when present; otherwise fall back to the flight deep link.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const flight = data.flight || '';
  const urlPath = data.url || (flight ? '/?flight=' + encodeURIComponent(flight) : '/');

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // Focus existing window if available
      for (const client of clients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          if (urlPath && urlPath !== '/') client.navigate(self.location.origin + urlPath);
          return client.focus();
        }
      }
      // Open new window if no existing client
      return self.clients.openWindow(urlPath);
    })
  );
});
