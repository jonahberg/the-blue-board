// @vitest-environment jsdom
// Wide tables on content pages scroll in their own focusable, named region (axe
// scrollable-region-focusable), never by scrolling the whole section: src/components/site/
// table-regions.ts for the markup, src/scripts/scroll-regions.ts for the tab stop that exists only
// while the table overflows.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { htmlText, SCROLL_REGION_CLASS, scrollRegionOpen, wrapTables } from '../src/components/site/table-regions';
import { syncScrollRegion } from '../src/scripts/scroll-regions';
import { fleetOrder, fleetTypes } from '../src/data/fleet/index.js';

describe('wrapTables', () => {
  it('wraps a raw table in a region named after the heading above it', () => {
    const html = '<div class="section"><h2 id="seats">Seat Map &amp; Configuration</h2><p>x</p><table class="config-table"><tr><td>1</td></tr></table></div>';
    const out = wrapTables(html);
    expect(out).toBe(
      `<div class="section"><h2 id="seats">Seat Map &amp; Configuration</h2><p>x</p>${scrollRegionOpen('Seat Map & Configuration table')}<table class="config-table"><tr><td>1</td></tr></table></div></div>`,
    );
    document.body.innerHTML = out;
    const region = document.querySelector('[data-scroll-region]')!;
    expect(region.getAttribute('role')).toBe('region');
    expect(region.getAttribute('aria-label')).toBe('Seat Map & Configuration table');
    expect(region.getAttribute('tabindex')).toBe('0');
    expect(region.className).toBe(SCROLL_REGION_CLASS);
  });

  it('names each table by its own nearest heading, and falls back to "Table"', () => {
    const out = wrapTables('<table><tr><td>a</td></tr></table><h3>Cabins <em>2026</em></h3><table><tr><td>b</td></tr></table>');
    document.body.innerHTML = out;
    expect([...document.querySelectorAll('[data-scroll-region]')].map((r) => r.getAttribute('aria-label'))).toEqual([
      'Table',
      'Cabins 2026 table',
    ]);
  });

  it('leaves a string without a table untouched and escapes the name', () => {
    expect(wrapTables('<p>no tables</p>')).toBe('<p>no tables</p>');
    expect(wrapTables('')).toBe('');
    expect(scrollRegionOpen('A "B" <C>')).toContain('aria-label="A &quot;B&quot; &lt;C&gt;"');
    expect(htmlText('A&nbsp;&mdash; <b>B</b>')).toBe('A — B');
  });

  it('wraps every fleet type page\'s seat table, each with a unique name', () => {
    for (const key of fleetOrder) {
      const html = wrapTables(fleetTypes[key].contentHtml);
      const tables = (fleetTypes[key].contentHtml.match(/<table[\s>]/g) || []).length;
      const regions = html.match(/data-scroll-region/g) || [];
      expect(regions.length, key).toBe(tables);
      expect(html, key).not.toMatch(/aria-label="Table"/);
    }
  });
});

describe('syncScrollRegion', () => {
  const region = (scrollWidth: number, clientWidth: number) => {
    document.body.innerHTML = scrollRegionOpen('Aircraft registry') + '<table></table></div>';
    const el = document.querySelector<HTMLElement>('[data-scroll-region]')!;
    Object.defineProperty(el, 'scrollWidth', { configurable: true, value: scrollWidth });
    Object.defineProperty(el, 'clientWidth', { configurable: true, value: clientWidth });
    return el;
  };

  it('keeps the tab stop, role and name while the table overflows', () => {
    const el = region(561, 361);
    syncScrollRegion(el);
    expect(el.getAttribute('tabindex')).toBe('0');
    expect(el.getAttribute('role')).toBe('region');
    expect(el.getAttribute('aria-label')).toBe('Aircraft registry');
  });

  it('drops all three when the table fits, and restores them when it overflows again', () => {
    const el = region(800, 800);
    syncScrollRegion(el);
    expect(el.hasAttribute('tabindex')).toBe(false);
    expect(el.hasAttribute('role')).toBe(false);
    expect(el.hasAttribute('aria-label')).toBe(false);
    Object.defineProperty(el, 'clientWidth', { configurable: true, value: 300 });
    syncScrollRegion(el);
    expect(el.getAttribute('tabindex')).toBe('0');
    expect(el.getAttribute('aria-label')).toBe('Aircraft registry');
  });

  it('never removes the tab stop a reader is on', () => {
    const el = region(800, 800);
    el.focus();
    syncScrollRegion(el);
    expect(el.getAttribute('tabindex')).toBe('0');
  });
});

describe('content sections no longer scroll as a whole', () => {
  it('ContentSection has no overflow utility; the fleet and tracker tables use ScrollRegion', () => {
    const root = resolve(__dirname, '..');
    const section = readFileSync(resolve(root, 'src/components/site/ContentSection.astro'), 'utf8');
    expect(section).not.toMatch(/overflow-x-(auto|scroll)/);
    for (const file of ['src/layouts/FleetTypeLayout.astro', 'src/pages/fleet/index.astro', 'src/components/trackers/TrackerTable.astro']) {
      const src = readFileSync(resolve(root, file), 'utf8');
      const tables = (src.match(/<table[\s>]/g) || []).length;
      const regions = (src.match(/<ScrollRegion\b/g) || []).length;
      expect(regions, file).toBe(tables);
    }
  });
});
