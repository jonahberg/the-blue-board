import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

// Regression guard for the v2.0 map outage (PR #220): a marker hit-slop rule
// shipped `.leaflet-marker-icon.leaflet-interactive{position:relative}`, which
// outranks the `position:absolute` in Leaflet's own "required styles" block.
// Marker icons are display:block, so relative positioning drops all 600+ plane
// markers back into normal flow inside .leaflet-marker-pane — each one stacks
// below the previous before Leaflet's translate3d() is applied, smearing the
// fleet southward off the map. Hub markers survived only because they are
// L.circleMarker (SVG in the overlay pane), which is why the outage looked
// partial.
//
// Leaflet positions every marker with a transform relative to the pane origin;
// any rule that changes `position` on these elements breaks that contract.

const REQUIRED_ABSOLUTE = [
  'leaflet-pane',
  'leaflet-tile',
  'leaflet-marker-icon',
  // Every interactive marker icon also carries .leaflet-interactive; a `position`
  // override written against it alone (without the .leaflet-marker-icon qualifier
  // that the PR #220 rule happened to include) reproduces the exact outage and would
  // otherwise slip past this guard.
  'leaflet-interactive',
  'leaflet-marker-shadow',
  'leaflet-tile-container',
  'leaflet-zoom-box',
  'leaflet-image-layer',
  'leaflet-layer',
];

