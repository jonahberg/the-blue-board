import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getTransformedRoutes } from '@vercel/routing-utils';
import { hubs } from '../src/data/hubs/index.js';

// Every other test reads vercel.json as plain JSON, so an invalid path-to-regexp `source`
// passes `bun run test` and only fails the Vercel production build — which fails no GitHub
// check (the 2026-07-09 silent-deploy incident). This file runs the same compiler Vercel's
// build uses and then exercises the compiled redirects the way the edge router does:
// in order, case-sensitively (live: /tsa → 308, /TSA → 404), honouring `has` host guards.

const vercelJson = JSON.parse(readFileSync(resolve(__dirname, '..', 'vercel.json'), 'utf8'));
const { routes, error } = getTransformedRoutes({
  cleanUrls: vercelJson.cleanUrls,
  trailingSlash: vercelJson.trailingSlash,
  redirects: vercelJson.redirects,
  rewrites: vercelJson.rewrites,
  headers: vercelJson.headers,
});

const redirectRoutes = (routes ?? []).filter((r) => r.status && r.headers?.Location);
const headerRoutes = (routes ?? []).filter((r) => r.continue);

/** First matching redirect for `path` on `host`, as { status, location } or null. */
function redirectFor(path, host = 'theblueboard.co') {
  for (const route of redirectRoutes) {
    const hostGuard = route.has?.find((h) => h.type === 'host');
    if (hostGuard && hostGuard.value !== host) continue;
    const match = new RegExp(route.src).exec(path);
    if (!match) continue;
    const location = route.headers.Location.replace(/\$(\d+)/g, (_, i) => match[Number(i)] ?? '');
    return { status: route.status, location };
  }
  return null;
}

describe('vercel.json compiles with @vercel/routing-utils', () => {
  it('has no compile error', () => {
    expect(error).toBeNull();
    expect(routes.length).toBeGreaterThan(0);
  });

  it('compiles every redirect and header rule into a route', () => {
    // cleanUrls adds its own two redirects ahead of ours.
    expect(redirectRoutes.length).toBe(vercelJson.redirects.length + (vercelJson.cleanUrls ? 2 : 0));
    expect(headerRoutes.length).toBe(vercelJson.headers.length);
    for (const route of headerRoutes) expect(Object.keys(route.headers).length).toBeGreaterThan(0);
  });

  it('carries the CSP on the catch-all header route', () => {
    const global = headerRoutes.find((r) => new RegExp(r.src).test('/') && new RegExp(r.src).test('/hubs/ord'));
    expect(global?.headers['Content-Security-Policy']).toMatch(/script-src 'self'/);
  });

  it('rejects an invalid source (the class of error this file exists to catch)', () => {
    const bad = getTransformedRoutes({ redirects: [{ source: '/tsa/:path(*', destination: '/hubs' }] });
    expect(bad.error).not.toBeNull();
  });
});

describe('redirects', () => {
  it.each(['/tsa', '/tsa/', '/tsa/ord', '/tsa/hubs/den'])('%s → /hubs (308, TSA page removed)', (path) => {
    expect(redirectFor(path)).toEqual({ status: 308, location: '/hubs' });
  });

  it('does not redirect /hubs or a hub page (no loop)', () => {
    expect(redirectFor('/hubs')).toBeNull();
    expect(redirectFor('/hubs/ord')).toBeNull();
    expect(redirectFor('/tsafe')).toBeNull();
  });

  it.each([
    '/apple-touch-icon.png',
    '/apple-touch-icon-precomposed.png',
    '/apple-touch-icon-180x180.png',
    '/apple-touch-icon-152x152-precomposed.png',
  ])('%s → /icons/icon-192.png (307)', (path) => {
    expect(redirectFor(path)).toEqual({ status: 307, location: '/icons/icon-192.png' });
  });

  it('/favicon.ico → /favicon.svg (308)', () => {
    expect(redirectFor('/favicon.ico')).toEqual({ status: 308, location: '/favicon.svg' });
  });

  it('www → apex only when the host is www', () => {
    expect(redirectFor('/', 'www.theblueboard.co')).toEqual({ status: 308, location: 'https://theblueboard.co/' });
    expect(redirectFor('/hubs/ord', 'www.theblueboard.co')).toEqual({
      status: 308,
      location: 'https://theblueboard.co/hubs/ord',
    });
    expect(redirectFor('/')).toBeNull();
  });

  it.each(Object.keys(hubs))('uppercase hub %s redirects to the lowercase page', (hub) => {
    // Routing is case-sensitive and hub pages are lowercase, so /hubs/ORD (typed or linked
    // from an IATA code) was a 404.
    expect(redirectFor(`/hubs/${hub.toUpperCase()}`)).toEqual({ status: 308, location: `/hubs/${hub}` });
  });

  it('/sitemap-index.xml → /sitemap.xml (the default @astrojs/sitemap name crawlers probe)', () => {
    expect(redirectFor('/sitemap-index.xml')).toEqual({ status: 308, location: '/sitemap.xml' });
  });

  it('no redirect lands on another redirect (no chains or loops)', () => {
    for (const { source } of vercelJson.redirects) {
      if (source.includes(':') || source.includes('(')) continue; // parameterised — covered above
      const first = redirectFor(source);
      if (!first || /^https?:/.test(first.location)) continue;
      expect(redirectFor(first.location), `${source} → ${first.location}`).toBeNull();
    }
  });
});
