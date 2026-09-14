// ═══ SITE IDENTITY ═══
// The canonical origin, in one place.
//
// Four modules used to declare `https://theblueboard.co` for themselves: the SEO head
// (`Seo.astro`), the breadcrumb JSON-LD (`Breadcrumbs.astro`), the sitemap
// (`sitemap.xml.ts`) and the homepage structured data (`home-seo.js`). Every one of them
// emits absolute URLs that a crawler dedupes against the others — a canonical tag, an
// `@id`, a `<loc>` — so a copy that drifts does not fail a build or a test. It splits the
// site's identity in a search index, which is the failure this project has already paid
// for once (see project SEO notes, Aug 2026).
//
// No trailing slash: every caller composes `${SITE_URL}${path}` with a leading-slash path.

/** Canonical production origin. Scheme + host, never a trailing slash. */
export const SITE_URL = 'https://theblueboard.co';

/**
 * Absolutise a site path against {@link SITE_URL}. An already-absolute URL passes through
 * unchanged, so callers can accept either from page front-matter.
 *
 * @param {string} value  a site path (`/hubs/ord`, `hubs/ord`) or an absolute URL.
 * @returns {string}
 */
export function absoluteUrl(value) {
  if (/^https?:\/\//.test(value)) return value;
  return `${SITE_URL}${value.startsWith('/') ? '' : '/'}${value}`;
}