describe('Leaflet required styles are not overridden', () => {
  // The dashboard's stylesheet is src/styles/global.css now; public/css/style.css is
  // retired (deleted in v1.8.0 along with the `legacy/` reference copy).
  const css = readFileSync(
    resolve(__dirname, '..', 'src', 'styles', 'global.css'),
    'utf8'
  );

  // Strip comments so prose describing these rules can't trip the scan.
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');

  // [selectorList, declarationBlock] for every rule in the sheet.
  const rules = [...stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => [
    m[1].trim(),
    m[2],
  ]);

  for (const cls of REQUIRED_ABSOLUTE) {
    it(`does not set \`position\` on .${cls}`, () => {
      const offenders = rules.filter(([selector, body]) => {
        // Pseudo-elements get their own box; only the element itself is bound
        // by Leaflet's positioning contract. `::after{position:absolute}` is
        // the correct way to draw a hit-slop and must stay legal.
        const targetsElementItself = new RegExp(
          `\\.${cls}(?![\\w-])(?![^,]*::)`
        ).test(selector);
        const setsPosition = /(^|[;\s])position\s*:/.test(body);
        return targetsElementItself && setsPosition;
      });

      expect(
        offenders.map(([s]) => s),
        `.${cls} must inherit position:absolute from leaflet.css`
      ).toEqual([]);
    });
  }

  // The live map mounts Leaflet's zoom control at 'bottomright'. leaflet.css gives it a 10px
  // margin and a 30px-wide button stack, so it owns roughly the first 42px in from the map's
  // right edge and the first 89px up from its bottom. #legal-details shipped at right:16px and
  // covered the zoom-OUT button outright — document.elementFromPoint at the button's centre
  // returned #legal-btn, so clicking "−" opened the About popover instead of zooming.
  //
  // The rebuild has no fixed full-bleed map, so nothing should be pinned into that corner at
  // all. This asserts the absence rather than a specific rule's offset: any position:fixed
  // rule that plants itself in the bottom-right corner is the same bug.
  const LEAFLET_ZOOM_RIGHT_RESERVED_PX = 52;

  it('leaves the map\'s bottom-right corner clear of fixed overlays', () => {
    const offenders = rules.filter(([, body]) => {
      if (!/position\s*:\s*fixed/.test(body)) return false;
      if (!/(^|[;\s])bottom\s*:/.test(body)) return false;
      const right = Number((body.match(/(?:^|[;\s])right\s*:\s*(\d+)px/) || [])[1]);
      return Number.isFinite(right) && right < LEAFLET_ZOOM_RIGHT_RESERVED_PX;
    });

    expect(
      offenders.map(([selector]) => selector),
      `a fixed bottom-right overlay within ${LEAFLET_ZOOM_RIGHT_RESERVED_PX}px of the edge ` +
        "swallows the map's zoom-out button"
    ).toEqual([]);
  });

  // Prove the guard would actually catch the PR #220 failure mode written the sneaky
  // way — against .leaflet-interactive alone, with no .leaflet-marker-icon qualifier.
  it('flags a synthetic `.leaflet-interactive{position:relative}` offender', () => {
    const synthetic = [['.leaflet-interactive', 'position:relative']];
    const cls = 'leaflet-interactive';
    const offenders = synthetic.filter(([selector, body]) => {
      const targetsElementItself = new RegExp(`\\.${cls}(?![\\w-])(?![^,]*::)`).test(selector);
      const setsPosition = /(^|[;\s])position\s*:/.test(body);
      return targetsElementItself && setsPosition;
    });
    expect(offenders.map(([s]) => s)).toEqual(['.leaflet-interactive']);

    // The legal hit-slop ::after rule must NOT be flagged (the (?![^,]*::) lookahead).
    const legal = [['.leaflet-marker-icon.leaflet-interactive::after', "content:'';position:absolute;inset:-5px"]];
    const legalOffenders = legal.filter(([selector, body]) => {
      const targetsElementItself = new RegExp(`\\.${cls}(?![\\w-])(?![^,]*::)`).test(selector);
      const setsPosition = /(^|[;\s])position\s*:/.test(body);
      return targetsElementItself && setsPosition;
    });
    expect(legalOffenders).toEqual([]);
  });

  // The CSS scan above can only see global.css. The rebuild positions its overlays with
  // Tailwind utility classes inside TSX, where a `fixed bottom-4 right-4` panel would
  // reproduce the #legal-details bug and no stylesheet rule would exist to catch it.
  //
  // Tailwind's spacing scale is 0.25rem per step, so right-0..right-12 is everything inside
  // the ~52px the Leaflet zoom control reserves in the map's bottom-right corner (right-13
  // == 52px is the first step that clears it).
  const RIGHT_INSIDE_RESERVED =
    /\bright-(?:0|px|0\.5|1|1\.5|2|2\.5|3|3\.5|4|5|6|7|8|9|10|11|12)\b/;

  /** True when one class list pins an element over the map's zoom control. */
  function pinsFixedBottomRight(classes) {
    return (
      /(^|\s)fixed(\s|$)/.test(classes) &&
      /\bbottom-/.test(classes) &&
      RIGHT_INSIDE_RESERVED.test(classes)
    );
  }

  /**
   * Every string literal in the file, not just `className="…"`. Class lists reach the DOM
   * through `cn(...)`, `cva()` variants and plain constants too, and a scan that only saw
   * the `className=` attribute would pass vacuously over all of them.
   */
  function stringLiteralsIn(source) {
    const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    return [...withoutComments.matchAll(/"([^"\n]*)"|'([^'\n]*)'|`([^`]*)`/g)].map(
      (m) => m[1] ?? m[2] ?? m[3] ?? ''
    );
  }

  it("no component pins a fixed overlay into the map's bottom-right corner", () => {
    const APP_DIR = resolve(__dirname, '..', 'src', 'app');

    function filesUnder(dir) {
      const found = [];
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = resolve(dir, entry.name);
        if (entry.isDirectory()) found.push(...filesUnder(path));
        else if (/\.tsx?$/.test(entry.name)) found.push(path);
      }
      return found;
    }

    const files = filesUnder(APP_DIR);
    // Without this the whole assertion passes on an empty list — a moved directory or a
    // typo'd resolve() would silently retire the guard, which is exactly how the rule this
    // replaces stopped being worth anything.
    expect(files.length, 'found no .ts/.tsx under src/app — the scan is looking in the wrong place').
      toBeGreaterThan(20);

    const offenders = [];
    for (const file of files) {
      for (const literal of stringLiteralsIn(readFileSync(file, 'utf8'))) {
        if (pinsFixedBottomRight(literal)) {
          offenders.push(`${file.split('/src/').pop()} → ${literal.trim().slice(0, 80)}`);
        }
      }
    }

    expect(
      offenders,
      "a fixed bottom-right overlay swallows the map's zoom-out button (see #legal-details)"
    ).toEqual([]);
  });

  // Guards the scan itself: the same predicate the scan uses must flag the shape it hunts,
  // including one hidden inside a cn() call, and must not flag a cleared or non-fixed one.
  it('flags a synthetic fixed bottom-right overlay', () => {
    expect(pinsFixedBottomRight('fixed bottom-4 right-4 z-50 rounded-md border')).toBe(true);
    expect(pinsFixedBottomRight('fixed right-0 bottom-0 h-40')).toBe(true);
    // ...and must NOT flag one that clears the control, or one that is not fixed at all.
    expect(pinsFixedBottomRight('fixed bottom-4 right-16')).toBe(false);
    expect(pinsFixedBottomRight('absolute bottom-4 right-4')).toBe(false);
    expect(pinsFixedBottomRight('fixed inset-y-0 right-0 w-3/4')).toBe(false);

    // The literal scan must reach class lists that never touch a `className=` attribute.
    const viaCn = 'const x = cn("fixed bottom-4 right-4", open && "opacity-100");';
    expect(stringLiteralsIn(viaCn).some(pinsFixedBottomRight)).toBe(true);
    // Comments are stripped, so prose describing the bug does not trip the guard.
    expect(
      stringLiteralsIn('// never write "fixed bottom-4 right-4" here\nconst y = 1;').some(
        pinsFixedBottomRight
      )
    ).toBe(false);
  });

  it('keeps the marker hit-slop pseudo-element', () => {
    // The accessibility win from PR #220 (10px touch targets are a click hazard)
    // is preserved by the ::after alone — an absolutely positioned marker is
    // already a containing block for its abspos descendants.
    expect(stripped).toMatch(
      /\.leaflet-marker-icon[^{]*::after\s*\{[^}]*inset\s*:\s*-\d/
    );
  });
});
