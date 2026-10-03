import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

// Google Search Console (Oct 3 2026): "Datasets structured data issues — Missing field
// 'description'" (critical: keeps a page out of Dataset results). The culprit was the
// per-airport tracker pages, whose Article carried `isPartOf: { '@type': 'Dataset', name, url }`
// — Google validates EVERY typed Dataset node, nested ones included. They now reference the
// parent tracker's Dataset by `@id`.
//
// Gate over the BUILT pages (dist/**/*.html), same contract as tests/seo-lengths.test.js:
// hard-fails in CI without dist/, skips locally.

const DIST = resolve(__dirname, '..', 'dist');
const hasDist = existsSync(join(DIST, 'index.html'));

if (!hasDist && process.env.CI) {
  throw new Error('dist/ is missing in CI — run `bun run build` before `bun run test` (see test.yml)');
}
if (!hasDist) console.warn('[structured-data-datasets] dist/ not built — skipping. Run `bun run build` first.');

function htmlFiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...htmlFiles(path));
    else if (entry.name.endsWith('.html')) found.push(path);
  }
  return found.sort();
}

function jsonLdBlocks(html) {
  return [...html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].map((m) =>
    JSON.parse(m[1]),
  );
}

/** Every node whose @type is (or includes) Dataset, anywhere in the graph. */
function datasetNodes(value, path = '$', out = []) {
  if (Array.isArray(value)) value.forEach((v, i) => datasetNodes(v, `${path}[${i}]`, out));
  else if (value && typeof value === 'object') {
    const types = [].concat(value['@type'] ?? []);
    if (types.includes('Dataset')) out.push({ path, node: value });
    for (const [k, v] of Object.entries(value)) datasetNodes(v, `${path}.${k}`, out);
  }
  return out;
}

describe.skipIf(!hasDist)('Dataset structured data in built pages', () => {
  const pages = hasDist
    ? htmlFiles(DIST).map((file) => ({ rel: relative(DIST, file), blocks: jsonLdBlocks(readFileSync(file, 'utf8')) }))
    : [];
  const datasets = pages.flatMap(({ rel, blocks }) => datasetNodes(blocks).map((d) => ({ rel, ...d })));

  it('finds the Dataset blocks at all (guards against a vacuous pass)', () => {
    expect(datasets.length).toBeGreaterThanOrEqual(5);
  });

  it('every Dataset node has the fields Google requires: name and description', () => {
    const broken = datasets
      .filter(({ node }) => !String(node.name ?? '').trim() || !String(node.description ?? '').trim())
      .map(({ rel, path, node }) => `${rel} ${path} (${node.name ?? 'no name'})`);
    expect(broken).toEqual([]);
  });

  it('per-airport tracker pages point at their parent Dataset by @id', () => {
    const trackerPages = pages.filter(({ rel }) => /^trackers\/(atc|united-hubs)\/[a-z]{3}\.html$/.test(rel));
    expect(trackerPages.length).toBeGreaterThan(0);
    for (const { rel, blocks } of trackerPages) {
      const parent = rel.startsWith('trackers/atc/') ? 'atc' : 'united-hubs';
      const article = blocks.find((b) => b['@type'] === 'Article');
      expect(article?.isPartOf, rel).toEqual({ '@id': `https://theblueboard.co/trackers/${parent}#dataset` });
    }
    const parentIds = pages
      .filter(({ rel }) => rel === 'trackers/atc.html' || rel === 'trackers/united-hubs.html')
      .flatMap(({ blocks }) => blocks.filter((b) => b['@type'] === 'Dataset').map((b) => b['@id']));
    expect(parentIds.sort()).toEqual([
      'https://theblueboard.co/trackers/atc#dataset',
      'https://theblueboard.co/trackers/united-hubs#dataset',
    ]);
  });
});
