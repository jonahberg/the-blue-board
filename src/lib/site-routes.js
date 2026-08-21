// ═══ CANONICAL ROUTE SURFACE ═══
// Used by the root middleware.ts to answer one narrow question: "is this path definitely
// not a page on this site?"
// Why: middleware runs BEFORE routing, so it cannot see whether the static host would have
// answered 200 or 404. To synthesise a Markdown 404 for agents we need a test that is
// wrong in only the safe direction — it may classify a dead path as "possibly real"
// (the agent then gets the normal HTML 404, still a real 404 status), but it must NEVER
// classify a live page as missing, which would 404 real content to every Markdown client.
// Hence prefixes, not an enumerated page list: every real page lives under one of these,
// and tests/agent-readiness.test.js pins that against the live sitemap so a new route
// section can't silently fall outside.

/** Exact top-level HTML routes (Astro pages + the dashboard shell at /). */
export const HTML_ROUTE_PATHS = ['/', '/404', '/newark', '/privacy', '/tsa'];

/** Route sections — both the index (/fleet) and everything under it (/fleet/737-800). */
export const HTML_ROUTE_PREFIXES = ['/fleet', '/hubs', '/news', '/trackers'];

/** Directories served verbatim out of dist/ (public/ assets + Astro's build output). */
export const ASSET_PREFIXES = [
  '/_astro/',
  '/_vercel/',
  '/api/',
  '/css/',
  '/data/',
  '/fonts/',
  '/icons/',
  '/js/',
  '/og/',
];

/** Individual non-HTML files at the site root. */
export const ASSET_PATHS = [
  '/favicon.ico',
  '/favicon.svg',
  '/feed.xml',
  '/llms-full.txt',
  '/llms.txt',
  '/manifest.json',
  '/news-sitemap.xml',
  '/og-image.png',
  '/robots.txt',
  '/sitemap.xml',
  '/sw.js',
];

/**
 * Normalise a request path for lookup: drop the trailing slash (`cleanUrls` is on, so
 * /fleet and /fleet/ are the same page) and default an empty path to the root.
 *
 * @param {string} pathname
 * @returns {string}
 */
export function normalizePathname(pathname) {
  if (typeof pathname !== 'string' || pathname === '') return '/';
  const trimmed = pathname.replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed;
}

/**
 * True when the path could plausibly be served by this site — a known page, a page under a
 * known section, or a static asset. False means "definitely a 404".
 *
 * @param {string} pathname
 * @returns {boolean}
 */
export function isKnownRoutePath(pathname) {
  const path = normalizePathname(pathname);
  if (HTML_ROUTE_PATHS.includes(path)) return true;
  if (ASSET_PATHS.includes(path)) return true;
  if (ASSET_PREFIXES.some((prefix) => path.startsWith(prefix))) return true;
  return HTML_ROUTE_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
}
