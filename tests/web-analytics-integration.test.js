import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(process.cwd());

function readProjectFile(path) {
  return readFileSync(resolve(ROOT, path), 'utf8');
}

const ANALYTICS_FILE = resolve(ROOT, 'src/components/VercelAnalytics.astro');
const BASE_LAYOUT_FILE = resolve(ROOT, 'src/components/site/BaseLayout.astro');

/** Default imports of a relative `.astro` file, capturing the local binding name. */
const ASTRO_IMPORT = /^\s*import\s+(\w+)\s+from\s+['"](\.[^'"]+\.astro)['"]\s*;?\s*$/gm;

/** Every default `.astro` import in a file, as `{ local, specifier }`. */
function astroImports(source) {
  return [...source.matchAll(ASTRO_IMPORT)].map(([, local, specifier]) => ({ local, specifier }));
}

/** True when `local` is actually rendered, not merely imported. */
function isMounted(source, local) {
  return new RegExp(`<${local}[\\s/>]`).test(source);
}

/**
 * A document is instrumented when it renders the analytics wrapper itself, renders
 * BaseLayout (which renders the wrapper), or renders another `.astro` component that
 * does — that last case is how the `[hub]`, `[type]`, `[slug]` and `[code]` pages
 * inherit it from their layouts.
 *
 * Importing is never enough: an unrendered import ships no script tag, so every step
 * of the chain has to be a real `import … from './x.astro'` statement AND a real
 * `<X …>` mount.
 */
function isInstrumented(absolutePath, seen = new Set()) {
  if (seen.has(absolutePath) || !existsSync(absolutePath)) return false;
  seen.add(absolutePath);

  const source = readFileSync(absolutePath, 'utf8');
  for (const { local, specifier } of astroImports(source)) {
    if (!isMounted(source, local)) continue;

    const target = resolve(dirname(absolutePath), specifier);
    if (target === ANALYTICS_FILE || target === BASE_LAYOUT_FILE) return true;
    if (isInstrumented(target, seen)) return true;
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

  it('the dashboard is instrumented through BaseLayout like every other page', () => {
    // The homepage used to be a hand-written public/index.html carrying its own analytics
    // tag. It is src/pages/index.astro now, so it inherits the single shared wrapper — and
    // the island must not pull in a second analytics client of its own.
    const homepage = readProjectFile('src/pages/index.astro');

    expect(homepage).toMatch(/^\s*import\s+BaseLayout\s+from\s+'\.\.\/components\/site\/BaseLayout\.astro';\s*$/m);
    expect(isMounted(homepage, 'BaseLayout')).toBe(true);
    expect(homepage).not.toContain('/_vercel/insights/script.js');
    expect(isInstrumented(resolve(ROOT, 'src/pages/index.astro'))).toBe(true);
  });

  it('BaseLayout imports AND mounts the shared wrapper, so pages built on it are instrumented', () => {
    const baseLayout = readProjectFile('src/components/site/BaseLayout.astro');

    expect(baseLayout).toMatch(/^\s*import\s+VercelAnalytics\s+from\s+'\.\.\/VercelAnalytics\.astro';\s*$/m);
    expect(baseLayout).toContain('<VercelAnalytics />');
  });

  it('every page and layout renders the wrapper, directly or through a layout it renders', () => {
    const documents = [...astroFilesIn('src/pages'), ...astroFilesIn('src/layouts')];

    expect(documents.length).toBeGreaterThan(10);
    for (const file of documents) {
      expect(isInstrumented(resolve(ROOT, file)), file).toBe(true);
    }
  });

  it('an import without a mount does not count as instrumented', () => {
    // Guards the check itself: an entrypoint that imports VercelAnalytics or BaseLayout but
    // never renders it ships no analytics script, and a substring match would have passed it.
    const importedButUnused = [
      "---",
      "import VercelAnalytics from '../components/VercelAnalytics.astro';",
      "import BaseLayout from '../components/site/BaseLayout.astro';",
      "---",
      "<p>no analytics here</p>",
    ].join('\n');

    for (const local of ['VercelAnalytics', 'BaseLayout']) {
      expect(isMounted(importedButUnused, local), local).toBe(false);
    }
    // Both are real import statements, so the file-level scan does see them...
    expect(astroImports(importedButUnused).map((i) => i.local)).toEqual([
      'VercelAnalytics',
      'BaseLayout',
    ]);
    // ...while a mention in prose or a comment is not an import statement at all.
    expect(astroImports('// see ../components/VercelAnalytics.astro for details')).toHaveLength(0);
  });

  it('Speed Insights (canceled on the Vercel project Jul 2026) is fully removed', () => {
    expect(existsSync(resolve(ROOT, 'src/components/VercelSpeedInsights.astro'))).toBe(false);
    const pkg = JSON.parse(readProjectFile('package.json'));
    expect(pkg.dependencies?.['@vercel/speed-insights']).toBeUndefined();
    expect(pkg.devDependencies?.['@vercel/speed-insights']).toBeUndefined();
    expect(readProjectFile('vercel.json')).not.toContain('vitals.vercel-insights.com');
  });
});
