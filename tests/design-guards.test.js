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
// FlightLink, TailLink, HubLink, HubStatusLink and TypeLink print plain text when the name has no
// home, and their `className` lands on that plain rendering too, so it is checked; FlightLink's
// `linkClassName` reaches the link only and is not. DashLink, Button, `a`, `button` and
// ToggleGroupItem (a Radix toggle, rendered as a button) are links or buttons whatever they are
// given. Inside one of them, an element marked `aria-hidden` (and what it wraps) is that
// control's own state mark: the active sort arrow inside a sort header's button, the watched eye
// inside the watch toggle (DESIGN.md 2026-11-11: "↑/↓ in primary"; "an 'on' toggle takes the
// primary colour"). Anything else inside a control is held to the rule, so a blue flight number
// inside a whole-block button fails, and so does an element inside any other component (a Card, a
// TailLink, which may print plain text).
const LINK_ELEMENTS = new Set(['a', 'button', 'DashLink', 'Button', 'ToggleGroupItem']);
const PLAIN_TOO = new Set(['FlightLink', 'TailLink', 'HubLink', 'HubStatusLink', 'TypeLink']);

/** The utility a class names, without its variants (`hover:`, `pointer-coarse:`) or `!`. */
const utility = (cls) => cls.split(':').pop().replace(/^!/, '');
/** `text-primary`, `text-primary/80` and `text-[var(--color-primary)]`; not `text-primary-foreground`. */
const LINK_COLOUR = (u) => /^text-primary(?:\/\d+)?$/.test(u) || /^text-\[var\(--(?:color-)?primary\)\]$/.test(u);
/** `underline`; not `underline-offset-2`, `no-underline` or `decoration-*`. */
const UNDERLINE = (u) => u === 'underline';

/** Same-file names a class string can come from: `const X = …` and `function f() {…}`. */
function indexNames(sf, named = new Map()) {
  (function index(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      named.set(node.name.text, [...(named.get(node.name.text) ?? []), node.initializer]);
    } else if (ts.isFunctionDeclaration(node) && node.name && node.body) {
      named.set(node.name.text, [...(named.get(node.name.text) ?? []), node.body]);
    }
    ts.forEachChild(node, index);
  })(sf);
  return named;
}

