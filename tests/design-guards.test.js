// Source guards for DESIGN.md rules that a rendered test cannot see, because jsdom applies no
// CSS: they are about which Tailwind variants and utilities appear at all.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import ts from 'typescript';
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

  // Nov 2026: the min-h guard above let a bare `md:h-9` / `md:size-8` through, and that is how
  // 32–36 px iPad targets shipped (DESIGN.md Decisions Log, 2026-11-11). A height or size under
  // 44 px (h-11) set by WIDTH alone is the same bug: it may only come from `pointer-fine:md:`.
  // Growth (`md:h-12` on the header) is not a relaxation and is not matched. Arbitrary values
  // (`md:h-[30px]`) are not matched either — none are in use.
  it('has no width-only h-* / size-* under 44 px at any breakpoint', () => {
    const SMALL = '(?:0|px|0\\.5|1|1\\.5|2|2\\.5|3|3\\.5|4|5|6|7|8|9|10)';
    const re = new RegExp(`(?<![\\w:-])(?:sm|md|lg|xl|2xl):(?:h|size)-${SMALL}\\b`);
    // Pinned: files outside the dashboard follow-up's ownership with a known violation, to be
    // fixed by their owners. Empty today; a new entry needs a reason.
    const KNOWN = [];
    expect(hits(SCOPE, re).filter((hit) => !KNOWN.includes(hit))).toEqual([]);
  });

  it('the h-/size- guard catches what it is for and lets the relaxed forms through', () => {
    const SMALL = '(?:0|px|0\\.5|1|1\\.5|2|2\\.5|3|3\\.5|4|5|6|7|8|9|10)';
    const re = new RegExp(`(?<![\\w:-])(?:sm|md|lg|xl|2xl):(?:h|size)-${SMALL}\\b`);
    for (const bad of ['min-h-11 md:h-8', 'size-11 md:size-9', 'lg:h-7', 'sm:size-6', 'md:h-10']) {
      expect(re.test(bad), bad).toBe(true);
    }
    for (const ok of ['pointer-fine:md:h-8', 'pointer-fine:md:size-7', 'md:h-12', 'md:h-11', 'lg:size-36', 'h-8', 'max-md:h-8', 'md:h-full']) {
      expect(re.test(ok), ok).toBe(false);
    }
  });

  it('gives Leaflet zoom buttons 44px on coarse pointers', () => {
    const css = readFileSync(resolve(ROOT, 'src/styles/global.css'), 'utf8');
    expect(css).toMatch(
      /@media \(pointer: coarse\)\s*\{\s*\.leaflet-container\.leaflet-touch \.leaflet-bar a\s*\{[^}]*width: 44px;[^}]*height: 44px;/,
    );
  });
});

