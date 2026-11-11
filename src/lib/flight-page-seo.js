// ═══ FLIGHT PAGE — THE SHELL AND ITS HEAD ═══
// /flight/UA929 cannot be prerendered (there are thousands of flight numbers and the content is
// live), but a shared link must still preview as THAT flight. So Astro builds ONE shell page
// (src/pages/flight/index.astro → dist/flight.html) through BaseLayout — the normal head, header,
// footer and bundled scripts, no inline script — and api/flight-page.ts serves those exact bytes
// for /flight/:ident with the per-flight head substituted in here.
//
// Only attribute values and text are replaced, never markup: every value is HTML-escaped, the tags
// themselves are the ones Seo.astro wrote, and the shell gains no <script>. The CSP hashes Astro's
// inline scripts only, and this file adds none, so a served flight page is exactly as allowed as
// the built shell (tests/flight-page-shell.test.js checks the served bytes against vercel.json).
//
// No DOM, no I/O.

import { DESCRIPTION_MAX, SHARE_TITLE_MAX, TITLE_MAX } from './page-seo.js';
import { SITE_URL } from './site.js';

/**
 * Head copy for one flight page. Built from the ident alone, on purpose: the HTML function never
 * waits on a database, so a page always renders, and the live status reaches a link preview
 * through the card image (/flight/:ident/card.png), which is built from the data.
 *
 * @param {string} ident  canonical, e.g. "UA929".
 * @returns {{title: string, description: string, canonical: string, ogTitle: string,
 *   ogDescription: string, ogImage: string, ogImageAlt: string, twitterTitle: string,
 *   twitterDescription: string}}
 */
export function flightPageMeta(ident) {
  const title = `${ident} flight status and on-time history | The Blue Board`;
  const description =
    `Where United ${ident} is right now, in one plain sentence: departure and arrival times, delays, ` +
    'the aircraft, and how often it has run on time lately.';
  const ogTitle = `United ${ident}: live flight status`;
  const ogDescription = `Where ${ident} is now, its times and delays, and how often it has run on time lately.`;
  return {
    title: clamp(title, TITLE_MAX),
    description: clamp(description, DESCRIPTION_MAX),
    canonical: `${SITE_URL}/flight/${ident}`,
    ogTitle: clamp(ogTitle, SHARE_TITLE_MAX),
    ogDescription: clamp(ogDescription, DESCRIPTION_MAX),
    ogImage: `${SITE_URL}/flight/${ident}/card.png`,
    ogImageAlt: `${ident} flight status card from The Blue Board: route and current status`,
    twitterTitle: clamp(ogTitle, SHARE_TITLE_MAX),
    twitterDescription: clamp(ogDescription, DESCRIPTION_MAX),
  };
}

function clamp(text, max) {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/** Escape a value for an HTML attribute or text node. */
export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Every substitution the served page needs: [what it is, a pattern with three groups (before,
 * old value, after), the new value]. Each must match EXACTLY once in the shell; a shell that
 * stops matching (an Astro upgrade reorders attributes) is reported, not half-served.
 *
 * @param {ReturnType<typeof flightPageMeta>} meta
 * @param {string} ident
 */
function substitutions(meta, ident) {
  const metaTag = (attr, key) => new RegExp(`(<meta\\s+${attr}="${key.replace(/[:.]/g, '\\$&')}"\\s+content=")([^"]*)(")`);
  return [
    ['title', /(<title>)([^<]*)(<\/title>)/, meta.title],
    ['description', metaTag('name', 'description'), meta.description],
    ['og:title', metaTag('property', 'og:title'), meta.ogTitle],
    ['og:description', metaTag('property', 'og:description'), meta.ogDescription],
    ['og:url', metaTag('property', 'og:url'), meta.canonical],
    ['og:image', metaTag('property', 'og:image'), meta.ogImage],
    ['og:image:type', metaTag('property', 'og:image:type'), 'image/png'],
    ['og:image:alt', metaTag('property', 'og:image:alt'), meta.ogImageAlt],
    ['twitter:title', metaTag('name', 'twitter:title'), meta.twitterTitle],
    ['twitter:description', metaTag('name', 'twitter:description'), meta.twitterDescription],
    ['twitter:image', metaTag('name', 'twitter:image'), meta.ogImage],
    ['twitter:url', metaTag('name', 'twitter:url'), meta.canonical],
    ['canonical', /(<link\s+rel="canonical"\s+href=")([^"]*)(")/, meta.canonical],
    // The page root names its flight, so the script and a no-JS reader agree on it.
    ['data-flight-ident', /(data-flight-ident=")([^"]*)(")/, ident],
    // The heading a crawler or a reader without JavaScript sees.
    ['heading', /(<h1[^>]*data-fp-title[^>]*>)([^<]*)(<\/h1>)/, ident],
  ];
}

/**
 * The shell, as the page for one flight.
 *
 * @param {string} html  the built dist/flight.html.
 * @param {string} ident  canonical ident (already validated: /^UA\d{1,4}$/).
 * @returns {{ok: true, html: string} | {ok: false, missing: string[]}}
 */
export function renderFlightShell(html, ident) {
  const meta = flightPageMeta(ident);
  let out = String(html || '');
  const missing = [];
  for (const [name, pattern, value] of substitutions(meta, ident)) {
    const global = new RegExp(pattern.source, 'g');
    const count = (out.match(global) || []).length;
    if (count !== 1) {
      missing.push(`${name}×${count}`);
      continue;
    }
    // A function replacer: a `$` in a value must never be read as a group reference.
    out = out.replace(pattern, (_, before, _old, after) => `${before}${escapeHtml(value)}${after}`);
  }
  return missing.length ? { ok: false, missing } : { ok: true, html: out };
}

/**
 * The shell for an address that is not a flight number (/flight/hello): the lookup page, kept out
 * of search. Only the robots value changes; the page script reads the path and says what is wrong.
 *
 * @param {string} html
 * @returns {string}
 */
export function renderMissingFlightShell(html) {
  return String(html || '').replace(
    /(<meta\s+name="robots"\s+content=")([^"]*)(")/,
    (_, before, _old, after) => `${before}noindex, follow${after}`,
  );
}