/** Every string piece an expression can produce, following same-file names once each. */
function stringPieces(node, named, seen = new Set()) {
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

/** Every element in `source` whose class names reach `text-primary` or an underline it may not carry. */
function linkStyleOffenders(source, fileName = 'inline.tsx') {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const named = indexNames(sf);
  const strings = (node) => stringPieces(node, named);

  /** `aria-hidden`, `aria-hidden="true"` or `aria-hidden={true}` on an opening tag. */
  const ariaHidden = (opening) =>
    opening.attributes.properties.some((attr) => {
      if (!ts.isJsxAttribute(attr) || attr.name.getText(sf) !== 'aria-hidden') return false;
      const init = attr.initializer;
      if (!init) return true;
      if (ts.isStringLiteral(init)) return init.text === 'true';
      return ts.isJsxExpression(init) && init.expression?.kind === ts.SyntaxKind.TrueKeyword;
    });

  const offenders = [];
  // `insideControl`: within a link or button. `markOfControl`: within an `aria-hidden` element
  // that is itself within one, which is the control's own state mark.
  (function visit(node, insideControl = false, markOfControl = false) {
    const opening = ts.isJsxElement(node) ? node.openingElement : ts.isJsxSelfClosingElement(node) ? node : null;
    const mark = markOfControl || (insideControl && opening !== null && ariaHidden(opening));
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(sf);
      if (!LINK_ELEMENTS.has(tag) && !markOfControl && !(insideControl && ariaHidden(node))) {
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
    const opensControl = ts.isJsxElement(node) && LINK_ELEMENTS.has(node.openingElement.tagName.getText(sf));
    ts.forEachChild(node, (child) => visit(child, insideControl || (opensControl && child !== node.openingElement), mark));
  })(sf);
  return offenders;
}

/**
 * Link colour or an underline in the class maps of a plain `.ts` module (a view folder's
 * `tone.ts`): which element a string lands on is not known there, so every such string counts,
 * named by the declaration that holds it (`MY_FLIGHT_STATUS_TONE`, `riskControlClass`). Comments
 * are not read.
 */
function classMapOffenders(source, fileName = 'inline.ts') {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const offenders = [];
  (function visit(node, holder) {
    let name = holder;
    if ((ts.isVariableDeclaration(node) || ts.isFunctionDeclaration(node)) && node.name && ts.isIdentifier(node.name)) {
      name = node.name.text;
    }
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      const bad = node.text.split(/\s+/).filter(Boolean).filter((c) => LINK_COLOUR(utility(c)) || UNDERLINE(utility(c)));
      if (bad.length) {
        const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
        offenders.push({ line, tag: name ?? '(module)', classes: [...new Set(bad)] });
      }
    }
    ts.forEachChild(node, (child) => visit(child, name));
  })(sf, null);
  return offenders;
}

describe('link colour and underline only on links and buttons (links everywhere)', () => {
  // Every dashboard view that prints names, and the overlays, panels and shell pieces that do:
  // each tab's view and its folder, the watch panel and banner, the hub strip and the ticker, the
  // flight sheet, the aircraft, FR24 and delay dialogs, the search palette, the brief's panel and
  // sheet, and the shared pieces a row prints (the livery badge, jargon terms, the ask chips).
  // Plus the class maps in the view folders' `.ts` modules (`classMapOffenders`).
  const tsxIn = (dir) =>
    readdirSync(resolve(ROOT, dir))
      .filter((name) => name.endsWith('.tsx'))
      .map((name) => `${dir}/${name}`);
  const VIEWS = ['Starlink', 'Schedule', 'Live', 'Stats', 'Weather', 'Fleet', 'MyFlights', 'Sources'];
  const VIEW_DIRS = ['starlink', 'schedule', 'live', 'stats', 'weather', 'fleet', 'myflight'];
  const SCOPE = [
    ...VIEWS.map((view) => `src/app/views/${view}View.tsx`),
    ...VIEW_DIRS.flatMap((dir) => tsxIn(`src/app/views/${dir}`)),
    ...['WatchPanel', 'WatchBanner', 'HubHealthStrip', 'Ticker'].map((name) => `src/app/shell/${name}.tsx`),
    ...[
      'FlightSheet',
      'AircraftDetailDialog',
      'Fr24LookupDialog',
      'DelayExplainDialog',
      'SearchPalette',
      'BriefPanel',
      'BriefSheet',
      'SpecialLiveryBadge',
      'JargonTerm',
      'AskChips',
    ].map((name) => `src/app/features/${name}.tsx`),
  ];
  // The view folders' plain `.ts` modules, whose class maps a view applies (`tone.ts`).
  const TS_SCOPE = VIEW_DIRS.flatMap((dir) =>
    readdirSync(resolve(ROOT, `src/app/views/${dir}`))
      .filter((name) => name.endsWith('.ts'))
      .map((name) => `src/app/views/${dir}/${name}`),
  );
  // `file <tag> classes` → how many such elements (or, in a `.ts` module, strings under that
  // declaration) the file may hold and why they may carry link colour or an underline
  // (`allowlistProblems`, below: what it is, not its line).
  const ALLOW = {
    'src/app/views/myflight/tone.ts <MY_FLIGHT_STATUS_TONE> text-primary': {
      count: 2,
      reason:
        'My Flights\' "En Route" and "Scheduled" status pills: primary-tinted status badges on a Badge that is not a link, older than links everywhere. Recolouring them is a visual call left to the owner',
    },
    'src/app/views/schedule/tone.ts <riskControlClass> hover:underline': {
      count: 1,
      reason: "the quiet LOW delay-risk control's hover underline: it is applied to the risk badge's button (SchedulePhoneRow, ScheduleTable)",
    },
  };

  it('finds no element in the dashboard that looks like a link and is not one', () => {
    const found = [
      ...SCOPE.flatMap((file) =>
        linkStyleOffenders(readFileSync(resolve(ROOT, file), 'utf8'), file).map(
          (o) => `${file}:${o.line} <${o.tag}> ${o.classes.join(' ')}${o.plainToo ? ' (className reaches its plain-text rendering)' : ''}`,
        ),
      ),
      ...TS_SCOPE.flatMap((file) =>
        classMapOffenders(readFileSync(resolve(ROOT, file), 'utf8'), file).map((o) => `${file}:${o.line} <${o.tag}> ${o.classes.join(' ')}`),
      ),
    ];
    expect(allowlistProblems(found, ALLOW)).toEqual([]);
  });

  it("reads a class map in a view folder's .ts module", () => {
    expect(TS_SCOPE).toContain('src/app/views/myflight/tone.ts');
    expect(TS_SCOPE).toContain('src/app/views/schedule/tone.ts');
    const found = (src) => classMapOffenders(src).map((o) => `<${o.tag}> ${o.classes.join(' ')}`);
    expect(found("export const TONE = { airborne: 'text-primary', ground: 'text-muted-foreground' };")).toEqual(['<TONE> text-primary']);
    expect(found("export function cls(on: boolean) { return on ? `px-1 hover:underline` : ''; }")).toEqual(['<cls> hover:underline']);
    // A comment that names a class is not a class.
    expect(found("// text-primary underline\nexport const A = 'underline-offset-2 no-underline text-primary-foreground';")).toEqual([]);
  });

  it('covers every dashboard view and the overlays that print names', () => {
    for (const file of [
      'src/app/views/starlink/RosterTable.tsx',
      'src/app/views/starlink/DeparturesBoard.tsx',
      'src/app/views/schedule/ScheduleTable.tsx',
      'src/app/views/schedule/SchedulePhoneRow.tsx',
      'src/app/views/live/LiveSidebar.tsx',
      'src/app/views/live/MapControls.tsx',
      'src/app/views/stats/HubMatrix.tsx',
      'src/app/views/weather/NasPanel.tsx',
      'src/app/views/weather/HubCard.tsx',
      'src/app/views/fleet/FleetTable.tsx',
      'src/app/views/fleet/SortableHeader.tsx',
      'src/app/views/myflight/FlightCard.tsx',
      'src/app/views/SourcesView.tsx',
      'src/app/shell/WatchPanel.tsx',
      'src/app/features/FlightSheet.tsx',
      'src/app/features/AircraftDetailDialog.tsx',
      'src/app/features/Fr24LookupDialog.tsx',
      'src/app/features/DelayExplainDialog.tsx',
      'src/app/features/BriefPanel.tsx',
      'src/app/features/SearchPalette.tsx',
      'src/app/features/SpecialLiveryBadge.tsx',
      'src/app/features/JargonTerm.tsx',
      'src/app/features/AskChips.tsx',
      'src/app/shell/HubHealthStrip.tsx',
      'src/app/shell/Ticker.tsx',
    ]) {
      expect(SCOPE).toContain(file);
    }
    for (const file of SCOPE) expect(statSync(resolve(ROOT, file)).isFile(), file).toBe(true);
    expect(SCOPE.length).toBeGreaterThanOrEqual(72);
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
    expect(tags('const x = <HubStatusLink code={c} kind="nas" className="text-primary" />;')).toEqual(['HubStatusLink']);
    // Beside a button is not inside it; inside a component that is not a control is not either,
    // and a per-kind link may print plain text, so what it wraps is held to the rule too.
    expect(tags('const x = <div><button>Sort</button><span className="text-primary">↑</span></div>;')).toEqual(['span']);
    expect(tags('const x = <Card><span className="text-primary">UA576</span></Card>;')).toEqual(['span']);
    expect(tags('const x = <TailLink reg={r}><span className="underline">{r}</span></TailLink>;')).toEqual(['span']);
    // After a button closes, the next element is outside it.
    expect(tags('const x = <p><button><i /></button><b className="underline">x</b></p>;')).toEqual(['b']);
    // Inside a control, only a mark hidden from assistive tech is part of it. A name inside a
    // whole-block button (a blue flight number that sends the map somewhere) is still held.
    expect(tags('const x = <button onClick={onViewOnMap}><span className="text-primary">UA360</span> DEN → SEA</button>;')).toEqual(['span']);
    expect(tags('const x = <Button><span aria-hidden="false" className="text-primary">UA360</span></Button>;')).toEqual(['span']);
    expect(tags('const x = <a href="/"><span><i className="underline">x</i></span></a>;')).toEqual(['i']);
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
      // A control's own state marks: an `aria-hidden` element inside a link or button (and what
      // it wraps) is part of it, and a toggle group item is a button.
      'const x = <button onClick={f}>Time<span aria-hidden="true" className={on ? "text-primary" : "text-muted-foreground"}>↑</span></button>;',
      'const x = <Button aria-pressed={w}><Eye aria-hidden="true" className={w ? "text-primary" : ""} /></Button>;',
      'const x = <a href="/"><span aria-hidden><i className="underline">x</i></span></a>;',
      'const x = <ToggleGroupItem value="hubs" className="data-[state=on]:text-primary">Hubs</ToggleGroupItem>;',
    ];
    for (const src of ok) expect(linkStyleOffenders(src), src).toEqual([]);
  });

  it('reports the line of the offending element', () => {
    expect(linkStyleOffenders('const a = 1;\n\nconst x = (\n  <span className="text-primary">x</span>\n);')).toEqual([
      { line: 4, tag: 'span', classes: ['text-primary'], plainToo: false },
    ]);
  });
});

