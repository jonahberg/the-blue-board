// The flight page, /flight/:ident (vercel.json rewrites it here as /api/flight-page?ident=…).
//
// The page itself is the static shell Astro builds (src/pages/flight/index.astro → dist/flight.html)
// through BaseLayout: the site's normal head, header, footer and bundled script, no inline script.
// This function serves THOSE bytes with the per-flight <title>, description, canonical and Open
// Graph / Twitter tags substituted in (src/lib/flight-page-seo.js), so a link texted to someone
// previews as that flight, with its own card image (/flight/:ident/card.png → api/flight-card.ts).
//
// It reads no database and calls no provider: the head is built from the ident alone, and the live
// content is filled in the browser from /api/flight. So a page always renders, and the CDN can keep
// it for an hour.
//
// The shell is found in three tiers:
//   1. dist/flight.html from this function's own bundle (vercel.json `includeFiles`; the static
//      build runs before the functions are built, so the file exists when they are bundled);
//   2. the deployed /flight page, fetched once per instance from the canonical origin only (never a
//      host taken from the request);
//   3. failing both, a 307 to /flight?f=UA929 — the static shell, which reads the flight from the
//      query: the page still works, with the generic preview.
//
// CSP: the substitutions change attribute values and two text nodes, never markup, and add no
// <script>; the served page carries exactly the shell's inline scripts (none) and is covered by the
// same header. tests/flight-page-shell.test.js runs this handler on the built shell and checks it
// against vercel.json with the build's own hash check.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { VercelRequest, VercelResponse } from './_types.js';
import { createRateLimiter } from './_rate-limit.js';
import { flightPagePath, parseFlightIdent } from '../src/lib/flight-page.js';
import { renderFlightShell, renderMissingFlightShell } from '../src/lib/flight-page-seo.js';
import { SITE_URL } from '../src/lib/site.js';

const isRateLimited = createRateLimiter('flight-page', 60);

export const PAGE_CACHE_CONTROL = 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400';
export const MISSING_CACHE_CONTROL = 'public, max-age=0, s-maxage=600';
/** The tier-2 fetch gives up after this long. */
export const SHELL_FETCH_TIMEOUT_MS = 3000;

let shellCache: string | null = null;
let shellFetchFailedAt = 0;

/** Test seams. */
export function __resetFlightPageForTests(): void {
  shellCache = null;
  shellFetchFailedAt = 0;
}

function readShellFromBundle(): string | null {
  const candidates = [
    new URL('../dist/flight.html', import.meta.url),
    join(process.cwd(), 'dist', 'flight.html'),
  ];
  for (const path of candidates) {
    try {
      const html = readFileSync(path, 'utf8');
      if (html.includes('data-flight-page')) return html;
    } catch {
      /* try the next one */
    }
  }
  return null;
}

async function fetchShell(): Promise<string | null> {
  // One attempt per instance per minute: a broken origin must not turn every page into a fetch.
  if (Date.now() - shellFetchFailedAt < 60_000) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SHELL_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${SITE_URL}/flight`, { signal: controller.signal, headers: { Accept: 'text/html' } });
    const html = res.ok ? await res.text() : '';
    if (html.includes('data-flight-page')) return html;
  } catch {
    /* fall through */
  } finally {
    clearTimeout(timer);
  }
  shellFetchFailedAt = Date.now();
  return null;
}

/** The shell, from the cheapest tier that has it. */
export async function loadShell(): Promise<string | null> {
  if (shellCache) return shellCache;
  const html = readShellFromBundle() || (await fetchShell());
  if (html) shellCache = html;
  return html;
}

/** The query string the visitor came with, minus the rewrite's own `ident` (kept on a redirect). */
function carriedQuery(req: VercelRequest): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(req.query || {})) {
    if (key === 'ident') continue;
    for (const v of Array.isArray(value) ? value : [value]) if (typeof v === 'string') params.append(key, v);
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).send('Method not allowed');
  }
  if (isRateLimited(req)) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(429).send('Too many requests. Try again in a minute.');
  }

  const raw = req.query?.ident as unknown;
  const parsed = parseFlightIdent(raw);

  // ua929, UAL929, "UA 929" → one canonical address.
  if (parsed && !parsed.canonical) {
    res.setHeader('Cache-Control', PAGE_CACHE_CONTROL);
    res.setHeader('Location', `${flightPagePath(parsed.ident)}${carriedQuery(req)}`);
    return res.status(308).end();
  }

  const shell = await loadShell();
  if (!shell) {
    // Tier 3: the static page, told the flight by query. Short-lived, so a recovered shell wins.
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Location', parsed ? `/flight?f=${parsed.ident}` : '/flight');
    return res.status(307).end();
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (!parsed) {
    // Not a flight number: the lookup page, honestly a 404, kept out of search.
    res.setHeader('Cache-Control', MISSING_CACHE_CONTROL);
    return res.status(404).send(renderMissingFlightShell(shell));
  }

  const rendered = renderFlightShell(shell, parsed.ident);
  if (!rendered.ok) {
    // The shell stopped matching (an Astro upgrade reordered the head): say so in the logs and
    // serve the page with its generic head rather than a half-substituted one.
    console.error(`flight-page: shell substitution failed (${rendered.missing.join(', ')})`);
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300');
    return res.status(200).send(shell);
  }
  res.setHeader('Cache-Control', PAGE_CACHE_CONTROL);
  return res.status(200).send(req.method === 'HEAD' ? '' : rendered.html);
}
