import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

// scripts/ui-audit.mjs is the only real-browser check (contrast, layout, dashboard tabs). It is
// manual, so it silently fell behind the site: no /fleet, /news, /newark or /privacy after the
// v1.8.0 rebuild. Pin that it names one page of every top-level route in src/pages, a tablet
// viewport, and every dashboard tab.

const src = readFileSync(resolve(__dirname, '..', 'scripts', 'ui-audit.mjs'), 'utf8');
const paths = [...src.matchAll(/path:\s*'([^']+)'/g)].map((m) => m[1]);

describe('ui-audit coverage', () => {
  it('audits a page for every top-level route in src/pages', () => {
    const pagesDir = resolve(__dirname, '..', 'src', 'pages');
    const routes = readdirSync(pagesDir, { withFileTypes: true })
      .map((e) => e.name.replace(/\.astro$/, ''))
      .filter((n) => !/\.(ts|js)$/.test(n) && !['data', 'index', '404'].includes(n));
    for (const route of routes) {
      expect(paths.some((p) => p === `/${route}` || p.startsWith(`/${route}/`)), route).toBe(true);
    }
  });

  it('audits a detail page under each dynamic section', () => {
    for (const section of ['/hubs/', '/fleet/', '/news/', '/trackers/atc/']) {
      expect(paths.some((p) => p.startsWith(section) && p.length > section.length), section).toBe(true);
    }
  });

  it('covers phone and tablet widths', () => {
    expect(src).toMatch(/width:\s*390/);
    expect(src).toMatch(/width:\s*768/);
  });

  it('drives every dashboard tab', () => {
    const tabsSrc = readFileSync(resolve(__dirname, '..', 'src', 'app', 'tabs.ts'), 'utf8');
    const labels = [...tabsSrc.matchAll(/label:\s*'([^']+)'/g)].map((m) => m[1]);
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) expect(src, label).toContain(`'${label}'`);
  });
});
