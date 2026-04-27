// CACHE_VERSION is replaced at build time by scripts/stamp-sw-version.mjs.
// The placeholder string in the constant below must remain unchanged in source.
// Local dev (no build step) sees the unreplaced literal; the SW activates on
// install regardless, and the dev value is stable across reloads.
const CACHE_VERSION = 'v9-__BUILD_SHA__';
const PAGE_CACHE = `blueboard-pages-${CACHE_VERSION}`;
const DATA_CACHE = `blueboard-data-${CACHE_VERSION}`;
const STATIC_CACHE = `blueboard-static-${CACHE_VERSION}`;
const CACHE_PREFIX = 'blueboard-';

const PAGE_MAX = 20;
const DATA_MAX = 80;
const STATIC_MAX = 120;

const APP_SHELL = ['/', '/index.html', '/css/style.css?v=1', '/js/dashboard.js'];

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

  // Per-user authenticated Pro endpoints — never cache. Letting these into
  // DATA_CACHE risks serving one user's flights / subscription state to
  // another session on the same device. Skip the SW entirely so the browser
  // honors the Cache-Control: no-store header from the API.
  if (url.pathname.startsWith('/api/pro/') || url.pathname.startsWith('/api/auth/') || url.pathname.startsWith('/api/stripe/')) {
    return;
  }

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

// ═══ PUSH EVENT HANDLER ═══
// Receives VAPID-signed push payloads from api/_alert-dispatcher.ts.
// Payload shape: { title, body, url, flight }
self.addEventListener('push', (event) => {
  let data = {};
  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      // Treat as plain text
      try { data = { title: 'The Blue Board', body: event.data.text() }; } catch (_) { data = {}; }
    }
  }
  const title = data.title || 'The Blue Board';
  const options = {
    body: data.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: { url: data.url || '/pro/flights', flight: data.flight || '' },
    tag: data.flight ? 'tbb-' + data.flight : 'tbb',
    renotify: true,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// ═══ NOTIFICATION CLICK HANDLER ═══
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  // Pro alerts pass an explicit URL; legacy notifications use ?flight=...
  const targetPath = data.url
    ? new URL(data.url, self.location.origin).pathname + new URL(data.url, self.location.origin).search
    : data.flight
      ? '/?flight=' + encodeURIComponent(data.flight)
      : '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          if (targetPath && targetPath !== '/') client.navigate(self.location.origin + targetPath);
          return client.focus();
        }
      }
      return self.clients.openWindow(targetPath);
    })
  );
});
