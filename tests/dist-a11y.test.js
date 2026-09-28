import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import axe from 'axe-core';

// Accessibility gate over the BUILT static pages (dist/**/*.html), so every page type — home,
// 404, hubs, fleet, news, trackers, newark, privacy — is checked in CI, not only by the manual
// `bun run ui-audit`. Runs axe-core inside jsdom against the exact HTML Vercel serves.
//
// jsdom has no layout, so `color-contrast` is disabled here (contrast needs computed colours
// over rendered boxes); that one stays with scripts/ui-audit.mjs in a real browser. Everything
// structural — names, labels, landmarks, headings, lists, ARIA validity, duplicate ids — is
// checked on every page.
//
// dist/ only exists after `bun run build`. CI runs build BEFORE test (.github/workflows/test.yml)
// and this file hard-fails there if dist/ is missing; locally it skips with a message.

const DIST = resolve(__dirname, '..', 'dist');
const hasDist = existsSync(join(DIST, 'index.html'));

if (!hasDist && process.env.CI) {
  throw new Error('dist/ is missing in CI — run `bun run build` before `bun run test` (see test.yml)');
}
if (!hasDist) console.warn('[dist-a11y] dist/ not built — skipping. Run `bun run build` first.');

function htmlFiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...htmlFiles(path));
    else if (entry.name.endsWith('.html')) found.push(path);
  }
  return found.sort();
}

async function axeViolations(html) {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://theblueboard.co/' });
  try {
    dom.window.eval(axe.source);
    const result = await dom.window.axe.run(dom.window.document, {
      rules: { 'color-contrast': { enabled: false } },
      resultTypes: ['violations'],
    });
    return result.violations.map((v) => `${v.id} [${v.impact}] ×${v.nodes.length}: ${v.nodes[0]?.target?.join(' ')}`);
  } finally {
    dom.window.close();
  }
}

describe.skipIf(!hasDist)('built pages pass axe (structural rules)', () => {
  const pages = hasDist ? htmlFiles(DIST) : [];

  it('finds every page type in dist/', () => {
    const rel = pages.map((p) => relative(DIST, p));
    for (const expected of ['index.html', '404.html', 'hubs.html', 'fleet.html', 'news.html', 'privacy.html', 'newark.html', 'trackers.html']) {
      expect(rel).toContain(expected);
    }
    expect(rel.some((p) => p.startsWith('hubs/'))).toBe(true);
    expect(rel.some((p) => p.startsWith('fleet/'))).toBe(true);
    expect(rel.some((p) => p.startsWith('news/'))).toBe(true);
    expect(rel.some((p) => p.startsWith('trackers/atc/'))).toBe(true);
  });

  it('the harness really runs axe (a known violation is reported)', async () => {
    const violations = await axeViolations('<!doctype html><html lang="en"><head><title>t</title></head><body><main><img src="x.png"></main></body></html>');
    expect(violations.some((v) => v.startsWith('image-alt'))).toBe(true);
  });

  for (const page of pages) {
    const rel = relative(DIST, page);
    it(`${rel} has no axe violations`, async () => {
      expect(await axeViolations(readFileSync(page, 'utf8'))).toEqual([]);
    }, 30_000); // axe over the largest built pages (e.g. the 89-tower ATC table) can pass 5 s under CI load
  }
});

describe.skipIf(!hasDist)('share cards', () => {
  const TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };

  function mismatches() {
    const out = [];
    for (const page of htmlFiles(DIST)) {
      const html = readFileSync(page, 'utf8');
      const image = html.match(/<meta property="og:image" content="([^"]+)"/)?.[1];
      const type = html.match(/<meta property="og:image:type" content="([^"]+)"/)?.[1];
      if (!image || !type) continue;
      const ext = image.split('.').pop().toLowerCase();
      if (TYPES[ext] && TYPES[ext] !== type) out.push(`${relative(DIST, page)}: ${image} declared ${type}`);
    }
    return out;
  }

  // Seo.astro used to hard-code image/png while every hub/fleet/news/tracker page's og:image
  // is a .jpg (F40); it now derives the type from the file (src/lib/og-image-type.js).
  it('og:image:type matches the og:image file type on every page', () => {
    expect(mismatches()).toEqual([]);
  });
});
