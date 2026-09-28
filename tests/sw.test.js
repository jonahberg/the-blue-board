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
  it('serves hashed /_astro/* cache-first and does not touch the network on a hit', async () => {
    // The filename names the contents, so a cached copy can never be the wrong bytes.
    // Re-validating it would be a round trip that cannot change the answer.
    const { handlers, caches, fetchMock } = makeEnv();
    const staticCache = await caches.open(STATIC_CACHE);
    await staticCache.put(`${ORIGIN}/_astro/x-abc123.js`, netResponse('CACHED'));
    fetchMock.mockResolvedValue(netResponse('NETWORK'));

    const res = await runFetch(handlers, new Request(`${ORIGIN}/_astro/x-abc123.js`));

    expect(res.body).toBe('CACHED');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fetches and caches a /_astro/* asset it has never seen', async () => {
    const { handlers, caches, fetchMock } = makeEnv();
    fetchMock.mockResolvedValue(netResponse('FRESH'));

    const res = await runFetch(handlers, new Request(`${ORIGIN}/_astro/y-def456.css`));

    expect(res.body).toBe('FRESH');
    const staticCache = await caches.open(STATIC_CACHE);
    expect(await staticCache.match(`${ORIGIN}/_astro/y-def456.css`)).toBeDefined();
  });

  it('serves navigations network-first: a fresh document beats the cached one', async () => {
    // A stale HTML shell would pin visitors to an old build's asset URLs, which no longer
    // exist after a deploy — the exact failure the hashed-asset move is meant to end.
    const { handlers, caches, fetchMock } = makeEnv();
    const pageCache = await caches.open(`blueboard-pages-${CACHE_VERSION}`);
    await pageCache.put(`${ORIGIN}/`, netResponse('STALE', { contentType: 'text/html' }));
    fetchMock.mockResolvedValue(netResponse('FRESH', { contentType: 'text/html' }));

    const res = await runFetch(handlers, new Request(`${ORIGIN}/`));

    expect(fetchMock).toHaveBeenCalled();
    expect(res.body).toBe('FRESH');
  });

  it('falls back to the precached shell when a navigation fails offline', async () => {
    // Seeded by install(), which is the only thing that ever writes the '/' key.
    const { handlers, fetchMock } = makeEnv();
    let installed;
    handlers.install({ waitUntil: (p) => (installed = p) });
    await installed;
    fetchMock.mockRejectedValue(new Error('offline'));

    const res = await runFetch(handlers, new Request(`${ORIGIN}/hubs/ord.html`));

    expect(res.body).toBe('shell');
  });

  it('precaches the shell as a single URL — a second alias would fail the whole addAll', async () => {
    const { handlers, caches } = makeEnv();
    let done;
    handlers.install({ waitUntil: (p) => (done = p) });
    await done;
    const pageCache = await caches.open(`blueboard-pages-${CACHE_VERSION}`);
    expect(await pageCache.keys()).toEqual(['/']);
  });

  it('keeps non-code static assets (icons/fonts) stale-while-revalidate: returns the cached copy synchronously', async () => {
    const { handlers, caches, fetchMock } = makeEnv();
    const staticCache = await caches.open(STATIC_CACHE);
    await staticCache.put(`${ORIGIN}/icons/icon-192.png`, netResponse('CACHED', { contentType: 'image/png' }));
    fetchMock.mockResolvedValue(netResponse('NETWORK', { contentType: 'image/png' }));

    const res = await runFetch(handlers, new Request(`${ORIGIN}/icons/icon-192.png`));

    expect(res.body).toBe('CACHED');
  });

  it('ignores cross-origin requests (lets the browser handle basemap tiles directly)', async () => {
    const { handlers, fetchMock } = makeEnv();
    const event = {
      request: new Request('https://basemaps.cartocdn.com/dark_all/4/3/6.png'),
      respondWith: vi.fn(),
      waitUntil: vi.fn(),
    };
    handlers.fetch(event);
    expect(event.respondWith).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ── Runtime caching actually stores responses (v12) ─────────────────────────────────────────
// Every runtime-cache branch used to call networkResponse.clone() inside event.waitUntil AFTER
// `await caches.open(...)` — by then the browser had consumed the body it was handed through
// respondWith, clone() threw "Response body is already used", the rejection was swallowed by
// waitUntil, and nothing was ever cached (verified on production, Sep 26 2026: the data and
// static caches stayed empty across many navigations). The fake responses above clone forever,
// which is why the suite never noticed. These use a strict response + a caches.open that settles
// on a later tick, matching real browser timing.

function strictResponse(body, { contentType = 'application/json' } = {}) {
  return {
    ok: true,
    type: 'basic',
    body,
    bodyUsed: false,
    headers: new Headers({ 'content-type': contentType }),
    clone() {
      if (this.bodyUsed) throw new TypeError('Response body is already used');
      return { ...this, clone: this.clone, bodyUsed: false };
    },
  };
}

function makeStrictEnv() {
  const env = makeEnv();
  const realOpen = env.caches.open.bind(env.caches);
  env.caches.open = async (name) => {
    await new Promise((r) => setTimeout(r, 0));
    return realOpen(name);
  };
  return env;
}

// Like runFetch, but marks the committed response's body as consumed the moment respondWith
// settles — which is what the browser does — before the waitUntil work gets to run.
async function runFetchStrict(handlers, request) {
  const waits = [];
  const event = {
    request,
    respondWith(p) { this._resp = p; },
    waitUntil(p) { waits.push(p); },
  };
  handlers.fetch(event);
  const response = event._resp ? await event._resp : undefined;
  // Real Response objects (the SW's own 503s) have a read-only bodyUsed; only the fakes need marking.
  if (response && typeof response === 'object' && !(response instanceof Response)) response.bodyUsed = true;
  const settled = await Promise.allSettled(waits);
  return { response, rejected: settled.filter((s) => s.status === 'rejected') };
}

describe('sw.js — runtime caches really fill (strict body semantics)', () => {
  it('CACHE_VERSION is past v11, so the clone-before-return fix replaced the broken worker', () => {
    // Asserted as "newer than v11" rather than a literal, so an intended bump doesn't fail here.
    expect(CACHE_VERSION).toMatch(/^v\d+$/);
    expect(Number(CACHE_VERSION.slice(1))).toBeGreaterThan(11);
  });

  it('caches a navigation for offline use', async () => {
    const { handlers, caches, fetchMock } = makeStrictEnv();
    fetchMock.mockResolvedValue(strictResponse('HUB PAGE', { contentType: 'text/html' }));
    const { rejected } = await runFetchStrict(handlers, new Request(`${ORIGIN}/hubs/ord`, { mode: 'navigate' }));
    expect(rejected).toEqual([]);
    const pages = await caches.open(`blueboard-pages-${CACHE_VERSION}`);
    expect(await pages.match(`${ORIGIN}/hubs/ord`)).toBeDefined();
  });

  it('caches a hashed /_astro asset', async () => {
    const { handlers, caches, fetchMock } = makeStrictEnv();
    fetchMock.mockResolvedValue(strictResponse('JS', { contentType: 'application/javascript' }));
    const { rejected } = await runFetchStrict(handlers, new Request(`${ORIGIN}/_astro/app-Zz9.js`));
    expect(rejected).toEqual([]);
    const statics = await caches.open(STATIC_CACHE);
    expect(await statics.match(`${ORIGIN}/_astro/app-Zz9.js`)).toBeDefined();
  });

  it('caches a stale-while-revalidate static asset on first fetch', async () => {
    const { handlers, caches, fetchMock } = makeStrictEnv();
    fetchMock.mockResolvedValue(strictResponse('PNG', { contentType: 'image/png' }));
    const { rejected } = await runFetchStrict(handlers, new Request(`${ORIGIN}/icons/icon-512.png`));
    expect(rejected).toEqual([]);
    const statics = await caches.open(STATIC_CACHE);
    expect(await statics.match(`${ORIGIN}/icons/icon-512.png`)).toBeDefined();
  });

  it('caches offline-safe data (schedule boards carry their own "data as of"), and serves it offline', async () => {
    const { handlers, fetchMock } = makeStrictEnv();
    const url = `${ORIGIN}/api/schedule?hub=ORD&dir=departures&timestamp=1790395200`;
    fetchMock.mockResolvedValueOnce(strictResponse('{"total":637}'));
    const first = await runFetchStrict(handlers, new Request(url));
    expect(first.rejected).toEqual([]);

    fetchMock.mockRejectedValueOnce(new Error('offline'));
    const offline = await runFetchStrict(handlers, new Request(url));
    expect(offline.response.body).toBe('{"total":637}');
  });

  it('always asks the network for data, but lets the browser revalidate with its ETag (no-cache, not no-store)', async () => {
    const { handlers, fetchMock } = makeStrictEnv();
    fetchMock.mockResolvedValue(strictResponse('{"ok":true}'));
    await runFetchStrict(handlers, new Request(`${ORIGIN}/api/starlink-data?fields=roster`));
    const sent = fetchMock.mock.calls[0][0];
    expect(sent.cache).toBe('no-cache');
  });

  it.each([
    '/api/schedule?hub=ORD&dir=departures&timestamp=1790395200',
    '/api/starlink-data',
    '/api/fleet-summary',
    '/data/fleet.json',
  ])('caches offline-safe %s in the data cache', async (path) => {
    const { handlers, caches, fetchMock } = makeStrictEnv();
    fetchMock.mockResolvedValue(strictResponse('{"ok":true}'));
    const { rejected } = await runFetchStrict(handlers, new Request(`${ORIGIN}${path}`));
    expect(rejected).toEqual([]);
    const data = await caches.open(`blueboard-data-${CACHE_VERSION}`);
    expect(await data.match(`${ORIGIN}${path}`)).toBeDefined();
  });

  it('caches the static /data files', async () => {
    const { handlers, caches, fetchMock } = makeStrictEnv();
    fetchMock.mockResolvedValue(strictResponse('[]'));
    await runFetchStrict(handlers, new Request(`${ORIGIN}/data/fleet.json`));
    const data = await caches.open(`blueboard-data-${CACHE_VERSION}`);
    expect(await data.match(`${ORIGIN}/data/fleet.json`)).toBeDefined();
  });

  it('never caches the LIVE feed: offline it must fail, not replay old positions as "LIVE"', async () => {
    // Flaky airline Wi-Fi is this site's core audience. A cached fr24-feed would come back as a
    // 200 with hours-old aircraft positions under the LIVE badge whenever a request fails —
    // worse than an honest failure the dashboard already handles.
    const { handlers, caches, fetchMock } = makeStrictEnv();
    const url = `${ORIGIN}/api/fr24-feed`;
    fetchMock.mockResolvedValueOnce(strictResponse('{"live":true}'));
    await runFetchStrict(handlers, new Request(url));
    const data = await caches.open(`blueboard-data-${CACHE_VERSION}`);
    expect(await data.match(url)).toBeUndefined();

    fetchMock.mockRejectedValueOnce(new Error('offline'));
    const offline = await runFetchStrict(handlers, new Request(url));
    expect(offline.response.status).toBe(503);
  });

  for (const path of ['/api/metar', '/api/faa', '/api/nas', '/api/irops', '/api/fr24-flight?flight=UA1', '/api/flight-times?flight=UA1', '/api/predict-flight?flight=UA1', '/api/aircraft-history?reg=N1']) {
    it(`does not cache time-sensitive ${path}`, async () => {
      const { handlers, caches, fetchMock } = makeStrictEnv();
      fetchMock.mockResolvedValueOnce(strictResponse('{}'));
      await runFetchStrict(handlers, new Request(`${ORIGIN}${path}`));
      const data = await caches.open(`blueboard-data-${CACHE_VERSION}`);
      expect(await data.keys()).toEqual([]);
    });
  }
});
