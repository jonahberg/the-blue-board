import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const swSource = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
const CACHE_VERSION = swSource.match(/CACHE_VERSION = '([^']+)'/)[1];
const STATIC_CACHE = `blueboard-static-${CACHE_VERSION}`;

const ORIGIN = 'https://theblueboard.co';

function keyOf(x) {
  return typeof x === 'string' ? x : (x && x.url) || String(x);
}

class FakeCache {
  constructor() {
    this.map = new Map();
  }
  async keys() {
    return [...this.map.keys()];
  }
  async put(req, res) {
    this.map.set(keyOf(req), res);
  }
  async delete(key) {
    return this.map.delete(keyOf(key));
  }
  async match(req) {
    return this.map.get(keyOf(req));
  }
  async addAll(urls) {
    for (const u of urls) this.map.set(keyOf(u), { ok: true, body: 'shell' });
  }
}

// A response object shaped like the fields the SW actually reads (ok/type/headers/clone).
// Real Response.type is read-only 'default' for constructed responses, so we mock it directly.
function netResponse(body, { ok = true, type = 'basic', contentType = 'application/javascript' } = {}) {
  return {
    ok,
    type,
    body,
    headers: new Headers(contentType ? { 'content-type': contentType } : {}),
    clone() {
      return this;
    },
  };
}

function makeEnv() {
  const cacheStore = new Map();
  const caches = {
    async open(name) {
      if (!cacheStore.has(name)) cacheStore.set(name, new FakeCache());
      return cacheStore.get(name);
    },
    async keys() {
      return [...cacheStore.keys()];
    },
    async delete(name) {
      return cacheStore.delete(name);
    },
    async has(name) {
      return cacheStore.has(name);
    },
    async match(req) {
      for (const c of cacheStore.values()) {
        const m = await c.match(req);
        if (m !== undefined) return m;
      }
      return undefined;
    },
  };
  const handlers = {};
  const self = {
    addEventListener(type, fn) {
      handlers[type] = fn;
    },
    skipWaiting: vi.fn(async () => {}),
    location: { origin: ORIGIN },
    registration: { showNotification: vi.fn(async () => {}) },
    clients: {
      claim: vi.fn(async () => {}),
      matchAll: vi.fn(async () => []),
      openWindow: vi.fn(async () => ({})),
    },
  };
  const fetchMock = vi.fn();
  const context = {
    self,
    caches,
    fetch: fetchMock,
    URL,
    Request,
    Response,
    Headers,
    Promise,
    console,
  };
  vm.createContext(context);
  vm.runInContext(swSource, context);
  return { handlers, caches, self, fetchMock, cacheStore, context };
}

// Drive a fetch event through the SW and resolve the response it commits to respondWith.
async function runFetch(handlers, request) {
  const waits = [];
  const event = {
    request,
    respondWith(p) {
      this._resp = p;
    },
    waitUntil(p) {
      waits.push(p);
    },
  };
  handlers.fetch(event);
  const response = event._resp ? await event._resp : undefined;
  await Promise.allSettled(waits);
  return response;
}

describe('sw.js — pure helpers (network response classification)', () => {
  let context;
  beforeEach(() => {
    context = makeEnv().context;
  });

  it('isCacheable accepts ok basic/cors, rejects opaque, non-ok, and null', () => {
    expect(context.isCacheable({ ok: true, type: 'basic' })).toBe(true);
    expect(context.isCacheable({ ok: true, type: 'cors' })).toBe(true);
    expect(context.isCacheable({ ok: true, type: 'opaque' })).toBe(false);
    expect(context.isCacheable({ ok: false, type: 'basic' })).toBe(false);
    expect(context.isCacheable(null)).toBe(false);
    expect(context.isCacheable(undefined)).toBe(false);
  });

  it('isHtmlResponse is true only for cacheable text/html', () => {
    const html = { ok: true, type: 'basic', headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }) };
    const json = { ok: true, type: 'basic', headers: new Headers({ 'content-type': 'application/json' }) };
    const opaqueHtml = { ok: true, type: 'opaque', headers: new Headers({ 'content-type': 'text/html' }) };
    expect(context.isHtmlResponse(html)).toBe(true);
    expect(context.isHtmlResponse(json)).toBe(false);
    expect(context.isHtmlResponse(opaqueHtml)).toBe(false);
  });
});

