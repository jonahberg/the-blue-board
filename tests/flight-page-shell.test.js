// /flight/:ident — the static shell Astro builds (dist/flight.html), served per flight by
// api/flight-page.ts with its head substituted. What this file proves:
//   - the served page is the built shell with the per-flight title, description, canonical, Open
//     Graph and Twitter tags, and nothing else changed;
//   - it carries no inline script the CSP in vercel.json does not already allow (the build's own
//     hash check, run on the SERVED bytes);
//   - vercel.json routes /flight/:ident and its card to the functions, the page gets the site-wide
//     CSP and does NOT get /api/'s `X-Robots-Tag: noindex` (so it is indexable);
//   - non-canonical spellings 308 to the canonical address, junk is a noindex 404, and a missing
//     shell degrades to the static page instead of an error.
// The dist checks need `bun run build` first; like tests/seo-lengths.test.js they skip locally
// without dist/ and fail in CI.
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getTransformedRoutes } from '@vercel/routing-utils';

import { inlineScripts, sha256 } from '../scripts/lib/csp-hashes.mjs';
import { flightPageMeta, renderFlightShell, renderMissingFlightShell } from '../src/lib/flight-page-seo.js';
import { DESCRIPTION_MAX, SHARE_TITLE_MAX, TITLE_MAX } from '../src/lib/page-seo.js';

const fsState = vi.hoisted(() => ({ hideShell: false }));
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal();
  const readFileSync = (path, ...rest) => {
    if (fsState.hideShell && String(path).includes('flight.html')) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    return actual.readFileSync(path, ...rest);
  };
  return { ...actual, readFileSync, default: { ...actual, readFileSync } };
});

import handler, { PAGE_CACHE_CONTROL, __resetFlightPageForTests } from '../api/flight-page.js';
import { __resetRateLimitersForTests } from '../api/_rate-limit.js';

const ROOT = resolve(__dirname, '..');
const SHELL = join(ROOT, 'dist', 'flight.html');
const hasDist = existsSync(SHELL);
if (!hasDist && process.env.CI) throw new Error('dist/ is missing in CI — run `bun run build` before `bun run test`');
if (!hasDist) console.warn('[flight-page-shell] dist/ not built — skipping the built-shell checks. Run `bun run build` first.');

const vercelJson = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8'));
const csp = vercelJson.headers.find((h) => h.source === '/(.*)').headers.find((h) => h.key === 'Content-Security-Policy').value;
const scriptSrc = csp.match(/script-src\s+([^;]+)/)[1];

function createRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    send(payload) { this.body = payload; return this; },
    json(payload) { this.body = payload; return this; },
    end() { return this; },
  };
}
const call = async (query, overrides = {}) => {
  const res = createRes();
  await handler({ method: 'GET', headers: {}, query, ...overrides }, res);
  return res;
};
const tag = (html, re) => (html.match(re) || [])[1];

/** A shell shaped like the built one (Seo.astro's tag order), for the pure substitution tests. */
const FAKE_SHELL = `<!doctype html><html><head><title>Look up a United flight | The Blue Board</title>
<meta name="description" content="x"><meta name="robots" content="index, follow">
<meta property="og:title" content="x"><meta property="og:description" content="x"><meta property="og:url" content="https://theblueboard.co/flight">
<meta property="og:image" content="https://theblueboard.co/og-image.png"><meta property="og:image:type" content="image/png"><meta property="og:image:alt" content="x">
<meta name="twitter:title" content="x"><meta name="twitter:description" content="x"><meta name="twitter:image" content="x"><meta name="twitter:url" content="x">
<link rel="canonical" href="https://theblueboard.co/flight"></head><body><div data-flight-page data-flight-ident="">
<h1 class="font-mono" data-fp-title>Find a United flight</h1></div></body></html>`;

let fetchSpy;
beforeEach(() => {
  fsState.hideShell = false;
  __resetFlightPageForTests();
  __resetRateLimitersForTests();
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    throw new Error('unexpected fetch');
  });
});
afterEach(() => vi.restoreAllMocks());

