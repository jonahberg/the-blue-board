import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { DESCRIPTION_MAX, SHARE_TITLE_MAX, TITLE_MAX } from '../src/lib/page-seo.js';

// SERP-length gate over the BUILT pages (dist/**/*.html): every <title> ≤ 65 characters,
// every meta description ≤ 160, og:title / twitter:title ≤ 70. Titles used to run to 127
// characters and descriptions to 338, all truncated in search results. Measured on the
// decoded text a searcher sees, so "&amp;" counts as one character.
//
// dist/ only exists after `bun run build`. CI runs build BEFORE test (.github/workflows/test.yml)
// and this file hard-fails there if dist/ is missing; locally it skips with a message
// (same contract as tests/dist-a11y.test.js).

const DIST = resolve(__dirname, '..', 'dist');
const hasDist = existsSync(join(DIST, 'index.html'));

if (!hasDist && process.env.CI) {
  throw new Error('dist/ is missing in CI — run `bun run build` before `bun run test` (see test.yml)');
}
if (!hasDist) console.warn('[seo-lengths] dist/ not built — skipping. Run `bun run build` first.');

function htmlFiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...htmlFiles(path));
    else if (entry.name.endsWith('.html')) found.push(path);
  }
  return found.sort();
}

function decode(text) {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function head(html) {
  const pick = (re) => {
    const m = html.match(re);
    return m ? decode(m[1]) : null;
  };
  return {
    title: pick(/<title>([^<]*)<\/title>/),
    description: pick(/<meta name="description" content="([^"]*)"/),
    ogTitle: pick(/<meta property="og:title" content="([^"]*)"/),
    twitterTitle: pick(/<meta name="twitter:title" content="([^"]*)"/),
  };
}

describe.skipIf(!hasDist)('built pages keep SERP-sized titles and descriptions', () => {
  const pages = hasDist
    ? htmlFiles(DIST).map((path) => ({ rel: relative(DIST, path), ...head(readFileSync(path, 'utf8')) }))
    : [];

  it('covers the content pages', () => {
    expect(pages.length).toBeGreaterThan(60);
  });

  it(`every <title> is present and ≤ ${TITLE_MAX} characters`, () => {
    const bad = pages
      .filter((p) => !p.title || p.title.length > TITLE_MAX)
      .map((p) => `${p.rel} (${p.title?.length ?? 'missing'}): ${p.title}`);
    expect(bad).toEqual([]);
  });

  it(`every meta description is present and ≤ ${DESCRIPTION_MAX} characters`, () => {
    const bad = pages
      .filter((p) => !p.description || p.description.length > DESCRIPTION_MAX)
      .map((p) => `${p.rel} (${p.description?.length ?? 'missing'}): ${p.description}`);
    expect(bad).toEqual([]);
  });

  it(`og:title and twitter:title stay ≤ ${SHARE_TITLE_MAX} characters`, () => {
    const bad = pages
      .flatMap((p) => [
        ['og:title', p.ogTitle],
        ['twitter:title', p.twitterTitle],
      ].filter(([, v]) => v && v.length > SHARE_TITLE_MAX).map(([k, v]) => `${p.rel} ${k} (${v.length}): ${v}`));
    expect(bad).toEqual([]);
  });

  it('no {count} token leaks into a built page', () => {
    const leaked = htmlFiles(DIST).filter((path) => readFileSync(path, 'utf8').includes('{count}'));
    expect(leaked.map((p) => relative(DIST, p))).toEqual([]);
  });
});
