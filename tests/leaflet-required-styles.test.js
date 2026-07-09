import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
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
  'leaflet-marker-shadow',
  'leaflet-tile-container',
  'leaflet-zoom-box',
  'leaflet-image-layer',
  'leaflet-layer',
];

describe('Leaflet required styles are not overridden', () => {
  const css = readFileSync(
    resolve(__dirname, '..', 'public', 'css', 'style.css'),
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
  // margin and a 30px-wide button stack, so it owns roughly the first 42px in from the viewport's
  // right edge and the first 89px up from the bottom. #legal-details shipped at right:16px and
  // covered the zoom-OUT button outright — document.elementFromPoint at the button's centre
  // returned #legal-btn, so clicking "−" opened the About popover instead of zooming.
  const LEAFLET_ZOOM_RIGHT_RESERVED_PX = 52;

  it('keeps fixed bottom-right overlays clear of the Leaflet zoom control', () => {
    const rule = stripped.match(/#legal-details\s*\{([^}]*)\}/);
    expect(rule, '#legal-details rule not found').toBeTruthy();

    const body = rule[1];
    expect(body, 'expected #legal-details to be position:fixed').toMatch(/position\s*:\s*fixed/);

    const right = Number((body.match(/(?:^|;)\s*right\s*:\s*(\d+)px/) || [])[1]);
    expect(
      right,
      `#legal-details must sit at least ${LEAFLET_ZOOM_RIGHT_RESERVED_PX}px from the right edge ` +
        "so it does not swallow the map's zoom-out button"
    ).toBeGreaterThanOrEqual(LEAFLET_ZOOM_RIGHT_RESERVED_PX);
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
