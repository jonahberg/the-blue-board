import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { agentMarkdown } from '../src/lib/agent-markdown.js';

// The author credit — "Built by Jonah Berg" — links https://jonahberg.com on every surface,
// and every schema.org Person for the author carries that url with GitHub in `sameAs`.
//
// This has regressed once already. v1.7.18 (#244) pointed the credit at jonahberg.com in the
// four footers of the time; the v1.8.0 shadcn rebuild (#254) then moved the dashboard's only
// in-DOM credit into a Radix popover (mounted only while open) and ported the homepage's
// noscript byline and JSON-LD with the GitHub profile URL. Nothing failed. These pins make
// the next rebuild fail instead.
//
// The component-level pins live next to the components: `tests/attribution-landmark.test.tsx`
// (the dashboard strip) and `tests/mobile-nav-more.test.tsx` (the phone sheet). The homepage
// module pins are in `tests/home-seo.test.js`. This file covers the static sources and the
// BUILT output.
//
// The dist/ half follows the same contract as tests/seo-lengths.test.js: CI runs build BEFORE
// test (.github/workflows/test.yml) and this file hard-fails there if dist/ is missing;
// locally it skips with a message.

const AUTHOR_URL = 'https://jonahberg.com';
const GITHUB_PROFILE = 'https://github.com/jonahberg';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

describe('author credit in the static sources', () => {
  it('the site footer credits Jonah Berg with a link to jonahberg.com', () => {
    const footer = read('src/components/site/SiteFooter.astro');
    expect(footer).toMatch(/Built by <a\s+href="https:\/\/jonahberg\.com"[^>]*>Jonah Berg<\/a/);
    expect(footer).not.toContain(`href="${GITHUB_PROFILE}"`);
  });

  it('the NewsArticle author is a Person with the jonahberg.com url and GitHub in sameAs', () => {
    const layout = read('src/layouts/NewsLayout.astro');
    const author = layout.match(/author: \{[^}]*\}/)?.[0] ?? '';
    expect(author).toContain("'@type': 'Person'");
    expect(author).toContain(`url: '${AUTHOR_URL}'`);
    expect(author).toMatch(new RegExp(`sameAs: \\[[^\\]]*'${GITHUB_PROFILE}'`));
  });

  it('llms.txt, llms-full.txt and the homepage Markdown twin name jonahberg.com', () => {
    const creator = (source) => source.slice(source.indexOf('## Creator')).split('\n## ')[0];
    for (const [name, source] of [
      ['llms.txt', read('public/llms.txt')],
      ['llms-full.txt', read('public/llms-full.txt')],
    ]) {
      expect(source, name).toContain('## Creator');
      expect(creator(source), name).toContain('Jonah Berg');
      expect(creator(source), name).toContain(AUTHOR_URL);
    }
    expect(agentMarkdown['/']).toContain(`Built by Jonah Berg — ${AUTHOR_URL}`);
  });
});

const DIST = resolve(__dirname, '..', 'dist');
const hasDist = existsSync(join(DIST, 'index.html'));

if (!hasDist && process.env.CI) {
  throw new Error('dist/ is missing in CI — run `bun run build` before `bun run test` (see test.yml)');
}
if (!hasDist) console.warn('[author-credit] dist/ not built — skipping. Run `bun run build` first.');

function filesUnder(dir, suffix) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...filesUnder(path, suffix));
    else if (entry.name.endsWith(suffix)) found.push(path);
  }
  return found.sort();
}

/** Every JSON-LD node on a page, flattened (nested objects included). */
function jsonLdNodes(html) {
  const nodes = [];
  const walk = (value) => {
    if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === 'object') {
      nodes.push(value);
      Object.values(value).forEach(walk);
    }
  };
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    walk(JSON.parse(m[1]));
  }
  return nodes;
}

const CREDIT_LINK = /<a\b[^>]*\bhref="https:\/\/jonahberg\.com"[^>]*>\s*Jonah Berg\s*<\/a>/;

describe.skipIf(!hasDist)('author credit in the built site', () => {
  const pages = hasDist
    ? filesUnder(DIST, '.html').map((path) => ({ rel: relative(DIST, path), html: readFileSync(path, 'utf8') }))
    : [];
  const home = pages.find((page) => page.rel === 'index.html');

  it('the homepage shell links the byline to jonahberg.com (crawlers see no island markup)', () => {
    expect(home, 'dist/index.html').toBeTruthy();
    const noscript = home.html.match(/<noscript>([\s\S]*?)<\/noscript>/)?.[1] ?? '';
    expect(noscript).toMatch(CREDIT_LINK);
  });

  it('the homepage JSON-LD has three author Person nodes, each on jonahberg.com', () => {
    const people = jsonLdNodes(home.html).filter((node) => node['@type'] === 'Person');
    expect(people).toHaveLength(3);
    for (const person of people) {
      expect(person.name).toBe('Jonah Berg');
      expect(person.url).toBe(AUTHOR_URL);
      expect(person.sameAs).toContain(GITHUB_PROFILE);
    }
  });

  it('every author Person on every built page uses the jonahberg.com url', () => {
    for (const page of pages) {
      for (const person of jsonLdNodes(page.html).filter((node) => node['@type'] === 'Person')) {
        expect(person.url, page.rel).toBe(AUTHOR_URL);
        expect(person.sameAs, page.rel).toContain(GITHUB_PROFILE);
      }
    }
  });

  it('every page with the site footer carries the credit link', () => {
    const footered = pages.filter((page) => page !== home);
    expect(footered.length).toBeGreaterThan(50);
    for (const page of footered) expect(page.html, page.rel).toMatch(CREDIT_LINK);
  });

  it('no built page links the GitHub profile as a credit (repo links are fine)', () => {
    for (const page of pages) {
      expect(page.html, page.rel).not.toContain(`href="${GITHUB_PROFILE}"`);
    }
  });

  // Coarse: the ⓘ menu's copy would satisfy this on its own. The always-mounted strip credit
  // is pinned at the component level in tests/attribution-landmark.test.tsx.
  it('the dashboard bundle ships a jonahberg.com credit', () => {
    const bundle = filesUnder(join(DIST, '_astro'), '.js')
      .map((path) => readFileSync(path, 'utf8'))
      .join('\n');
    expect(bundle).toContain(AUTHOR_URL);
  });
});
