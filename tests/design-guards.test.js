// Source guards for DESIGN.md rules that a rendered test cannot see, because jsdom applies no
// CSS: they are about which Tailwind variants and utilities appear at all.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..');

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (/\.(tsx|ts|astro|css)$/.test(name)) yield path;
  }
}

/** Lines matching `re`, as `file:line` — comments included on purpose: prose can't opt out. */
function hits(paths, re) {
  const out = [];
  for (const path of paths) {
    readFileSync(path, 'utf8')
      .split('\n')
      .forEach((line, i) => {
        if (re.test(line)) out.push(`${relative(ROOT, path)}:${i + 1}`);
      });
  }
  return out;
}

describe('no glassmorphism (DESIGN.md: "No glassmorphism … blur")', () => {
  it('uses no backdrop-blur anywhere under src/', () => {
    // shadcn's overlays shipped `supports-backdrop-filter:backdrop-blur-xs` and the map chrome
    // `bg-background/90 backdrop-blur` (audit F74). Scrims are a plain bg-black/60 now.
    expect(hits(walk(resolve(ROOT, 'src')), /backdrop-blur|backdrop-filter/)).toEqual([]);
  });
});

describe('touch targets relax only for a fine pointer (audit F24)', () => {
  // Width is not input type: an iPad at 768/1024 px is a touch device. The 44 px floor may
  // only come off at md AND pointer:fine. These are the surfaces this rule has been applied
  // to so far; the view tables are tracked separately.
  const SCOPE = [
    'src/app/shell',
    'src/app/views/live',
    'src/components',
    'src/app/features/NewsBanner.tsx',
    'src/app/features/TipStrip.tsx',
    'src/app/features/BmacToast.tsx',
  ].flatMap((p) => {
    const abs = resolve(ROOT, p);
    return statSync(abs).isDirectory() ? [...walk(abs)] : [abs];
  });

  it('has no width-only md:min-h-0 / md:min-w-0 / md:min-h-8 / md:min-h-9 relaxations', () => {
    expect(hits(SCOPE, /(?<![\w:-])md:min-[hw]-(0|8|9)\b/)).toEqual([]);
  });

  it('gives Leaflet zoom buttons 44px on coarse pointers', () => {
    const css = readFileSync(resolve(ROOT, 'src/styles/global.css'), 'utf8');
    expect(css).toMatch(
      /@media \(pointer: coarse\)\s*\{\s*\.leaflet-container\.leaflet-touch \.leaflet-bar a\s*\{[^}]*width: 44px;[^}]*height: 44px;/,
    );
  });
});

describe('phone inputs are 16px (iOS zooms below that; audit F23)', () => {
  it('CommandInput keeps text-base below md', () => {
    const src = readFileSync(resolve(ROOT, 'src/components/ui/command.tsx'), 'utf8');
    expect(src).toMatch(/CommandPrimitive\.Input[\s\S]*?"w-full text-base [^"]*md:text-sm/);
  });
});

describe('links in running text are not colour-only (audit F43, WCAG 1.4.1)', () => {
  it("TrackerPulse's in-sentence 'The Blue Board' link is underlined at rest", () => {
    const src = readFileSync(resolve(ROOT, 'src/components/trackers/TrackerPulse.astro'), 'utf8');
    const tag = src.match(/<a\s+href="\/"\s+class="([^"]*)">The Blue Board<\/a/);
    expect(tag).not.toBeNull();
    expect(tag[1].split(/\s+/)).toContain('underline');
  });
});

describe('content pages keep an 11px type floor (audit F75)', () => {
  // DESIGN.md reserves arbitrary micro sizes for dense DASHBOARD chrome; the prerendered
  // content pages had carried the legacy tracker CSS's 8–10px labels over.
  const CONTENT = ['src/pages', 'src/components/trackers', 'src/components/site', 'src/layouts', 'src/styles/content.css'].flatMap((p) => {
    const abs = resolve(ROOT, p);
    return statSync(abs).isDirectory() ? [...walk(abs)] : [abs];
  });

  it('uses no text-[8px]/[9px]/[10px] or font-size under 11px', () => {
    expect(hits(CONTENT, /text-\[(?:[0-9]|10)px\]|font-size:\s*(?:[0-9]|10)px/)).toEqual([]);
  });
});