describe('the map zoom buttons on a touch screen (Nov 2026)', () => {
  it('are not drawn for a coarse pointer on the Live map; the radar map and a mouse keep them', () => {
    const css = readFileSync(resolve(ROOT, 'src/styles/global.css'), 'utf8');
    const coarse = css.match(/@media \(pointer: coarse\)\s*\{([\s\S]*?)\n\}/);
    expect(coarse).not.toBeNull();
    expect(coarse[1]).toMatch(/\.leaflet-container\[data-map='live'\] \.leaflet-control-zoom\.leaflet-control\s*\{\s*display: none;/);
    // Nothing outside the coarse-pointer block hides them.
    const rest = css.replace(coarse[0], '');
    expect(rest).not.toMatch(/leaflet-control-zoom[^{]*\{[^}]*display:\s*none/);
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

// ── Link colour means link (links everywhere, Nov 12 2026) ─────────────────────────────────
// Nothing that is not a link or a button carries `text-primary` or an underline: the owner
// clicked a blue "UA576" that was a plain cell and nothing happened. This reads the JSX, so it
// knows which element a class lands on. A class string held in a constant (`BAR_BUTTON`, built
// from `PRESS`) is followed to the element that uses it, through template literals, ternaries
// and `cn(…)` calls; anything the file cannot resolve (an import) is not read.
//
// FlightLink, TailLink, HubLink and TypeLink print plain text when the name has no home, and
// their `className` lands on that plain rendering too, so it is checked; FlightLink's
// `linkClassName` reaches the link only and is not. DashLink, Button, `a` and `button` are
// links or buttons whatever they are given.
const LINK_ELEMENTS = new Set(['a', 'button', 'DashLink', 'Button']);
const PLAIN_TOO = new Set(['FlightLink', 'TailLink', 'HubLink', 'TypeLink']);

/** The utility a class names, without its variants (`hover:`, `pointer-coarse:`) or `!`. */
const utility = (cls) => cls.split(':').pop().replace(/^!/, '');
/** `text-primary` and `text-primary/80`; not `text-primary-foreground`. */
const LINK_COLOUR = (u) => /^text-primary(?:\/\d+)?$/.test(u);
/** `underline`; not `underline-offset-2`, `no-underline` or `decoration-*`. */
const UNDERLINE = (u) => u === 'underline';

/** Every element in `source` whose class names reach `text-primary` or an underline it may not carry. */
function linkStyleOffenders(source, fileName = 'inline.tsx') {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  // Same-file names a className can refer to: `const X = …` and `function f() {…}`.
  const named = new Map();
  (function index(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      named.set(node.name.text, [...(named.get(node.name.text) ?? []), node.initializer]);
    } else if (ts.isFunctionDeclaration(node) && node.name && node.body) {
      named.set(node.name.text, [...(named.get(node.name.text) ?? []), node.body]);
    }
    ts.forEachChild(node, index);
  })(sf);

  /** Every string piece an expression can produce, following same-file names once each. */
  function strings(node, seen = new Set()) {
    const out = [];
    (function walk(n) {
      if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) out.push(n.text);
      else if (ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) out.push(n.text);
      else if (ts.isIdentifier(n) && named.has(n.text) && !seen.has(n.text)) {
        seen.add(n.text);
        for (const target of named.get(n.text)) walk(target);
      }
      ts.forEachChild(n, walk);
    })(node);
    return out;
  }

  const offenders = [];
  (function visit(node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(sf);
      if (!LINK_ELEMENTS.has(tag)) {
        for (const attr of node.attributes.properties) {
          if (!ts.isJsxAttribute(attr) || attr.name.getText(sf) !== 'className' || !attr.initializer) continue;
          const classes = strings(attr.initializer).flatMap((s) => s.split(/\s+/)).filter(Boolean);
          const bad = classes.filter((c) => LINK_COLOUR(utility(c)) || UNDERLINE(utility(c)));
          if (bad.length) {
            const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
            offenders.push({ line, tag, classes: [...new Set(bad)], plainToo: PLAIN_TOO.has(tag) });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  })(sf);
  return offenders;
}

describe('link colour and underline only on links and buttons (links everywhere)', () => {
  // The views this guard covers. Parts 2 and 3 of "links everywhere" add theirs here.
  const SCOPE = [
    'src/app/views/StarlinkView.tsx',
    ...readdirSync(resolve(ROOT, 'src/app/views/starlink'))
      .filter((name) => name.endsWith('.tsx'))
      .map((name) => `src/app/views/starlink/${name}`),
  ];
  // `file:line` → why that element may carry link colour or an underline. Empty today; a new
  // entry needs a reason, and an entry that no longer matches anything fails.
  const ALLOW = {};

  it('finds no element in the Starlink tab that looks like a link and is not one', () => {
    const found = SCOPE.flatMap((file) =>
      linkStyleOffenders(readFileSync(resolve(ROOT, file), 'utf8'), file).map(
        (o) => `${file}:${o.line} <${o.tag}> ${o.classes.join(' ')}${o.plainToo ? ' (className reaches its plain-text rendering)' : ''}`,
      ),
    );
    const at = (entry) => entry.split(' ')[0];
    expect(found.filter((entry) => !(at(entry) in ALLOW))).toEqual([]);
    for (const [where, reason] of Object.entries(ALLOW)) {
      expect(reason.trim(), `${where} needs a reason`).not.toBe('');
      expect(found.map(at), `${where} is allowlisted but no longer matches`).toContain(where);
    }
  });

  it('covers every Starlink view file', () => {
    expect(SCOPE).toContain('src/app/views/starlink/RosterTable.tsx');
    expect(SCOPE).toContain('src/app/views/starlink/DeparturesBoard.tsx');
    expect(SCOPE.length).toBeGreaterThanOrEqual(8);
  });

  it('catches link colour or an underline on an element that is not a link or button', () => {
    const tags = (src) => linkStyleOffenders(src).map((o) => o.tag);
    expect(tags('const x = <span className="text-primary">UA576</span>;')).toEqual(['span']);
    expect(tags('const x = <td className="font-mono underline">ORD</td>;')).toEqual(['td']);
    expect(tags('const x = <span className="hover:underline">ORD</span>;')).toEqual(['span']);
    expect(tags('const x = <Card className="text-primary/80" />;')).toEqual(['Card']);
    expect(tags('const x = <p className={`a ${on ? "text-primary" : ""}`}>x</p>;')).toEqual(['p']);
    expect(tags("const x = <p className={cn('a', on && 'underline')}>x</p>;")).toEqual(['p']);
    // A constant, and a constant built from another one, followed to where they are used.
    expect(tags("const TONE = 'underline';\nconst CELL = `px-2 ${TONE}`;\nconst x = <td className={CELL}>x</td>;")).toEqual(['td']);
    expect(tags("function cls(on) { return on ? 'text-primary' : ''; }\nconst x = <div className={cls(true)} />;")).toEqual(['div']);
    // A per-kind link's className reaches its plain-text rendering.
    expect(tags('const x = <FlightLink ident={n} className="text-primary" />;')).toEqual(['FlightLink']);
    expect(tags('const x = <HubLink code={c} className="underline" />;')).toEqual(['HubLink']);
  });

  it('lets links, buttons and the near-misses through', () => {
    const ok = [
      'const x = <a href="/" className="text-primary underline underline-offset-2">x</a>;',
      'const x = <button className="underline hover:underline">x</button>;',
      'const x = <Button className="text-primary">x</Button>;',
      'const x = <DashLink href="/" className="underline">x</DashLink>;',
      'const x = <FlightLink ident={n} linkClassName="text-primary underline" />;',
      'const x = <span className="bg-primary text-primary-foreground underline-offset-2 decoration-muted-foreground/40 no-underline pointer-coarse:no-underline">x</span>;',
      // A constant applied only to a button.
      "const PRESS = 'underline';\nconst x = <button className={PRESS}>x</button>;",
      // A string that is not a className is not read.
      'const x = <span title="text-primary underline">x</span>;',
    ];
    for (const src of ok) expect(linkStyleOffenders(src), src).toEqual([]);
  });

  it('reports the line of the offending element', () => {
    expect(linkStyleOffenders('const a = 1;\n\nconst x = (\n  <span className="text-primary">x</span>\n);')).toEqual([
      { line: 4, tag: 'span', classes: ['text-primary'], plainToo: false },
    ]);
  });
});

// content.css styles the raw HTML strings in src/data (hub and fleet `headerTitle`, `contentHtml`,
// news bodies), which no class-reading guard can see. Its link colour and underlines may land
// only on links: the hub h1's `.iata` (ORD) and the fleet h1's `.type-badge` name the page itself
// and were painted in link colour without being links.
const CSS_LINK_SELECTOR = /(?:^|[\s>+~])a(?::[\w-]+(?:\([^)]*\))?)*$/;
// selector → why a rule that is not `… a` may carry link colour or an underline.
const CSS_LINK_ALLOW = {
  '.bb-content .live-link': 'set only on an <a> in the hub data strings (checked below)',
};

/** `selector` for every rule in `css` that applies link colour or an underline and does not target a link. */
function cssLinkStyleOffenders(css) {
  const out = [];
  const plain = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const [, selectors, body] of plain.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const applied = [...body.matchAll(/@apply([^;]*);/g)].flatMap(([, list]) => list.trim().split(/\s+/)).map(utility);
    const paints =
      applied.some((u) => LINK_COLOUR(u) || UNDERLINE(u)) ||
      /(?:^|;)\s*color:\s*var\(--primary\)/.test(body) ||
      /text-decoration(?:-line)?:\s*underline/.test(body);
    if (!paints) continue;
    for (const selector of selectors.split(',').map((s) => s.trim())) {
      if (!CSS_LINK_SELECTOR.test(selector)) out.push(selector);
    }
  }
  return out;
}

describe('content.css paints link colour and underlines only on links (links everywhere)', () => {
  it('finds no rule that makes something look like a link without being one', () => {
    const found = cssLinkStyleOffenders(readFileSync(resolve(ROOT, 'src/styles/content.css'), 'utf8'));
    expect(found.filter((s) => !(s in CSS_LINK_ALLOW))).toEqual([]);
    for (const [selector, reason] of Object.entries(CSS_LINK_ALLOW)) {
      expect(reason.trim(), `${selector} needs a reason`).not.toBe('');
      expect(found, `${selector} is allowlisted but no longer matches`).toContain(selector);
    }
  });

  it('.live-link is only ever an <a> in the data strings', () => {
    const tags = [...walkData(resolve(ROOT, 'src/data'))].flatMap((path) =>
      [...readFileSync(path, 'utf8').matchAll(/<([a-zA-Z][\w-]*)\b[^<>]*\blive-link\b/g)].map((m) => m[1]),
    );
    expect(tags.length).toBeGreaterThan(0);
    expect([...new Set(tags)]).toEqual(['a']);
  });

  it('catches link colour or an underline on a selector that is not a link, and lets links through', () => {
    expect(cssLinkStyleOffenders('@layer components { .bb-content .iata, .bb-content .type-badge { @apply font-mono text-primary; } }')).toEqual([
      '.bb-content .iata',
      '.bb-content .type-badge',
    ]);
    expect(cssLinkStyleOffenders('.x span { @apply hover:underline; }')).toEqual(['.x span']);
    expect(cssLinkStyleOffenders('.x .code { color: var(--primary); }')).toEqual(['.x .code']);
    expect(cssLinkStyleOffenders('.x .code { text-decoration: underline; }')).toEqual(['.x .code']);
    for (const ok of [
      '.bb-content a { @apply text-foreground underline decoration-muted-foreground/50; }',
      '.bb-content li a:hover { @apply text-primary; }',
      '.bb-content .btn { @apply bg-primary-fill text-primary-foreground no-underline underline-offset-2; }',
      '/* .bb-content .iata { @apply text-primary; } */',
    ]) {
      expect(cssLinkStyleOffenders(ok), ok).toEqual([]);
    }
  });
});

function* walkData(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walkData(path);
    else if (/\.(js|ts|json)$/.test(name)) yield path;
  }
}

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

describe('dashboard chrome icons are lucide-react, not emoji (DESIGN.md Components; audit F73)', () => {
  // Pictographic emoji render differently on every OS (🎫 is a concert ticket on Apple) and
  // mixed with lucide in the same bar. Content copy (welcome, toasts, news) may still use
  // them; the navigation and control chrome below may not. Typographic glyphs (✓ ✕ ⚠ →) are
  // outside this range and stay allowed.
  const CHROME = [
    'src/app/tabs.ts',
    'src/app/shell/TabBar.tsx',
    'src/app/shell/MobileNav.tsx',
    'src/app/shell/Header.tsx',
    'src/app/shell/HubHealthStrip.tsx',
    'src/app/views/live/MapControls.tsx',
    'src/app/views/SourcesView.tsx',
    'src/app/views/StatsView.tsx',
    'src/app/features/SearchPalette.tsx',
    'src/app/features/NewsBanner.tsx',
    'src/app/features/TipStrip.tsx',
  ].map((p) => resolve(ROOT, p));

  it('uses no pictographic emoji outside comments', () => {
    const PICTO = /[\u{1F000}-\u{1FAFF}]/u;
    const offenders = [];
    for (const path of CHROME) {
      readFileSync(path, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          const code = line.trim();
          if (code.startsWith('//') || code.startsWith('*') || code.startsWith('/*') || code.startsWith('{/*')) return;
          if (PICTO.test(line)) offenders.push(`${relative(ROOT, path)}:${i + 1}`);
        });
    }
    expect(offenders).toEqual([]);
  });
});