describe('sw.js — trimCache LRU eviction', () => {
  it('evicts the oldest entries first, down to maxEntries', async () => {
    const { caches, context } = makeEnv();
    const cache = await caches.open('trim-test');
    for (let i = 0; i < 5; i++) await cache.put(`${ORIGIN}/u${i}`, netResponse(`u${i}`));
    await context.trimCache('trim-test', 3);
    const keys = await cache.keys();
    expect(keys).toEqual([`${ORIGIN}/u2`, `${ORIGIN}/u3`, `${ORIGIN}/u4`]);
  });

  it('is a no-op when already at or under the cap', async () => {
    const { caches, context } = makeEnv();
    const cache = await caches.open('trim-test');
    await cache.put(`${ORIGIN}/only`, netResponse('only'));
    await context.trimCache('trim-test', 3);
    expect(await cache.keys()).toEqual([`${ORIGIN}/only`]);
  });
});

describe('sw.js — activate reaps old caches', () => {
  it('deletes prior-version blueboard caches, keeps current trio, leaves foreign caches alone', async () => {
    const { handlers, caches, cacheStore, self } = makeEnv();
    // Seed a prior version, the current three, and an unrelated foreign cache.
    await caches.open('blueboard-pages-v9');
    await caches.open('blueboard-static-v9');
    await caches.open(`blueboard-pages-${CACHE_VERSION}`);
    await caches.open(`blueboard-data-${CACHE_VERSION}`);
    await caches.open(`blueboard-static-${CACHE_VERSION}`);
    await caches.open('workbox-precache');

    let done;
    handlers.activate({ waitUntil: (p) => (done = p) });
    await done;

    expect(await caches.has('blueboard-pages-v9')).toBe(false);
    expect(await caches.has('blueboard-static-v9')).toBe(false);
    expect(await caches.has(`blueboard-pages-${CACHE_VERSION}`)).toBe(true);
    expect(await caches.has(`blueboard-data-${CACHE_VERSION}`)).toBe(true);
    expect(await caches.has(`blueboard-static-${CACHE_VERSION}`)).toBe(true);
    expect(await caches.has('workbox-precache')).toBe(true);
    expect(self.clients.claim).toHaveBeenCalled();
  });
});

describe('sw.js — push handler', () => {
  it('renders a notification from a JSON payload with title/body/tag/url', async () => {
    const { handlers, self } = makeEnv();
    const payload = { title: 'UA123 delayed', body: 'Now departing 14:05', tag: 'UA123', url: '/?flight=UA123' };
    let done;
    handlers.push({ data: { json: () => payload }, waitUntil: (p) => (done = p) });
    await done;
    expect(self.registration.showNotification).toHaveBeenCalledWith(
      'UA123 delayed',
      expect.objectContaining({ body: 'Now departing 14:05', tag: 'UA123', data: { url: '/?flight=UA123' } })
    );
  });

  it('falls back to a safe default notification when data is empty, without throwing', async () => {
    const { handlers, self } = makeEnv();
    let done;
    expect(() => handlers.push({ data: null, waitUntil: (p) => (done = p) })).not.toThrow();
    await done;
    expect(self.registration.showNotification).toHaveBeenCalledWith(
      'The Blue Board',
      expect.objectContaining({ body: '', data: { url: '/' } })
    );
  });

  it('recovers from a non-JSON payload by using the raw text body', async () => {
    const { handlers, self } = makeEnv();
    let done;
    const data = {
      json() {
        throw new Error('not json');
      },
      text() {
        return 'raw push text';
      },
    };
    handlers.push({ data, waitUntil: (p) => (done = p) });
    await done;
    expect(self.registration.showNotification).toHaveBeenCalledWith(
      'The Blue Board',
      expect.objectContaining({ body: 'raw push text' })
    );
  });
});