// ── The same rule on the content pages (links everywhere, part 3) ────────────────────────────
// An .astro file is not TSX, so it is read in two parts: the frontmatter with TypeScript (for the
// class constants it declares, followed as above) and the template with a small tag scanner that
// knows which element a class lands on and which elements it sits inside. An element that is a
// link, a button or a disclosure (`summary`), or sits inside one, is part of that control. A class
// that styles descendant links (`[&_a]:text-primary` on a paragraph) is the links' look, not the
// element's. The page scripts that paint rows at runtime are read with TypeScript: a class given to
// `el('span', …)`, or set through `.className` / `.classList` on an element made by
// `document.createElement('span')`, counts against that element; an element the script found in
// the page (a `querySelector` result) is of unknown kind and is held to the rule. A class held in
// an import (`LINK_TONE`) is not read, as above; the script tests check the painted DOM.

const CONTENT_CONTROLS = new Set(['a', 'button', 'summary']);
const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);

/** Link colour or an underline that styles the element itself, not its descendant links. */
const ownLinkStyle = (cls) => {
  const variants = cls.split(':').slice(0, -1);
  if (variants.some((v) => /^\[&[_>]a(?![\w-])/.test(v))) return false;
  return LINK_COLOUR(utility(cls)) || UNDERLINE(utility(cls));
};

/** `text` with every match of `re` replaced by spaces (newlines kept), so offsets and lines hold. */
const blankOut = (text, re) => text.replace(re, (m) => m.replace(/[^\n]/g, ' '));

/** Index just past a balanced `{…}` that opens at `i`, stepping over quoted strings. */
function skipBraces(text, i) {
  let depth = 0;
  for (; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'" || c === '`') i = skipQuoted(text, i);
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i + 1;
  }
  return text.length;
}

/** Index of the quote that closes the string opening at `i` (template literals' `${…}` included). */
function skipQuoted(text, i) {
  const q = text[i];
  for (i++; i < text.length; i++) {
    if (text[i] === '\\') i++;
    else if (q === '`' && text[i] === '$' && text[i + 1] === '{') i = skipBraces(text, i + 1) - 1;
    else if (text[i] === q) return i;
  }
  return text.length;
}

/** The opening and closing tags of an Astro template, in order, with each opening tag's attributes. */
function* astroTags(template) {
  const CLOSE = /<\/([A-Za-z][\w.:-]*)\s*>/y;
  const OPEN = /<([A-Za-z][\w.:-]*)/y;
  const NAME = /[^\s=>/{]+/y;
  const BARE = /[^\s>]+/y;
  const sticky = (re, at) => {
    re.lastIndex = at;
    return re.exec(template);
  };
  for (let i = template.indexOf('<'); i !== -1; i = template.indexOf('<', i)) {
    const close = sticky(CLOSE, i);
    if (close) {
      yield { closing: true, tag: close[1], start: i };
      i += close[0].length;
      continue;
    }
    const open = sticky(OPEN, i);
    if (!open) {
      i++;
      continue;
    }
    let j = i + open[0].length;
    const attrs = [];
    let selfClosing = false;
    while (j < template.length) {
      while (/\s/.test(template[j] ?? '')) j++;
      if (template[j] === '>') {
        j++;
        break;
      }
      if (template.startsWith('/>', j)) {
        selfClosing = true;
        j += 2;
        break;
      }
      if (template[j] === '{') {
        j = skipBraces(template, j); // {...spread}
        continue;
      }
      const name = sticky(NAME, j);
      if (!name) {
        j++;
        continue;
      }
      j += name[0].length;
      while (/\s/.test(template[j] ?? '')) j++;
      if (template[j] !== '=') {
        attrs.push({ name: name[0], kind: 'bare' });
        continue;
      }
      j++;
      while (/\s/.test(template[j] ?? '')) j++;
      const c = template[j];
      if (c === '"' || c === "'") {
        const end = template.indexOf(c, j + 1);
        attrs.push({ name: name[0], kind: 'string', value: template.slice(j + 1, end) });
        j = end + 1;
      } else if (c === '{') {
        const end = skipBraces(template, j);
        attrs.push({ name: name[0], kind: 'expression', value: template.slice(j + 1, end - 1) });
        j = end;
      } else {
        const bare = sticky(BARE, j);
        attrs.push({ name: name[0], kind: 'string', value: bare?.[0] ?? '' });
        j += bare?.[0].length ?? 1;
      }
    }
    yield { tag: open[1], attrs, start: i, selfClosing };
    i = j;
  }
}

/** Every element in an .astro file that carries link colour or an underline and is not, and is not inside, a link, button or disclosure. */
function astroLinkStyleOffenders(source, seen = { styled: 0 }) {
  const fm = source.match(/^---\r?\n([\s\S]*?)\r?\n---[^\n]*\n?/);
  const offset = fm ? fm[0].length : 0;
  const named = indexNames(ts.createSourceFile('frontmatter.ts', fm ? fm[1] : '', ts.ScriptTarget.Latest, true, ts.ScriptKind.TS));
  let template = source.slice(offset);
  template = blankOut(template, /<!--[\s\S]*?-->/g);
  template = blankOut(template, /\{\/\*[\s\S]*?\*\/\}/g);
  template = blankOut(template, /<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/g);

  const classesOf = (attr) => {
    if (attr.kind === 'string') return [attr.value];
    if (attr.kind !== 'expression') return [];
    const sf = ts.createSourceFile('class.ts', `(${attr.value});`, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    return stringPieces(sf, indexNames(sf, new Map(named)));
  };
  const stack = [];
  const offenders = [];
  for (const t of astroTags(template)) {
    if (t.closing) {
      const at = stack.lastIndexOf(t.tag);
      if (at !== -1) stack.length = at;
      continue;
    }
    const classes = t.attrs
      .filter((a) => a.name === 'class' || a.name === 'class:list')
      .flatMap(classesOf)
      .flatMap((s) => s.split(/\s+/))
      .filter(Boolean);
    const bad = [...new Set(classes.filter(ownLinkStyle))];
    if (bad.length) seen.styled++;
    const control = CONTENT_CONTROLS.has(t.tag) || stack.some((tag) => CONTENT_CONTROLS.has(tag));
    if (bad.length && !control) {
      const line = source.slice(0, offset + t.start).split('\n').length;
      offenders.push({ line, tag: t.tag, classes: bad });
    }
    if (!t.selfClosing && !VOID_TAGS.has(t.tag.toLowerCase())) stack.push(t.tag);
  }
  return offenders;
}

/** Every class a page script gives an element that is not a link or button and that carries link colour or an underline. */
function scriptLinkStyleOffenders(source, fileName = 'inline.ts') {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const named = indexNames(sf);
  const unwrap = (n) => {
    while (ts.isParenthesizedExpression(n) || ts.isAsExpression(n) || ts.isNonNullExpression(n) || ts.isTypeAssertionExpression(n)) n = n.expression;
    return n;
  };
  /** The tags an element expression can be: 'span' from createElement('span') or el('span', …), else '?'. */
  const tagsOf = (node, seen = new Set()) => {
    const n = unwrap(node);
    if (ts.isCallExpression(n)) {
      const callee = n.expression.getText(sf);
      const first = n.arguments[0];
      if ((callee === 'document.createElement' || callee === 'el') && first && ts.isStringLiteralLike(first)) return [first.text];
      return ['?'];
    }
    if (ts.isIdentifier(n) && named.has(n.text) && !seen.has(n.text)) {
      seen.add(n.text);
      return named.get(n.text).flatMap((init) => tagsOf(init, seen));
    }
    return ['?'];
  };
  const offenders = [];
  const sink = (tags, classNodes, at) => {
    if (tags.every((tag) => tag === 'a' || tag === 'button')) return;
    const classes = classNodes.flatMap((c) => stringPieces(c, named)).flatMap((s) => s.split(/\s+/)).filter(Boolean);
    const bad = [...new Set(classes.filter(ownLinkStyle))];
    if (!bad.length) return;
    const line = sf.getLineAndCharacterOfPosition(at.getStart(sf)).line + 1;
    offenders.push({ line, tag: [...new Set(tags)].join('|'), classes: bad });
  };
  (function visit(node) {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const [first, second] = node.arguments;
      if (ts.isIdentifier(callee) && callee.text === 'el' && first && ts.isStringLiteralLike(first) && second) {
        sink([first.text], [second], node);
      } else if (ts.isPropertyAccessExpression(callee) && ts.isPropertyAccessExpression(callee.expression) && callee.expression.name.text === 'classList') {
        const method = callee.name.text;
        const added = method === 'replace' ? node.arguments.slice(1) : ['add', 'toggle'].includes(method) ? node.arguments : [];
        if (added.length) sink(tagsOf(callee.expression.expression), added, node);
      }
    } else if (
      ts.isBinaryExpression(node) &&
      [ts.SyntaxKind.EqualsToken, ts.SyntaxKind.PlusEqualsToken].includes(node.operatorToken.kind) &&
      ts.isPropertyAccessExpression(node.left) &&
      node.left.name.text === 'className'
    ) {
      sink(tagsOf(node.left.expression), [node.right], node);
    }
    ts.forEachChild(node, visit);
  })(sf);
  return offenders;
}

/**
 * What is wrong with `found` (offenders as "file:line <tag> classes") against `allow`, keyed by
 * "file <tag> classes" (what the element is, not its line, so a copy edit above it changes
 * nothing) with the number of such elements the file may hold and why. A key found more often than
 * allowed reports every one of its elements; an entry found less often, or with no reason, fails.
 */
function allowlistProblems(found, allow) {
  const byKey = new Map();
  for (const entry of found) {
    const key = entry.replace(/:\d+ </, ' <');
    byKey.set(key, [...(byKey.get(key) ?? []), entry]);
  }
  const problems = [];
  for (const [key, entries] of byKey) {
    const allowed = allow[key]?.count ?? 0;
    if (entries.length > allowed) problems.push(...entries.map((e) => `${e} (${entries.length} found, ${allowed} allowed)`));
  }
  for (const [key, { count, reason }] of Object.entries(allow)) {
    if (!String(reason ?? '').trim()) problems.push(`${key} needs a reason`);
    const n = byKey.get(key)?.length ?? 0;
    if (n < count) problems.push(`${key} is allowlisted ${count} time(s) but found ${n}`);
  }
  return problems;
}

describe('link colour and underline only on links and buttons, on the content pages (links everywhere, part 3)', () => {
  // The content files part 3 linked: fleet and flight pages, hubs, trackers and Newark.
  const astroIn = (dir) => [...walk(resolve(ROOT, dir))].filter((p) => p.endsWith('.astro')).map((p) => relative(ROOT, p));
  const ASTRO_SCOPE = [
    'src/layouts/FleetTypeLayout.astro',
    'src/layouts/HubLayout.astro',
    // A news article's header: its category label beside the date (the content inventory's
    // painted-but-inert list).
    'src/layouts/NewsLayout.astro',
    ...astroIn('src/pages/fleet'),
    ...astroIn('src/pages/flight'),
    ...astroIn('src/pages/hubs'),
    ...astroIn('src/pages/trackers'),
    'src/pages/newark.astro',
    ...astroIn('src/components/trackers'),
    ...readdirSync(resolve(ROOT, 'src/components/site'))
      .filter((name) => /^(Flight\w*|FleetLive|HubBoard|StatTile)\.astro$/.test(name))
      .map((name) => `src/components/site/${name}`),
  ];
  const SCRIPT_SCOPE = ['src/scripts/fleet-live.ts', 'src/scripts/flight-page.ts', 'src/scripts/hub-board.ts'];
  // `file <tag> classes` → how many such elements the file may hold (in its source: one element in
  // a .map() is one) and why they may carry link colour or an underline. Keyed by what the element
  // is, not its line, so an edit above it changes nothing; a second one, or one that has gone, fails.
  const ALLOW = {
    'src/pages/fleet/index.astro <p> text-primary': {
      count: 1,
      reason: "the count on each type card (19 cards), clickable whole through its stretched type link (DESIGN.md 2026-11-11): a click on the figure follows the link",
    },
    'src/pages/hubs/index.astro <p> text-primary': {
      count: 1,
      reason: "the code on each hub card (9 cards), clickable whole through its stretched link (DESIGN.md 2026-11-11): a click on the code follows the link",
    },
    'src/components/site/FlightTrip.astro <div> text-primary': {
      count: 1,
      reason: "the plane marker on the flight page's progress track: an aria-hidden icon drawn in link colour, not text",
    },
  };

  it('finds no element on these pages that looks like a link and is not one', () => {
    // How many elements carry link colour or an underline at all: a scan that saw none proves nothing.
    const seen = { styled: 0 };
    const found = [
      ...ASTRO_SCOPE.flatMap((file) =>
        astroLinkStyleOffenders(readFileSync(resolve(ROOT, file), 'utf8'), seen).map((o) => `${file}:${o.line} <${o.tag}> ${o.classes.join(' ')}`),
      ),
      ...SCRIPT_SCOPE.flatMap((file) =>
        scriptLinkStyleOffenders(readFileSync(resolve(ROOT, file), 'utf8'), file).map((o) => `${file}:${o.line} <${o.tag}> ${o.classes.join(' ')}`),
      ),
    ];
    expect(seen.styled).toBeGreaterThan(40); // 47 on Nov 12 2026, nearly all of them links
    expect(allowlistProblems(found, ALLOW)).toEqual([]);
  });

  it('the allowlist names what an element is, not its line: a copy edit above it passes, a new one fails', () => {
    const offenders = (file, source) => astroLinkStyleOffenders(source).map((o) => `${file}:${o.line} <${o.tag}> ${o.classes.join(' ')}`);
    const allow = { 'x.astro <p> text-primary': { count: 1, reason: 'a whole-card figure' } };
    const card = '<li class="relative"><p class="text-primary">19</p><a href="/x" class="after:inset-0">X</a></li>';
    expect(allowlistProblems(offenders('x.astro', `---\nconst a = 1;\n---\n<ul>${card}</ul>`), allow)).toEqual([]);
    // Lines added above the element: still the same element, still allowed.
    expect(allowlistProblems(offenders('x.astro', `---\nconst a = 1;\nconst b = 2;\n---\n<h2>What's new</h2>\n<p>One more line.</p>\n<ul>${card}</ul>`), allow)).toEqual([]);
    // A second link-coloured <p> in the same file fails, naming both.
    expect(allowlistProblems(offenders('x.astro', `<ul>${card}</ul>\n<p class="text-primary">New label</p>`), allow)).toEqual([
      'x.astro:1 <p> text-primary (2 found, 1 allowed)',
      'x.astro:2 <p> text-primary (2 found, 1 allowed)',
    ]);
    // A different element, or the same classes in another file, is not covered by the entry.
    expect(allowlistProblems(offenders('x.astro', `<ul>${card}</ul><span class="underline">x</span>`), allow)).toEqual([
      'x.astro:1 <span> underline (1 found, 0 allowed)',
    ]);
    expect(allowlistProblems([...offenders('x.astro', card), ...offenders('y.astro', card)], allow)).toEqual([
      'y.astro:1 <p> text-primary (1 found, 0 allowed)',
    ]);
    // An entry whose element has gone fails, and so does one with no reason.
    expect(allowlistProblems([], allow)).toEqual(['x.astro <p> text-primary is allowlisted 1 time(s) but found 0']);
    expect(allowlistProblems(offenders('x.astro', card), { 'x.astro <p> text-primary': { count: 1, reason: ' ' } })).toEqual([
      'x.astro <p> text-primary needs a reason',
    ]);
  });

  it('covers the files the content pages link from', () => {
    for (const file of [
      'src/pages/fleet/index.astro',
      'src/pages/hubs/index.astro',
      'src/pages/trackers/united-hubs.astro',
      'src/pages/trackers/atc/[code].astro',
      'src/components/trackers/TrackerTable.astro',
      'src/components/site/FlightAircraftCard.astro',
      'src/components/site/HubBoard.astro',
      'src/pages/flight/index.astro',
    ]) {
      expect(ASTRO_SCOPE).toContain(file);
    }
    expect(ASTRO_SCOPE.length).toBeGreaterThanOrEqual(25);
  });

  it('catches link colour or an underline on an .astro element that is not a link, button or disclosure', () => {
    const tags = (src) => astroLinkStyleOffenders(src).map((o) => o.tag);
    expect(tags('<span class="font-mono text-primary">ORD</span>')).toEqual(['span']);
    expect(tags('<td class="underline">ORD</td>')).toEqual(['td']);
    expect(tags('<p class:list={["a", on && "hover:underline"]}>x</p>')).toEqual(['p']);
    expect(tags('<div class={`px-2 ${on ? "text-primary/80" : ""}`}>x</div>')).toEqual(['div']);
    // A frontmatter constant, and one built from another, followed to where they are used.
    expect(tags("---\nconst TONE = 'text-primary';\nconst CELL = `px-2 ${TONE}`;\n---\n<td class={CELL}>x</td>")).toEqual(['td']);
    // class:list object keys.
    expect(tags("<span class:list={{ 'text-primary': on }}>x</span>")).toEqual(['span']);
    // A component's class lands on whatever it renders, which is not a link.
    expect(tags('<StatTile label="x" value={1} class="text-primary" />')).toEqual(['StatTile']);
    // Inside a JSX map callback in the template, after a link has closed.
    expect(tags('<ul>{rows.map((r) => (<li><a href={r.href}>x</a><span class="underline">y</span></li>))}</ul>')).toEqual(['span']);
    // An arrow function's `=>`, a `>` in an expression and one in a quoted value do not end the tag early.
    expect(tags('<span data-x={rows.find((r) => r.x > 1)} title="a > b" class="text-primary">x</span>')).toEqual(['span']);
  });

  it('lets links, buttons, disclosures, what sits inside them, and the near-misses through', () => {
    const ok = [
      '<a href="/" class="text-primary underline underline-offset-2">x</a>',
      '<button type="button" class="hover:underline">x</button>',
      '<summary class="text-primary">More</summary>',
      '<a href="/" class="group"><span class="underline group-hover:decoration-foreground">FAA status →</span></a>',
      '<a href="/"><strong><span class="text-primary">deep</span></strong></a>',
      // Descendant-link styling is the links' look, not the paragraph's.
      '<p class="text-muted-foreground [&_a]:text-primary [&_a]:underline [&_a:hover]:decoration-current">x <a href="/">y</a></p>',
      '<span class="bg-primary text-primary-foreground no-underline underline-offset-2 decoration-muted-foreground/40">x</span>',
      // Comments, scripts and styles are not markup.
      '<!-- <span class="text-primary">old</span> -->',
      '{/* <span class="text-primary">old</span> */}',
      '<style>.x { color: red; }</style><script>const s = \'<span class="text-primary">\';</script>',
      // A string that is not a class is not read.
      '<span title="text-primary underline" data-x="underline">x</span>',
      // Void and self-closing elements close themselves: what follows is not inside them.
      '<a href="/">x<br>y</a><img src="/x.png" alt=""><input type="text" />',
    ];
    for (const src of ok) expect(astroLinkStyleOffenders(src), src).toEqual([]);
  });

  it('a link closes where it closes: an underlined element after it is not inside it', () => {
    expect(astroLinkStyleOffenders('<p><a href="/">x</a> <span class="underline">y</span></p>').map((o) => o.tag)).toEqual(['span']);
  });

  it('reports the line in the .astro file, frontmatter included', () => {
    expect(astroLinkStyleOffenders("---\nconst x = 1;\n---\n<div>\n  <span class=\"text-primary\">x</span>\n</div>")).toEqual([
      { line: 5, tag: 'span', classes: ['text-primary'] },
    ]);
  });

  it('catches link colour or an underline a page script paints on an element that is not a link', () => {
    const tags = (src) => scriptLinkStyleOffenders(src).map((o) => o.tag);
    expect(tags("const s = document.createElement('span');\ns.className = 'text-primary';")).toEqual(['span']);
    expect(tags("function el(tag, cls) { const n = document.createElement(tag); if (cls) n.className = cls; return n; }\nel('span', 'underline');")).toEqual(['span']);
    expect(tags("const TONE = 'hover:underline';\nconst x = el('div', `px-2 ${TONE}`);")).toEqual(['div']);
    expect(tags("const li = row.querySelector('li');\nli.classList.add('text-primary');")).toEqual(['?']);
    expect(tags("const d = document.createElement('div');\nd.classList.replace('text-foreground', 'text-primary');")).toEqual(['div']);
    for (const ok of [
      "const a = document.createElement('a');\na.className = 'text-primary underline';",
      "const a = el('a', 'text-primary hover:underline', 'UA1');",
      "const b = document.createElement('button');\nb.classList.add('underline');",
      "const s = document.createElement('span');\ns.className = 'sr-only text-primary-foreground no-underline';",
      "const d = document.createElement('div');\nd.classList.replace('text-primary', 'text-foreground');",
    ]) {
      expect(scriptLinkStyleOffenders(ok), ok).toEqual([]);
    }
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
      /(?:^|;)\s*color:\s*var\(--(?:color-)?primary\)/.test(body) ||
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
    // The theme's own name for the colour, and the arbitrary-value utility.
    expect(cssLinkStyleOffenders('.bb-content .iata { color: var(--color-primary); }')).toEqual(['.bb-content .iata']);
    expect(cssLinkStyleOffenders('.bb-content .iata { @apply font-mono text-[var(--color-primary)]; }')).toEqual(['.bb-content .iata']);
    expect(cssLinkStyleOffenders('.x .code { @apply text-[var(--primary)]; }')).toEqual(['.x .code']);
    expect(cssLinkStyleOffenders('.x .code { text-decoration: underline; }')).toEqual(['.x .code']);
    for (const ok of [
      '.bb-content a { @apply text-foreground underline decoration-muted-foreground/50; }',
      '.bb-content li a:hover { @apply text-primary; }',
      '.bb-content .btn { @apply bg-primary-fill text-primary-foreground no-underline underline-offset-2; }',
      '.bb-content .tag { color: var(--color-primary-foreground); background-color: var(--color-primary); }',
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