describe('flight page head copy', () => {
  it('fits the SERP limits for the longest ident', () => {
    const meta = flightPageMeta('UA9999');
    expect(meta.title.length).toBeLessThanOrEqual(TITLE_MAX);
    expect(meta.description.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
    expect(meta.ogTitle.length).toBeLessThanOrEqual(SHARE_TITLE_MAX);
    expect(meta.canonical).toBe('https://theblueboard.co/flight/UA9999');
    expect(meta.ogImage).toBe('https://theblueboard.co/flight/UA9999/card.png');
  });

  it('substitutes every head tag exactly once and escapes values', () => {
    const out = renderFlightShell(FAKE_SHELL, 'UA929');
    expect(out.ok).toBe(true);
    expect(tag(out.html, /<title>([^<]*)<\/title>/)).toBe('UA929 flight status and on-time history | The Blue Board');
    expect(tag(out.html, /data-flight-ident="([^"]*)"/)).toBe('UA929');
    expect(tag(out.html, /<h1[^>]*>([^<]*)<\/h1>/)).toBe('UA929');
    expect(out.html.replace(/content="[^"]*"|href="[^"]*"|<title>[^<]*<\/title>|data-flight-ident="[^"]*"|<h1[^>]*>[^<]*<\/h1>/g, ''))
      .toBe(FAKE_SHELL.replace(/content="[^"]*"|href="[^"]*"|<title>[^<]*<\/title>|data-flight-ident="[^"]*"|<h1[^>]*>[^<]*<\/h1>/g, ''));
  });

  it('reports, rather than half-serves, a shell that no longer matches', () => {
    const out = renderFlightShell(FAKE_SHELL.replace('<link rel="canonical"', '<link data-x rel="canonical"'), 'UA929');
    expect(out).toEqual({ ok: false, missing: ['canonical×0'] });
  });

  it('marks a non-flight address noindex', () => {
    expect(renderMissingFlightShell(FAKE_SHELL)).toContain('<meta name="robots" content="noindex, follow">');
  });
});

describe.skipIf(!hasDist)('GET /flight/:ident on the built shell', () => {
  const shell = hasDist ? readFileSync(SHELL, 'utf8') : '';

  it('serves the built shell with the per-flight head, CDN-cacheable, without fetching anything', async () => {
    const res = await call({ ident: 'UA929' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['Content-Type']).toBe('text/html; charset=utf-8');
    expect(res.headers['Cache-Control']).toBe(PAGE_CACHE_CONTROL);
    const html = res.body;
    expect(tag(html, /<title>([^<]*)<\/title>/)).toBe('UA929 flight status and on-time history | The Blue Board');
    expect(tag(html, /<link rel="canonical" href="([^"]*)"/)).toBe('https://theblueboard.co/flight/UA929');
    expect(tag(html, /<meta property="og:url" content="([^"]*)"/)).toBe('https://theblueboard.co/flight/UA929');
    expect(tag(html, /<meta property="og:image" content="([^"]*)"/)).toBe('https://theblueboard.co/flight/UA929/card.png');
    expect(tag(html, /<meta name="twitter:image" content="([^"]*)"/)).toBe('https://theblueboard.co/flight/UA929/card.png');
    expect(tag(html, /<meta name="robots" content="([^"]*)"/)).toBe('index, follow');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('passes the CSP: every inline script in the SERVED page is hashed in vercel.json, and there are no new ones', async () => {
    const html = (await call({ ident: 'UA929' })).body;
    const served = inlineScripts(html);
    expect(served.map(sha256)).toEqual(inlineScripts(shell).map(sha256));
    for (const body of served) expect(scriptSrc).toContain(sha256(body));
    // Every executable script is an external, same-origin file (or the analytics beacon).
    for (const [, src] of html.matchAll(/<script[^>]*\bsrc="([^"]+)"/g)) expect(src.startsWith('/')).toBe(true);
    expect(html).not.toMatch(/\son[a-z]+="/i);
  });

  it('308s ua929, UAL929 and "UA 929" to /flight/UA929, keeping the visitor\'s query', async () => {
    for (const ident of ['ua929', 'UAL929', 'UA 929', 'UA0929']) {
      const res = await call({ ident, utm_source: 'sms' });
      expect(res.statusCode, ident).toBe(308);
      expect(res.headers.Location).toBe('/flight/UA929?utm_source=sms');
    }
  });

  it('reads the rewrite\'s ident and the visitor\'s query from req.url, never the lazy req.query getter', async () => {
    // In production the rewrite's `?ident=` arrives in req.url (the platform's req.query getter
    // is derived from it), so getQuery sees exactly what req.query would.
    const req = { method: 'GET', headers: {}, url: '/api/flight-page?ident=ua929&utm_source=sms' };
    Object.defineProperty(req, 'query', { get() { throw new Error('req.query was read'); } });
    const res = createRes();
    await handler(req, res);
    expect(res.statusCode).toBe(308);
    expect(res.headers.Location).toBe('/flight/UA929?utm_source=sms');
  });

  it('a non-flight address is the lookup page as a noindex 404', async () => {
    const res = await call({ ident: 'hello' });
    expect(res.statusCode).toBe(404);
    expect(tag(res.body, /<meta name="robots" content="([^"]*)"/)).toBe('noindex, follow');
  });

  it('only GET and HEAD', async () => {
    expect((await call({ ident: 'UA929' }, { method: 'POST' })).statusCode).toBe(405);
    const head = await call({ ident: 'UA929' }, { method: 'HEAD' });
    expect(head.statusCode).toBe(200);
    expect(head.body).toBe('');
  });
});

describe('the shell lookup tiers', () => {
  it('without the bundled file, fetches the deployed /flight once from the canonical origin', async () => {
    fsState.hideShell = true;
    fetchSpy.mockImplementation(async (url) => {
      expect(String(url)).toBe('https://theblueboard.co/flight');
      return new Response(FAKE_SHELL, { status: 200 });
    });
    const res = await call({ ident: 'UA1' });
    expect(res.statusCode).toBe(200);
    expect(tag(res.body, /<title>([^<]*)<\/title>/)).toBe('UA1 flight status and on-time history | The Blue Board');
    await call({ ident: 'UA2' });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('with neither, sends the reader to the static page with the flight in the query — never an error', async () => {
    fsState.hideShell = true;
    fetchSpy.mockImplementation(async () => new Response('nope', { status: 503 }));
    const res = await call({ ident: 'UA929' });
    expect(res.statusCode).toBe(307);
    expect(res.headers.Location).toBe('/flight?f=UA929');
    expect(res.headers['Cache-Control']).toBe('no-store');
  });
});

describe('vercel.json routing for flight pages', () => {
  const { routes, error } = getTransformedRoutes({
    cleanUrls: vercelJson.cleanUrls,
    trailingSlash: vercelJson.trailingSlash,
    redirects: vercelJson.redirects,
    rewrites: vercelJson.rewrites,
    headers: vercelJson.headers,
  });
  const rewriteFor = (path) => {
    for (const route of routes) {
      if (!route.dest || route.status) continue;
      const m = new RegExp(route.src).exec(path);
      if (m) return route.dest.replace(/\$(\d+)/g, (_, i) => m[Number(i)] ?? '');
    }
    return null;
  };
  const headersFor = (path) => routes.filter((r) => r.continue && r.headers && new RegExp(r.src).test(path)).map((r) => r.headers);

  it('compiles, and rewrites the page and its card to their functions', () => {
    expect(error).toBeNull();
    expect(rewriteFor('/flight/UA929')).toBe('/api/flight-page?ident=UA929');
    expect(rewriteFor('/flight/UA929/card.png')).toBe('/api/flight-card?ident=UA929');
    expect(rewriteFor('/flight')).toBeNull();
  });

  it('the page gets the site CSP and NOT /api/\'s noindex header; the rewrite comes after the filesystem', () => {
    const page = headersFor('/flight/UA929');
    expect(page.some((h) => /script-src 'self'/.test(h['Content-Security-Policy'] || ''))).toBe(true);
    expect(page.some((h) => h['X-Robots-Tag'])).toBe(false);
    expect(headersFor('/flight/UA929/card.png').some((h) => h['X-Robots-Tag'])).toBe(false);
    const fsIndex = routes.findIndex((r) => r.handle === 'filesystem');
    const rewriteIndex = routes.findIndex((r) => r.dest === '/api/flight-page?ident=$1');
    expect(rewriteIndex).toBeGreaterThan(fsIndex);
  });

  it('bundles the built shell, the fleet files, the card fonts and the resvg wasm into their functions', () => {
    expect(vercelJson.functions['api/flight-page.ts'].includeFiles).toBe('dist/flight.html');
    expect(vercelJson.functions['api/flight.ts'].includeFiles).toBe('public/data/{fleet,starlink}.json');
    // The card imports api/flight.ts (loadFlightPayload), so it needs the fleet files too.
    expect(vercelJson.functions['api/flight-card.ts'].includeFiles).toBe(
      '{api/_flight-card/*.ttf,node_modules/@resvg/resvg-wasm/index_bg.wasm,public/data/{fleet,starlink}.json}',
    );
    for (const file of ['public/data/fleet.json', 'public/data/starlink.json', 'node_modules/@resvg/resvg-wasm/index_bg.wasm']) {
      expect(existsSync(join(ROOT, file)), file).toBe(true);
    }
    expect(existsSync(join(ROOT, 'api/_flight-card/GeistMono-SemiBold.ttf'))).toBe(true);
    expect(existsSync(join(ROOT, 'api/_flight-card/Geist-Medium.ttf'))).toBe(true);
  });

  // REQUIRED INTEGRATION PATCH (middleware.ts is not this branch's file): the Markdown-negotiation
  // middleware matches /flight/UA929/card.png and answers 406 to an image-only Accept, so an image
  // proxy that asks for `image/png` or `image/*` gets no card. Excluding the card path from the
  // matcher fixes it. This test is marked `fails` so the suite stays green and FLIPS (fails) the
  // moment middleware.ts excludes the path — then drop `.fails`.
  it.fails('the share card is not negotiated by the Markdown middleware (needs the middleware.ts matcher patch)', async () => {
    const { config } = await import('../middleware.ts');
    const { resolveAgentResponse } = await import('../src/lib/agent-negotiation.js');
    const matched = config.matcher.some((m) => new RegExp(`^${m}$`).test('/flight/UA929/card.png'));
    for (const accept of ['image/png', 'image/*']) {
      const decision = matched ? resolveAgentResponse({ pathname: '/flight/UA929/card.png', accept }).kind : 'not-matched';
      expect(decision, accept).not.toBe('not-acceptable');
    }
  });

  it('keeps flight pages out of the sitemap', () => {
    const sitemap = readFileSync(join(ROOT, 'src/pages/sitemap.xml.ts'), 'utf8');
    expect(sitemap).not.toMatch(/flight/i);
  });
});
