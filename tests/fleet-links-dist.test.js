// The built fleet pages (dist/), links everywhere (Nov 2026): every registry tail opens the
// dashboard's aircraft dialog, Starlink cells the Starlink tab, the /fleet seat table's counts the
// Fleet tab filtered to the type, and nothing that is not a link wears link colour.
// Needs `bun run build` first (skips without dist/; CI builds first).
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

import { fleetOrder, fleetTypes } from '../src/data/fleet/index.js';

const DIST = resolve(__dirname, '..', 'dist');
const hasDist = existsSync(join(DIST, 'fleet.html'));
if (!hasDist && process.env.CI) throw new Error('dist/ is missing in CI — run `bun run build` before `bun run test`');

const FLEET = JSON.parse(readFileSync(resolve(__dirname, '..', 'public', 'data', 'fleet.json'), 'utf8'));
const page = (rel) => new JSDOM(readFileSync(join(DIST, rel), 'utf8')).window.document;
const classes = (el) => (el.getAttribute('class') || '').split(/\s+/);
/** The touch rule's row link: 44 px on touch, the table's own height with a mouse at md+. */
const TOUCH_ROW = ['min-h-11', '-my-1.5', 'pointer-fine:md:my-0', 'pointer-fine:md:inline', 'pointer-fine:md:min-h-0', 'pointer-fine:md:pt-0'];

/** Elements wearing link colour that are neither a link nor a button, as "tag.text". */
function painted(doc) {
  return [...doc.querySelectorAll('main [class]')]
    .filter((el) => classes(el).includes('text-primary') && !el.closest('a, button'))
    .map((el) => `${el.tagName.toLowerCase()}:${el.textContent.trim().slice(0, 30)}`);
}

describe.skipIf(!hasDist)('fleet type pages: the registry links every tail', () => {
  for (const slug of fleetOrder) {
    it(`/fleet/${slug}`, () => {
      const doc = hasDist ? page(`fleet/${slug}.html`) : null;
      const typeCode = fleetTypes[slug].typeCode;
      const expected = FLEET.filter((a) => a.t === typeCode);
      const table = doc.querySelector('h2#registry').closest('section').querySelector('table');
      const rows = [...table.querySelectorAll('tbody tr')];
      expect(rows.length).toBe(expected.length);

      for (const tr of rows) {
        const reg = tr.cells[0].textContent.trim();
        const ac = expected.find((a) => a.r === reg);
        expect(ac, reg).toBeTruthy();
        // The tail: the row's one link-coloured link, to the aircraft dialog.
        const tail = tr.cells[0].querySelector('a');
        expect(tail.getAttribute('href')).toBe(`/?aircraft=${reg}`);
        expect(classes(tail)).toEqual(expect.arrayContaining([...TOUCH_ROW, 'text-primary']));
        const links = [...tr.querySelectorAll('a')];
        expect(links.filter((a) => classes(a).includes('text-primary'))).toEqual([tail]);
        // Starlink → the Starlink tab, quietly; every other cell is text.
        const starlink = String(ac.w || '').toLowerCase().includes('starlink');
        expect(links.map((a) => a.getAttribute('href'))).toEqual(starlink ? [`/?aircraft=${reg}`, '/#starlink'] : [`/?aircraft=${reg}`]);
        if (starlink) {
          const wifi = links[1];
          expect(wifi.querySelector('.starlink-on')?.textContent).toBe(ac.w);
          expect(classes(wifi)).toEqual(expect.arrayContaining(TOUCH_ROW));
        }
      }
    });
  }

  it('the h1 names the page in body colour, and no link-coloured text on a type page is not a link', () => {
    for (const slug of fleetOrder) {
      const doc = page(`fleet/${slug}.html`);
      const h1 = doc.querySelector('main h1');
      expect(h1.querySelector('.type-badge')).not.toBeNull();
      expect(h1.querySelector('a')).toBeNull();
      expect(classes(h1)).toContain('[&_.type-badge]:text-foreground');
      expect(painted(doc), slug).toEqual([]);
    }
  });
});

describe.skipIf(!hasDist)('/fleet', () => {
  const doc = hasDist ? page('fleet.html') : null;

  it('the seat table: the type to its page, its count to the Fleet tab filtered to it', () => {
    const table = [...doc.querySelectorAll('table')].find((t) => /Cabin Configuration/.test(t.querySelector('thead').textContent));
    const rows = [...table.querySelectorAll('tbody tr')];
    expect(rows.length).toBe(fleetOrder.length);
    for (const tr of rows) {
      const [typeLink] = tr.cells[0].querySelectorAll('a');
      const t = Object.values(fleetTypes).find((x) => x.typeCode === typeLink.textContent);
      expect(typeLink.getAttribute('href')).toBe(`/fleet/${t.slug}`);
      expect(classes(typeLink)).toContain('text-primary');
      const count = tr.cells[1].querySelector('a');
      expect(count.getAttribute('href')).toBe(`/?tab=fleet&type=${encodeURIComponent(t.typeCode)}`);
      expect(count.textContent).toBe(`${t.count}, list them in the dashboard`);
      expect(classes(count)).not.toContain('text-primary');
      expect(classes(count)).toEqual(expect.arrayContaining(TOUCH_ROW));
    }
  });

  it('"Starlink Tracker" opens the Starlink tab; the hubs and Express named in What\'s New link', () => {
    const tracker = [...doc.querySelectorAll('a')].find((a) => a.textContent.trim() === 'Starlink Tracker');
    expect(tracker.getAttribute('href')).toBe('/#starlink');
    const hrefOf = (text) => [...doc.querySelectorAll('main li a')].find((a) => a.textContent.trim() === text)?.getAttribute('href');
    expect(hrefOf('San Francisco')).toBe('/hubs/sfo');
    expect(hrefOf('Houston')).toBe('/hubs/iah');
    expect(hrefOf('Washington Dulles')).toBe('/hubs/iad');
    expect(hrefOf('United Express regional jets')).toBe('/?tab=fleet&view=express');
  });

  it('family names and counts are body colour: a family has no page', () => {
    // The only link-coloured text outside a link is each type card's count, inside a card that is
    // clickable whole through its stretched link (DESIGN.md 2026-11-11).
    const cardCounts = fleetOrder.map((key) => `p:${fleetTypes[key].count}`).sort();
    expect(painted(doc).sort()).toEqual(cardCounts);
  });
});