describe('sw.js — notificationclick handler', () => {
  it('opens a new window at data.url when no client is focused', async () => {
    const { handlers, self } = makeEnv();
    self.clients.matchAll.mockResolvedValue([]);
    const notification = { close: vi.fn(), data: { url: '/?flight=UA99' } };
    let done;
    handlers.notificationclick({ notification, waitUntil: (p) => (done = p) });
    await done;
    expect(notification.close).toHaveBeenCalled();
    expect(self.clients.openWindow).toHaveBeenCalledWith('/?flight=UA99');
  });

  it('focuses and navigates an existing same-origin client instead of opening a new one', async () => {
    const { handlers, self } = makeEnv();
    const client = {
      url: `${ORIGIN}/`,
      focus: vi.fn(() => 'focused'),
      navigate: vi.fn(),
    };
    self.clients.matchAll.mockResolvedValue([client]);
    const notification = { close: vi.fn(), data: { url: '/?flight=UA42' } };
    let done;
    handlers.notificationclick({ notification, waitUntil: (p) => (done = p) });
    await done;
    expect(client.navigate).toHaveBeenCalledWith(`${ORIGIN}/?flight=UA42`);
    expect(client.focus).toHaveBeenCalled();
    expect(self.clients.openWindow).not.toHaveBeenCalled();
  });

  it('falls back to the flight deep link when no data.url is present', async () => {
    const { handlers, self } = makeEnv();
    self.clients.matchAll.mockResolvedValue([]);
    const notification = { close: vi.fn(), data: { flight: 'UA7' } };
    let done;
    handlers.notificationclick({ notification, waitUntil: (p) => (done = p) });
    await done;
    expect(self.clients.openWindow).toHaveBeenCalledWith('/?flight=UA7');
  });
});

describe('sw.js — fetch routing strategy', () => {
  it('serves first-party /js/* network-first: returns the fresh network copy even when a stale one is cached (C57)', async () => {
    const { handlers, caches, fetchMock } = makeEnv();
    const staticCache = await caches.open(STATIC_CACHE);
    await staticCache.put(`${ORIGIN}/js/support-meter.js`, netResponse('STALE'));
    fetchMock.mockResolvedValue(netResponse('FRESH'));

    const res = await runFetch(handlers, new Request(`${ORIGIN}/js/support-meter.js`));

    expect(fetchMock).toHaveBeenCalled();
    expect(res.body).toBe('FRESH');
  });

  it('serves the stylesheet network-first as well', async () => {
    const { handlers, caches, fetchMock } = makeEnv();
    const staticCache = await caches.open(STATIC_CACHE);
    await staticCache.put(`${ORIGIN}/css/style.css`, netResponse('STALE', { contentType: 'text/css' }));
    fetchMock.mockResolvedValue(netResponse('FRESH', { contentType: 'text/css' }));

    const res = await runFetch(handlers, new Request(`${ORIGIN}/css/style.css`));

    expect(fetchMock).toHaveBeenCalled();
    expect(res.body).toBe('FRESH');
  });

  it('keeps non-code static assets (icons/fonts) stale-while-revalidate: returns the cached copy synchronously', async () => {
    const { handlers, caches, fetchMock } = makeEnv();
    const staticCache = await caches.open(STATIC_CACHE);
    await staticCache.put(`${ORIGIN}/icons/icon-192.png`, netResponse('CACHED', { contentType: 'image/png' }));
    fetchMock.mockResolvedValue(netResponse('NETWORK', { contentType: 'image/png' }));

    const res = await runFetch(handlers, new Request(`${ORIGIN}/icons/icon-192.png`));

    expect(res.body).toBe('CACHED');
  });

  it('ignores cross-origin requests (lets the browser handle CDNs/tiles directly)', async () => {
    const { handlers, fetchMock } = makeEnv();
    const event = {
      request: new Request('https://unpkg.com/leaflet/leaflet.js'),
      respondWith: vi.fn(),
      waitUntil: vi.fn(),
    };
    handlers.fetch(event);
    expect(event.respondWith).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
