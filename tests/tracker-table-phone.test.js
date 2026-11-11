// @vitest-environment jsdom
// The tracker tables below md are a stack of cards made from the SAME table (TrackerTable.astro):
// one table per page, explicit table roles so a CSS display change cannot drop the cell/header
// association, visible phone labels hidden from screen readers (the header names the cell), and
// the `#row-…` / `[data-trk-row]` hooks the search, sort and briefing strip depend on. Needs dist/.
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const DIST = resolve(__dirname, '..', 'dist');
const hasDist = existsSync(join(DIST, 'index.html'));
if (!hasDist && process.env.CI) throw new Error('dist/ is missing in CI — run `bun run build` before `bun run test`');

const PAGES = {
  'trackers/atc.html': { rows: 89, labels: ['Went digital'] },
  'trackers/united-hubs.html': { rows: null, labels: ['Opened / target', 'Scale'] },
};

describe.skipIf(!hasDist)('tracker tables on a phone', () => {
  for (const [rel, expected] of Object.entries(PAGES)) {
    it(`${rel}: one table, explicit roles, phone layout classes, row hooks intact`, () => {
      document.documentElement.innerHTML = readFileSync(join(DIST, rel), 'utf8').replace(/^[\s\S]*?<html[^>]*>/, '');
      const tables = document.querySelectorAll('table.trk-table');
      expect(tables).toHaveLength(1);
      const table = tables[0];
      expect(table.getAttribute('role')).toBe('table');
      expect(table.closest('[data-scroll-region]')).not.toBeNull();
      for (const th of table.querySelectorAll('thead th')) expect(th.getAttribute('role')).toBe('columnheader');
      const rows = table.querySelectorAll('tbody tr');
      if (expected.rows) expect(rows).toHaveLength(expected.rows);
      const ids = new Set();
      for (const tr of rows) {
        expect(tr.getAttribute('role')).toBe('row');
        expect(tr.hasAttribute('data-trk-row')).toBe(true);
        expect(tr.id).toMatch(/^row-/);
        expect(ids.has(tr.id)).toBe(false);
        ids.add(tr.id);
        expect(tr.className).toContain('max-md:grid');
        for (const td of tr.children) expect(td.getAttribute('role')).toBe('cell');
      }
      // Every column is still in each row (every field kept).
      const columns = table.querySelectorAll('thead th').length;
      for (const tr of rows) expect(tr.children).toHaveLength(columns);
      // Phone labels are visible on screen only.
      const labels = new Set([...table.querySelectorAll('tbody td > span[aria-hidden="true"].md\\:hidden')].map((s) => s.textContent.trim()));
      expect([...labels].sort()).toEqual([...expected.labels].sort());
    });
  }
});
