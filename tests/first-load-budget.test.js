// First-load guards for the homepage and the content pages (audit F53/F54). Measured on a local
// `bun run build` + preview with Lighthouse 12 mobile, median of 3:
//   home      simulated LCP 3.83 s → 3.64 s, TBT ~140 → ~60 ms, CLS 0.062 → 0.006;
//             devtools-throttled LCP 3.59 s → 3.43 s
//   /fleet/737-800  CLS 0.145 → 0 (perf 94 → 99)
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..');
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');

describe('the Dashboard chunk that gates the map stays lean (F53)', () => {
  const dashboard = read('src/app/Dashboard.tsx');
  // Overlays nobody sees at first paint are split out: ⌘K (with cmdk), the flight sheet and
  // the root dialogs cut the Dashboard chunk from 357 KB to 238 KB raw.
  const LAZY = [
    'SearchPalette',
    'FlightSheet',
    'AircraftDetailDialog',
    'DelayExplainDialog',
    'DisclaimerDialog',
    'Fr24LookupDialog',
    'Onboarding',
    'WaitlistDialog',
  ];

  it.each(LAZY)('%s is loaded with a dynamic import, never a static one', (name) => {
    expect(dashboard).not.toMatch(new RegExp(`^import[^;]*from '\\./features/${name}'`, 'm'));
    expect(dashboard).toMatch(new RegExp(`lazy\\(\\(\\) =>\\s*import\\('\\./features/${name}'\\)`));
  });

  it('mounts the lazy overlays inside Suspense boundaries', () => {
    expect(dashboard.match(/<Suspense fallback=\{null\}>/g)?.length).toBeGreaterThanOrEqual(2);
  });
});

describe('content pages preload the body font (F54)', () => {
  it('BaseLayout preloads the exact woff2 the Geist @font-face serves', () => {
    const layout = read('src/components/site/BaseLayout.astro');
    const fontCss = read('node_modules/@fontsource-variable/geist/index.css');
    const file = 'geist-latin-wght-normal.woff2';
    expect(fontCss).toContain(file);
    expect(layout).toContain(`import geistLatin from '@fontsource-variable/geist/files/${file}?url';`);
    expect(layout).toMatch(/<link rel="preload" href=\{geistLatin\} as="font" type="font\/woff2" crossorigin \/>/);
  });
});
