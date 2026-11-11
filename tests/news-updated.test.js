/**
 * News articles carry an optional `updated` day (v1.28.0).
 *
 * Five older articles open with an "Update, November 11, 2026:" paragraph, but their JSON-LD
 * `dateModified` and their sitemap `<lastmod>` still said the day they were first published, so a
 * crawler had no reason to read them again. `updated` feeds both; the visible date stays the
 * publication date, with a quiet "Updated …" beside it. Nothing else moves: the order of the
 * articles, `news-latest.json`, the Google News sitemap's publication date and the RSS pubDate.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { articles, validateArticles } from '../src/data/news/index.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "Update, November 11, 2026:" at the very start of a body → '2026-11-11'; null when it has none. */
function openingUpdateDay(body) {
  const m = /^<p><strong>Update, ([A-Z][a-z]+) (\d{1,2}), (\d{4}):<\/strong>/.exec(body);
  if (!m) return null;
  const month = MONTHS.indexOf(m[1]) + 1;
  if (month === 0) throw new Error(`unknown month in an update note: ${m[1]}`);
  return `${m[3]}-${String(month).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}

const base = (over = {}) => ({
  slug: 'a-story',
  title: 'A story',
  date: '2026-07-15',
  category: 'Fleet',
  summary: 'One line.',
  body: '<p>Body.</p>',
  ...over,
});

describe('news `updated`', () => {
  it('an article whose body opens with an update note carries that day as `updated`, and only those do', () => {
    for (const a of articles) {
      expect(a.updated ?? null, a.slug).toBe(openingUpdateDay(a.body));
    }
  });

  it('is set on exactly the five articles updated on November 11, 2026', () => {
    expect(articles.filter((a) => a.updated).map((a) => [a.slug, a.updated])).toEqual([
      ['united-q2-2026-earnings-guidance-raise', '2026-11-11'],
      ['united-first-transatlantic-starlink-777', '2026-11-11'],
      ['united-first-a321xlr-757-replacement', '2026-11-11'],
      ['united-250-planes-coastliner-a321xlr-crj450', '2026-11-11'],
      ['kirby-playbook-for-175-oil-invest-more', '2026-11-11'],
    ]);
  });

  it('never moves an article: the list is still newest-published first', () => {
    const dates = articles.map((a) => a.date);
    expect([...dates].sort().reverse()).toEqual(dates);
  });

  it('the validator accepts a real day on or after `date`, and nothing else', () => {
    expect(() => validateArticles([base({ updated: '2026-11-11' })])).not.toThrow();
    expect(() => validateArticles([base({ updated: '2026-07-15' })])).not.toThrow();
    expect(() => validateArticles([base()])).not.toThrow();
    expect(() => validateArticles([base({ updated: '2026-07-14' })])).toThrow(/before its date/);
    expect(() => validateArticles([base({ updated: '2026-02-30' })])).toThrow(/updated/);
    expect(() => validateArticles([base({ updated: '2026-11-11T00:00:00Z' })])).toThrow(/updated/);
    expect(() => validateArticles([base({ updated: 20261111 })])).toThrow(/updated/);
  });
});

const DIST = resolve(__dirname, '..', 'dist');
const hasDist = existsSync(join(DIST, 'index.html'));
if (!hasDist && process.env.CI) {
  throw new Error('dist/ is missing in CI — run `bun run build` before `bun run test` (see test.yml)');
}
if (!hasDist) console.warn('[news-updated] dist/ not built — skipping. Run `bun run build` first.');

const read = (rel) => readFileSync(join(DIST, rel), 'utf8');
const newsArticleLd = (html) => {
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    const nodes = [JSON.parse(m[1])].flat();
    const found = nodes.find((n) => n['@type'] === 'NewsArticle');
    if (found) return found;
  }
  return null;
};

describe.skipIf(!hasDist)('news `updated` in the built site', () => {
  const updated = articles.find((a) => a.slug === 'united-q2-2026-earnings-guidance-raise');
  const plain = articles.find((a) => !a.updated);

  it('JSON-LD: dateModified is the update day; datePublished stays the publication day', () => {
    const ld = newsArticleLd(read(`news/${updated.slug}.html`));
    expect(ld.datePublished).toBe('2026-07-15');
    expect(ld.dateModified).toBe('2026-11-11');
    const ldPlain = newsArticleLd(read(`news/${plain.slug}.html`));
    expect(ldPlain.dateModified).toBe(plain.date);
  });

  it('the date line keeps the publication date and adds a quiet "Updated" only where there is one', () => {
    const html = read(`news/${updated.slug}.html`);
    const line = html.match(/<p class="font-mono[^"]*"[^>]*>([\s\S]*?)<\/p>/)?.[1] ?? '';
    expect(line).toMatch(/<time datetime="2026-07-15">Jul 15, 2026<\/time>/);
    expect(line).toMatch(/Updated <time datetime="2026-11-11">Nov 11, 2026<\/time>/);
    // Published first, then the update; the article:published_time meta is unchanged.
    expect(line.indexOf('2026-07-15')).toBeLessThan(line.indexOf('2026-11-11'));
    expect(html).toContain('<meta property="article:published_time" content="2026-07-15"');
    const plainLine = read(`news/${plain.slug}.html`).match(/<p class="font-mono[^"]*"[^>]*>([\s\S]*?)<\/p>/)?.[1] ?? '';
    expect(plainLine).not.toMatch(/Updated/);
  });

  it('sitemap.xml: <lastmod> is the update day for an updated article, the publication day otherwise', () => {
    const xml = read('sitemap.xml');
    const lastmod = (slug) => xml.match(new RegExp(`<loc>[^<]*/news/${slug}</loc>\\s*<lastmod>([^<]+)</lastmod>`))?.[1];
    for (const a of articles) expect(lastmod(a.slug), a.slug).toBe(a.updated ?? a.date);
  });

  it('news-latest.json is unchanged in shape: the three newest by publication, with their publication date', () => {
    const latest = JSON.parse(read('data/news-latest.json'));
    expect(latest).toEqual(
      articles.slice(0, 3).map((a) => ({ slug: a.slug, title: a.title, date: a.date, category: a.category })),
    );
  });
});
