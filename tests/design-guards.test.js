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
  // only come off at md AND pointer:fine — across the whole dashboard and every component.
  const SCOPE = ['src/app', 'src/components'].flatMap((p) => [...walk(resolve(ROOT, p))]);

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
  it('every dashboard <Input> sizes below 16px only from md up', () => {
    const offenders = [];
    for (const path of walk(resolve(ROOT, 'src/app'))) {
      const src = readFileSync(path, 'utf8');
      // Up to the self-closing `/>`: an `onChange={(e) => …}` would end a `[^>]*` match early.
      for (const [tag] of src.matchAll(/<Input\b[\s\S]*?\/>/g)) {
        const cls = tag.match(/className="([^"]*)"/);
        if (!cls) continue;
        const small = cls[1]
          .split(/\s+/)
          .filter((c) => /^text-(xs|sm|\[\d+px\])$/.test(c));
        if (small.length) offenders.push(`${relative(ROOT, path)}: ${small.join(' ')}`);
      }
    }
    expect(offenders).toEqual([]);
  });

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

describe('status colour comes from the DESIGN.md tokens, not the raw Tailwind palette (audit F72)', () => {
  // The dashboard carried ~260 raw palette classes (text-amber-400, text-emerald-400 …), so its
  // "ok" green was a different green from the content pages' --color-bb-ok. Status is
  // bb-ok / bb-warn / destructive, Starlink is bb-starlink, informative is bb-info, and
  // anything else is a neutral token. Zinc/gray/slate scrims are not status and are not scanned.
  const SCOPE = ['src/app', 'src/components', 'src/pages', 'src/layouts'].flatMap((p) => [
    ...walk(resolve(ROOT, p)),
  ]);
  const HUES = 'red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose';
  const RAW = new RegExp(
    `(?<![\\w-])(?:text|bg|border(?:-[lrtbxy])?|fill|stroke|ring|decoration|outline|from|to|via|shadow|accent|caret)-(?:${HUES})-\\d{2,3}\\b`,
  );

  it('uses no raw chromatic palette utility anywhere in the UI', () => {
    expect(hits(SCOPE, RAW)).toEqual([]);
  });

  it('every token utility it uses is declared in global.css', () => {
    const css = readFileSync(resolve(ROOT, 'src/styles/global.css'), 'utf8');
    for (const token of ['bb-ok', 'bb-warn', 'bb-info', 'bb-starlink']) {
      expect(css, `--color-${token} missing from @theme`).toMatch(new RegExp(`--color-${token}:`));
    }
  });
});

describe('every var(--x) in markup names a declared custom property (audit F72)', () => {
  // `text-[var(--bb-warn)]` shipped on six content pages and resolved to nothing: Tailwind's
  // @theme emits --color-bb-warn, never --bb-warn. A misnamed var() fails silently in CSS.
  const declared = new Set();
  for (const css of ['src/styles/global.css', 'src/styles/content.css']) {
    for (const m of readFileSync(resolve(ROOT, css), 'utf8').matchAll(/(--[\w-]+)\s*:/g)) declared.add(m[1]);
  }
  const SCOPE = ['src/app', 'src/components', 'src/pages', 'src/layouts'].flatMap((p) => [
    ...walk(resolve(ROOT, p)),
  ]);

  it('finds no var() of an undeclared name', () => {
    const offenders = [];
    for (const path of SCOPE) {
      const src = readFileSync(path, 'utf8');
      // A property the same file sets inline (`style={{ '--gap': … }}`) is declared too.
      const local = new Set([...src.matchAll(/['"](--[\w-]+)['"]\s*:/g)].map((m) => m[1]));
      for (const m of src.matchAll(/var\((--[\w-]+)/g)) {
        if (!declared.has(m[1]) && !local.has(m[1])) offenders.push(`${relative(ROOT, path)}: ${m[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
