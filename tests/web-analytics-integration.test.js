import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(process.cwd());

function readProjectFile(path) {
  return readFileSync(resolve(ROOT, path), 'utf8');
}

/** True when `source` imports the component whose path ends with `suffix`. */
function importsComponent(source, suffix) {
  return source.includes(`${suffix}'`) || source.includes(`${suffix}"`);
}

const ANALYTICS = '/VercelAnalytics.astro';
const BASE_LAYOUT = '/site/BaseLayout.astro';
const RELATIVE_ASTRO_IMPORT = /from\s+['"](\.[^'"]+\.astro)['"]/g;

/**
 * A document is instrumented when it mounts the analytics wrapper itself, uses
 * BaseLayout (which mounts it), or imports another `.astro` file that does —
 * that last case is how the `[hub]`, `[type]`, `[slug]` and `[code]` pages
 * inherit it from their layouts.
 */
function isInstrumented(absolutePath, seen = new Set()) {
  if (seen.has(absolutePath) || !existsSync(absolutePath)) return false;
  seen.add(absolutePath);

  const source = readFileSync(absolutePath, 'utf8');
  if (importsComponent(source, ANALYTICS) || importsComponent(source, BASE_LAYOUT)) return true;

  for (const [, specifier] of source.matchAll(RELATIVE_ASTRO_IMPORT)) {
    if (isInstrumented(resolve(dirname(absolutePath), specifier), seen)) return true;
  }
  return false;
}

function astroFilesIn(dir) {
  const found = [];
  for (const entry of readdirSync(resolve(ROOT, dir), { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) found.push(...astroFilesIn(path));
    else if (entry.name.endsWith('.astro')) found.push(path);
  }
  return found;
}

// Sep 2026: Vercel Web Analytics showed requestPath "/" and nothing else for a month — every
// Astro-rendered page (fleet, hubs, trackers, tsa, news, 404, privacy, newark) only carried Speed
// Insights, which had been canceled on the project since Jul 14 2026. This pins the replacement:
// one shared wrapper that loads /_vercel/insights/script.js, mounted from every static document
// entrypoint, and no Speed Insights residue anywhere (its script would 404 against a canceled
// product and its CSP allowance would be dead weight).
describe('Web Analytics integration', () => {
  it('uses a shared Astro wrapper component that loads the Web Analytics script', () => {
    const component = readProjectFile('src/components/VercelAnalytics.astro');

    expect(component).toContain('<script is:inline defer src="/_vercel/insights/script.js"></script>');
    expect(component).not.toContain('speed-insights');
  });

  it('the dashboard loads the same script exactly once, as a static tag', () => {
    const dashboardEntry = readProjectFile('src/dashboard/main.js');
    const dashboardHtml = readProjectFile('public/index.html');

    expect(dashboardHtml.match(/\/_vercel\/insights\/script\.js/g)).toHaveLength(1);
    expect(dashboardHtml).toContain('<script defer src="/_vercel/insights/script.js"></script>');
    expect(dashboardEntry).not.toContain('@vercel/analytics');
    expect(dashboardEntry).not.toContain('speed-insights');
  });

  it('BaseLayout mounts the shared wrapper, so every page built on it is instrumented', () => {
    const baseLayout = readProjectFile('src/components/site/BaseLayout.astro');

    expect(importsComponent(baseLayout, ANALYTICS)).toBe(true);
    expect(baseLayout).toContain('<VercelAnalytics />');
  });

  it('every page and layout is instrumented, directly or through a layout it imports', () => {
    const documents = [...astroFilesIn('src/pages'), ...astroFilesIn('src/layouts')];

    expect(documents.length).toBeGreaterThan(10);
    for (const file of documents) {
      expect(isInstrumented(resolve(ROOT, file)), file).toBe(true);
    }
  });

  it('Speed Insights (canceled on the Vercel project Jul 2026) is fully removed', () => {
    expect(existsSync(resolve(ROOT, 'src/components/VercelSpeedInsights.astro'))).toBe(false);
    const pkg = JSON.parse(readProjectFile('package.json'));
    expect(pkg.dependencies?.['@vercel/speed-insights']).toBeUndefined();
    expect(pkg.devDependencies?.['@vercel/speed-insights']).toBeUndefined();
    expect(readProjectFile('vercel.json')).not.toContain('vitals.vercel-insights.com');
  });
});
