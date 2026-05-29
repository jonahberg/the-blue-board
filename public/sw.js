const CACHE_VERSION = 'v9'; // bumped to purge the v8 precache that pinned the old dashboard.js / style.css
const PAGE_CACHE = `blueboard-pages-${CACHE_VERSION}`;
const DATA_CACHE = `blueboard-data-${CACHE_VERSION}`;
const STATIC_CACHE = `blueboard-static-${CACHE_VERSION}`;
const CACHE_PREFIX = 'blueboard-';

const PAGE_MAX = 20;
const DATA_MAX = 80;
const STATIC_MAX = 120;

// Only the navigation shell is precached. The app's own code (dashboard.js / style.css) is served
// network-first in the fetch handler so a new deploy reaches returning users immediately, instead
// of being pinned here until CACHE_VERSION is manually bumped. (Audit critic #1.)
const APP_SHELL = ['/', '/index.html'];

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
        const fallback = await caches.match('/index.html');
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

  // The app's own code (dashboard bundle + stylesheet) is NOT content-hashed, so serve it
  // network-first: always fetch the latest when online so shipped fixes reach returning users,
  // falling back to cache only when offline. Other static assets (fonts, images) stay
  // stale-while-revalidate below. (Audit critic #1: immutable + non-hashed + SW precache pinning
  // meant deploys never reached users.)
  const isAppCode = url.pathname === '/js/dashboard.js' || url.pathname === '/css/style.css';
  if (isAppCode) {
    event.respondWith((async () => {
      try {
        const networkResponse = await fetch(new Request(request, { cache: 'no-cache' }));
        if (isCacheable(networkResponse)) {
          event.waitUntil((async () => {
            const cache = await caches.open(STATIC_CACHE);
            await cache.put(request, networkResponse.clone());
            await trimCache(STATIC_CACHE, STATIC_MAX);
          })());
        }
        return networkResponse;
      } catch (_err) {
        const cached = await caches.match(request);
        if (cached) return cached;
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

// ═══ NOTIFICATION CLICK HANDLER ═══
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const flight = event.notification.data?.flight || '';
  const urlPath = flight ? '/?flight=' + encodeURIComponent(flight) : '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // Focus existing window if available
      for (const client of clients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          if (flight) client.navigate(self.location.origin + urlPath);
          return client.focus();
        }
      }
      // Open new window if no existing client
      return self.clients.openWindow(urlPath);
    })
  );
});
